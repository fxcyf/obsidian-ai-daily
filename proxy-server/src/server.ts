import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Config ─────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "27090", 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const MCP_CONFIG = process.env.MCP_CONFIG || resolve(dirname(fileURLToPath(import.meta.url)), "../mcp-config.json");
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

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

	if (req.method === "OPTIONS") {
		res.statusCode = 204;
		res.end();
		return;
	}

	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

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

	res.statusCode = 404;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify({ error: "Not found" }));
});

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

		if (event.type === "assistant" && event.message?.content) {
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
		stderrOutput += chunk.toString();
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
