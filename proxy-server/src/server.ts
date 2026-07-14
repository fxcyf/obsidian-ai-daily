import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFile, writeFile, mkdir } from "fs/promises";
import { randomUUID } from "crypto";

// ── Config ─────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "27090", 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const MCP_CONFIG = process.env.MCP_CONFIG || resolve(dirname(fileURLToPath(import.meta.url)), "../mcp-config.json");
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const VAULT_PATH = process.env.VAULT_PATH || "";
const UNDO_STACK_FILE = VAULT_PATH
	? resolve(VAULT_PATH, ".obsidian/plugins/ai-daily-chat/.undo-stack.json")
	: "";

if (!AUTH_TOKEN) {
	console.error("Error: AUTH_TOKEN environment variable is required");
	process.exit(1);
}

// ── Types ──────────────────────────────────────────────────────────

interface ChatRequest {
	message: string;
	sessionId?: string;
	systemPrompt?: string;
	history?: { role: string; content: string }[];
}

interface ClaudeStreamEvent {
	type: string;
	subtype?: string;
	result?: string;
	session_id?: string;
	message?: {
		content?: Array<{
			type: string;
			text?: string;
			name?: string;
			input?: Record<string, unknown>;
		}>;
	};
	[key: string]: unknown;
}

// ── Task cache (fire-and-forget support) ──────────────────────────

interface TaskState {
	status: "running" | "done" | "error";
	chunks: string[];
	result?: string;
	sessionId?: string;
	error?: string;
	createdAt: number;
}

const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const TASK_RETENTION_MS = 30 * 60 * 1000;
const tasks = new Map<string, TaskState>();

setInterval(() => {
	const now = Date.now();
	for (const [id, task] of tasks) {
		if (now - task.createdAt > TASK_RETENTION_MS && task.status !== "running") {
			tasks.delete(id);
		}
	}
}, 60_000);

// ── Server ─────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
	// CORS headers
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
	console.log(`[Proxy] ${req.method} ${url.pathname} from ${req.headers["x-real-ip"] || req.socket.remoteAddress}`);

	if (req.method === "OPTIONS") {
		res.statusCode = 204;
		res.end();
		return;
	}

	if (url.pathname === "/health" && req.method === "GET") {
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ status: "ok", version: "0.1.0" }));
		return;
	}

	if (url.pathname === "/chat" && req.method === "POST") {
		if (!authenticate(req)) {
			res.statusCode = 401;
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}
		await handleChat(req, res);
		return;
	}

	if (url.pathname === "/undo-history" && req.method === "GET") {
		if (!authenticate(req)) {
			res.statusCode = 401;
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}
		await handleUndoHistory(res);
		return;
	}

	if (url.pathname === "/undo" && req.method === "POST") {
		if (!authenticate(req)) {
			res.statusCode = 401;
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}
		await handleUndo(req, res);
		return;
	}

	if (url.pathname === "/rewind" && req.method === "POST") {
		if (!authenticate(req)) {
			res.statusCode = 401;
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}
		await handleRewind(req, res);
		return;
	}

	if (url.pathname === "/session-history" && req.method === "GET") {
		if (!authenticate(req)) {
			res.statusCode = 401;
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}
		await handleSessionHistory(url, res);
		return;
	}

	const taskMatch = url.pathname.match(/^\/task\/([a-f0-9-]+)$/);
	if (taskMatch && req.method === "GET") {
		if (!authenticate(req)) {
			res.statusCode = 401;
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}
		const task = tasks.get(taskMatch[1]);
		if (!task) {
			res.statusCode = 404;
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify({ error: "Task not found" }));
			return;
		}
		const after = parseInt(url.searchParams.get("after") || "0", 10);
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({
			status: task.status,
			chunks: task.chunks.slice(after),
			result: task.result,
			sessionId: task.sessionId,
			error: task.error,
		}));
		return;
	}

	res.statusCode = 404;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify({ error: "Not found" }));
});

async function handleUndoHistory(res: ServerResponse): Promise<void> {
	res.setHeader("Content-Type", "application/json");
	if (!UNDO_STACK_FILE) {
		res.end(JSON.stringify([]));
		return;
	}
	try {
		const raw = await readFile(UNDO_STACK_FILE, "utf-8");
		const stack = JSON.parse(raw);
		// return last 10, newest first, without previousContent (too large)
		const summary = stack.slice(-10).reverse().map((e: Record<string, unknown>) => ({
			id: e.id,
			timestamp: e.timestamp,
			operation: e.operation,
			path: e.path,
			oldPath: e.oldPath,
		}));
		res.end(JSON.stringify(summary));
	} catch {
		res.end(JSON.stringify([]));
	}
}

async function handleUndo(req: IncomingMessage, res: ServerResponse): Promise<void> {
	res.setHeader("Content-Type", "application/json");
	if (!UNDO_STACK_FILE || !VAULT_PATH) {
		res.statusCode = 400;
		res.end(JSON.stringify({ error: "VAULT_PATH not configured" }));
		return;
	}

	let body: { id?: string } = {};
	try {
		body = await readBody<{ id?: string }>(req);
	} catch { /* use empty */ }

	try {
		const raw = await readFile(UNDO_STACK_FILE, "utf-8");
		const stack: Array<Record<string, unknown>> = JSON.parse(raw);

		// find entry to undo (by id, or last entry)
		const idx = body.id
			? stack.findIndex((e) => e.id === body.id)
			: stack.length - 1;

		if (idx === -1) {
			res.statusCode = 404;
			res.end(JSON.stringify({ error: "Entry not found" }));
			return;
		}

		const entry = stack[idx];
		const filePath = resolve(VAULT_PATH, entry.path as string);

		switch (entry.operation) {
			case "edit_note":
			case "append_to_note":
			case "update_frontmatter":
				await writeFile(filePath, entry.previousContent as string, "utf-8");
				break;
			case "create_note":
				const { unlink } = await import("fs/promises");
				await unlink(filePath);
				break;
			case "delete_note": {
				const dir = resolve(filePath, "..");
				await mkdir(dir, { recursive: true });
				await writeFile(filePath, entry.previousContent as string, "utf-8");
				break;
			}
			case "rename_note": {
				const { rename } = await import("fs/promises");
				const oldAbs = resolve(VAULT_PATH, entry.oldPath as string);
				await mkdir(resolve(oldAbs, ".."), { recursive: true });
				await rename(filePath, oldAbs);
				break;
			}
			default:
				res.statusCode = 400;
				res.end(JSON.stringify({ error: `Unknown operation: ${entry.operation}` }));
				return;
		}

		// remove entry from stack
		stack.splice(idx, 1);
		await writeFile(UNDO_STACK_FILE, JSON.stringify(stack, null, 2), "utf-8");

		res.end(JSON.stringify({ ok: true, operation: entry.operation, path: entry.path }));
	} catch (e) {
		res.statusCode = 500;
		res.end(JSON.stringify({ error: String(e) }));
	}
}

async function handleRewind(req: IncomingMessage, res: ServerResponse): Promise<void> {
	res.setHeader("Content-Type", "application/json");

	let body: { sessionId?: string; count?: number } = {};
	try {
		body = await readBody<{ sessionId?: string; count?: number }>(req);
	} catch { /* use empty */ }

	if (!body.sessionId) {
		res.statusCode = 400;
		res.end(JSON.stringify({ error: "sessionId is required" }));
		return;
	}

	const rewindCount = Math.max(1, body.count ?? 1);

	const home = process.env.HOME || process.env.USERPROFILE || "";
	const projectsDir = resolve(home, ".claude", "projects");
	const filename = `${body.sessionId}.jsonl`;

	let jsonlPath = "";
	try {
		const { readdirSync, existsSync } = await import("fs");
		for (const dir of readdirSync(projectsDir)) {
			const candidate = resolve(projectsDir, dir, filename);
			if (existsSync(candidate)) { jsonlPath = candidate; break; }
		}
	} catch { /* fall through */ }

	if (!jsonlPath) {
		res.statusCode = 404;
		res.end(JSON.stringify({ error: "Session not found" }));
		return;
	}

	try {
		const raw = await readFile(jsonlPath, "utf-8");
		const lines = raw.split("\n").filter((l) => l.trim());
		if (lines.length === 0) {
			res.statusCode = 404;
			res.end(JSON.stringify({ error: "Empty session" }));
			return;
		}

		// Find the Nth user message from the end (skipping tool_result messages)
		let targetUserIdx = -1;
		let found = 0;
		for (let i = lines.length - 1; i >= 0; i--) {
			try {
				const obj = JSON.parse(lines[i]);
				if (obj.type !== "user") continue;
				const content = obj.message?.content;
				const isToolResult = Array.isArray(content) &&
					content.some((b: Record<string, unknown>) => b.type === "tool_result");
				if (!isToolResult) {
					found++;
					if (found >= rewindCount) {
						targetUserIdx = i;
						break;
					}
				}
			} catch { /* skip */ }
		}

		if (targetUserIdx <= 0) {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: "Nothing to rewind" }));
			return;
		}

		let cutIdx = targetUserIdx;
		for (let i = targetUserIdx - 1; i >= 0; i--) {
			try {
				const obj = JSON.parse(lines[i]);
				if (obj.type === "queue-operation" || obj.type === "mode") {
					cutIdx = i;
				} else {
					break;
				}
			} catch { break; }
		}

		const truncated = lines.slice(0, cutIdx).join("\n") + "\n";
		await writeFile(jsonlPath, truncated, "utf-8");
		res.end(JSON.stringify({ ok: true, removedLines: lines.length - cutIdx }));
	} catch (e) {
		res.statusCode = 500;
		res.end(JSON.stringify({ error: String(e) }));
	}
}

async function handleSessionHistory(url: URL, res: ServerResponse): Promise<void> {
	res.setHeader("Content-Type", "application/json");

	const sessionId = url.searchParams.get("sessionId");
	if (!sessionId) {
		res.statusCode = 400;
		res.end(JSON.stringify({ error: "sessionId is required" }));
		return;
	}

	const home = process.env.HOME || process.env.USERPROFILE || "";
	const projectsDir = resolve(home, ".claude", "projects");
	const filename = `${sessionId}.jsonl`;

	let jsonlPath = "";
	try {
		const { readdirSync, existsSync } = await import("fs");
		for (const dir of readdirSync(projectsDir)) {
			const candidate = resolve(projectsDir, dir, filename);
			if (existsSync(candidate)) { jsonlPath = candidate; break; }
		}
	} catch { /* fall through */ }

	if (!jsonlPath) {
		res.statusCode = 404;
		res.end(JSON.stringify({ error: "Session not found" }));
		return;
	}

	try {
		const raw = await readFile(jsonlPath, "utf-8");
		const lines = raw.split("\n").filter((l) => l.trim());
		const messages: { role: string; content: string }[] = [];

		for (const line of lines) {
			try {
				const obj = JSON.parse(line);
				if (obj.type === "user") {
					const content = obj.message?.content;
					if (typeof content === "string" && content.trim()) {
						messages.push({ role: "user", content });
					}
				} else if (obj.type === "assistant" || obj.type === "ASSISTANT") {
					const blocks = obj.message?.content;
					if (Array.isArray(blocks)) {
						const texts: string[] = [];
						for (const b of blocks) {
							if (b?.type === "text" && b.text) texts.push(b.text);
						}
						if (texts.length > 0) {
							messages.push({ role: "assistant", content: texts.join("\n") });
						}
					}
				}
			} catch { /* skip corrupt line */ }
		}

		res.end(JSON.stringify({ messages, turnCount: messages.length }));
	} catch (e) {
		res.statusCode = 500;
		res.end(JSON.stringify({ error: String(e) }));
	}
}

function authenticate(req: IncomingMessage): boolean {
	const auth = req.headers.authorization;
	if (!auth) return false;
	const token = auth.replace(/^Bearer\s+/i, "");
	return token === AUTH_TOKEN;
}

// ── Session seed (construct JSONL from history) ─────────────────────

function cwdToProjectDir(): string {
	const cwd = VAULT_PATH || process.env.HOME || "/";
	return cwd.replace(/[\/ ]/g, "-");
}

async function seedSession(
	sessionId: string,
	history: { role: string; content: string }[],
	systemPrompt?: string,
): Promise<void> {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const dir = resolve(home, ".claude", "projects", cwdToProjectDir());
	await mkdir(dir, { recursive: true });

	const cwd = VAULT_PATH || process.env.HOME || "/";
	const now = new Date().toISOString();
	const lines: string[] = [];

	let parentUuid: string | null = null;

	for (const msg of history) {
		const uuid = randomUUID();
		if (msg.role === "user") {
			lines.push(JSON.stringify({
				type: "user",
				message: { role: "user", content: msg.content },
				uuid,
				parentUuid: parentUuid,
				isSidechain: false,
				timestamp: now,
				sessionId,
				cwd,
			}));
		} else {
			lines.push(JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: msg.content }],
					model: CLAUDE_MODEL,
					type: "message",
					id: `msg_seed_${uuid.slice(0, 12)}`,
					stop_reason: "end_turn",
				},
				uuid,
				parentUuid: parentUuid,
				isSidechain: false,
				timestamp: now,
				sessionId,
				cwd,
			}));
		}
		parentUuid = uuid;
	}

	if (parentUuid) {
		lines.push(JSON.stringify({
			type: "last-prompt",
			lastPrompt: history.filter(m => m.role === "user").pop()?.content ?? "",
			leafUuid: parentUuid,
			sessionId,
		}));
	}

	await writeFile(resolve(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n", "utf-8");
	console.log(`[Proxy] Seeded session ${sessionId} with ${history.length} messages`);
}

// ── Chat handler ───────────────────────────────────────────────────

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
	let body: ChatRequest;
	try {
		body = await readBody<ChatRequest>(req);
	} catch {
		res.statusCode = 400;
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ error: "Invalid JSON body" }));
		return;
	}

	if (!body.message) {
		res.statusCode = 400;
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ error: "message is required" }));
		return;
	}

	if (body.history?.length && !body.sessionId) {
		const seededId = randomUUID();
		try {
			await seedSession(seededId, body.history, body.systemPrompt);
			body.sessionId = seededId;
		} catch (e) {
			console.error("[Proxy] Failed to seed session:", e);
		}
	}

	const taskId = randomUUID();
	const task: TaskState = { status: "running", chunks: [], createdAt: Date.now() };
	tasks.set(taskId, task);

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no");
	res.flushHeaders();

	let clientDisconnected = false;

	const sendEvent = (data: Record<string, unknown>) => {
		if (!clientDisconnected && !res.writableEnded) {
			res.write(`data: ${JSON.stringify(data)}\n\n`);
		}
	};

	sendEvent({ type: "task_id", taskId });

	const args = buildClaudeArgs(body);

	let proc: ChildProcess;
	try {
		proc = spawn(CLAUDE_PATH, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, FORCE_COLOR: "0" },
			cwd: VAULT_PATH || process.env.HOME || undefined,
		});
	} catch (e) {
		task.status = "error";
		task.error = `Failed to spawn claude: ${e}`;
		sendEvent({ type: "error", message: task.error });
		res.end();
		return;
	}

	const timeout = setTimeout(() => {
		console.warn(`[Proxy] Task ${taskId} timed out, killing process`);
		proc.kill("SIGTERM");
		if (task.status === "running") {
			task.status = "error";
			task.error = "Task timed out";
		}
	}, TASK_TIMEOUT_MS);

	let lastText = "";
	let sessionId = body.sessionId || "";

	const rl = createInterface({ input: proc.stdout! });

	rl.on("line", (line: string) => {
		if (!line.trim()) return;

		let event: ClaudeStreamEvent;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}

		if (event.type === "system" && event.subtype === "init") {
			const mcpServers = (event as Record<string, unknown>).mcp_servers;
			if (Array.isArray(mcpServers)) {
				const failed = mcpServers.filter((s: Record<string, unknown>) => s.status !== "connected" && s.status !== "needs-auth");
				if (failed.length > 0) {
					sendEvent({ type: "mcp_status", servers: mcpServers });
				}
			}
		} else if (event.type === "assistant" && event.message?.content) {
			for (const block of event.message.content) {
				if (block.type === "text" && block.text) {
					const delta = block.text.slice(lastText.length);
					if (delta) {
						lastText = block.text;
						task.chunks.push(delta);
						sendEvent({ type: "text", content: delta });
					}
				} else if (block.type === "tool_use") {
					sendEvent({
						type: "tool_use",
						name: block.name,
						input: block.input,
					});
				}
			}
		} else if (event.type === "result") {
			sessionId = event.session_id || sessionId;
			task.status = "done";
			task.result = event.result || lastText;
			task.sessionId = sessionId;
			sendEvent({
				type: "done",
				result: task.result,
				sessionId,
			});
		}
	});

	let stderrOutput = "";
	proc.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		stderrOutput += text;
		for (const line of text.split("\n")) {
			if (line.includes("[MCP]") || line.includes("permission")) {
				sendEvent({ type: "debug", message: line.trim() });
			}
		}
	});

	req.on("close", () => {
		clientDisconnected = true;
		if (!res.writableEnded) res.end();
	});

	proc.on("close", (code) => {
		clearTimeout(timeout);
		if (task.status === "running") {
			task.status = "error";
			task.error = `claude exited with code ${code}: ${stderrOutput.slice(0, 500)}`;
		}
		if (code !== 0) {
			sendEvent({
				type: "error",
				message: `claude exited with code ${code}: ${stderrOutput.slice(0, 500)}`,
			});
		}
		if (!res.writableEnded) {
			res.end();
		}
	});

	proc.on("error", (err) => {
		clearTimeout(timeout);
		task.status = "error";
		task.error = `spawn error: ${err.message}`;
		sendEvent({ type: "error", message: task.error });
		if (!res.writableEnded) {
			res.end();
		}
	});
}

function buildClaudeArgs(body: ChatRequest): string[] {
	const args: string[] = [
		"-p", body.message,
		"--output-format", "stream-json",
		"--verbose",
		"--include-partial-messages",
		"--permission-mode", "bypassPermissions",
		"--tools", "WebSearch,WebFetch,TodoWrite",
		"--mcp-config", MCP_CONFIG,
		"--model", CLAUDE_MODEL,
	];

	if (body.sessionId) {
		args.push("--resume", body.sessionId);
	}

	if (body.systemPrompt && !body.sessionId) {
		args.push("--system-prompt", body.systemPrompt);
	}

	return args;
}

// ── Helpers ────────────────────────────────────────────────────────

function readBody<T>(req: IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			try {
				const text = Buffer.concat(chunks).toString("utf-8");
				resolve(text ? JSON.parse(text) : {});
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}

// ── Start ──────────────────────────────────────────────────────────

server.listen(PORT, "0.0.0.0", () => {
	console.log(`[Proxy] Listening on 0.0.0.0:${PORT}`);
	console.log(`[Proxy] Claude model: ${CLAUDE_MODEL}`);
	console.log(`[Proxy] MCP config: ${MCP_CONFIG}`);
});
