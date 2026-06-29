import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFile, writeFile, mkdir } from "fs/promises";

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

	let body: { sessionId?: string } = {};
	try {
		body = await readBody<{ sessionId?: string }>(req);
	} catch { /* use empty */ }

	if (!body.sessionId) {
		res.statusCode = 400;
		res.end(JSON.stringify({ error: "sessionId is required" }));
		return;
	}

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

		let lastUserIdx = -1;
		for (let i = lines.length - 1; i >= 0; i--) {
			try {
				const obj = JSON.parse(lines[i]);
				if (obj.type !== "user") continue;
				const content = obj.message?.content;
				const isToolResult = Array.isArray(content) &&
					content.some((b: Record<string, unknown>) => b.type === "tool_result");
				if (!isToolResult) {
					lastUserIdx = i;
					break;
				}
			} catch { /* skip */ }
		}

		if (lastUserIdx <= 0) {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: "Nothing to rewind" }));
			return;
		}

		let cutIdx = lastUserIdx;
		for (let i = lastUserIdx - 1; i >= 0; i--) {
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

function authenticate(req: IncomingMessage): boolean {
	const auth = req.headers.authorization;
	if (!auth) return false;
	const token = auth.replace(/^Bearer\s+/i, "");
	return token === AUTH_TOKEN;
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

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");

	const sendEvent = (data: Record<string, unknown>) => {
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	const args = buildClaudeArgs(body);

	let proc: ChildProcess;
	try {
		proc = spawn(CLAUDE_PATH, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, FORCE_COLOR: "0" },
		});
	} catch (e) {
		sendEvent({ type: "error", message: `Failed to spawn claude: ${e}` });
		res.end();
		return;
	}

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
			sendEvent({
				type: "done",
				result: event.result || lastText,
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
		proc.kill("SIGTERM");
	});

	proc.on("close", (code) => {
		if (code !== 0 && !res.writableEnded) {
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
		if (!res.writableEnded) {
			sendEvent({ type: "error", message: `spawn error: ${err.message}` });
			res.end();
		}
	});
}

function buildClaudeArgs(body: ChatRequest): string[] {
	const args: string[] = [];

	if (body.sessionId) {
		args.push("-r", body.sessionId);
	}

	args.push("-p", body.message);
	args.push("--output-format", "stream-json");
	args.push("--verbose");
	args.push("--model", CLAUDE_MODEL);
	args.push("--mcp-config", MCP_CONFIG);
	args.push("--dangerously-skip-permissions");

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
