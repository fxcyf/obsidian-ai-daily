import { Platform } from "obsidian";
import { ChildProcess } from "child_process";
import { getMcpServerPath } from "./claude-code";
import type { ClaudeCodeStreamCallbacks, ClaudeCodeOptions } from "./claude-code";

let cachedCodexPath: string | false | null = null;

function getCodexSearchPaths(home: string): string[] {
	return [
		`${home}/.local/bin/codex`,
		`${home}/.npm-global/bin/codex`,
		`${home}/.cargo/bin/codex`,
		`${home}/.volta/bin/codex`,
		"/usr/local/bin/codex",
		"/usr/bin/codex",
		"/opt/homebrew/bin/codex",
	];
}

async function findCodexBinary(): Promise<string | false> {
	const { existsSync } = require("fs") as typeof import("fs");
	const { execFile } = require("child_process") as typeof import("child_process");
	const home = process.env.HOME || process.env.USERPROFILE || "";

	for (const p of getCodexSearchPaths(home)) {
		if (existsSync(p)) {
			console.log(`[ai-daily] found codex at: ${p}`);
			return p;
		}
	}

	return new Promise<string | false>((resolve) => {
		execFile("codex", ["--version"], {
			timeout: 5000,
		}, (err: Error | null) => {
			if (!err) {
				console.log("[ai-daily] found codex via PATH");
				resolve("codex");
			} else {
				console.log("[ai-daily] codex not found");
				resolve(false);
			}
		});
	});
}

export async function isCodexAvailable(): Promise<boolean> {
	if (Platform.isMobile) return false;
	if (cachedCodexPath !== null) return cachedCodexPath !== false;

	try {
		cachedCodexPath = await findCodexBinary();
		console.log("[ai-daily] codex detection result:", cachedCodexPath);
		return cachedCodexPath !== false;
	} catch (e) {
		console.error("[ai-daily] codex detection error:", e);
		cachedCodexPath = false;
		return false;
	}
}

export function getCodexPath(): string {
	return cachedCodexPath || "codex";
}

// ---------------------------------------------------------------------------
// Ensure MCP server is registered in Codex config
// ---------------------------------------------------------------------------

export function ensureCodexMcp(config: {
	mcpServerPath: string;
	vaultPath: string;
	knowledgeFolders: string[];
	wereadApiKey?: string;
	nodeBin: string;
}): void {
	const { execFileSync } = require("child_process") as typeof import("child_process");
	const codexBin = getCodexPath();

	try {
		execFileSync(codexBin, ["mcp", "remove", "obsidian-vault"], {
			timeout: 5000,
			stdio: "ignore",
		});
	} catch { /* may not exist yet */ }

	const args = [
		"mcp", "add",
		"--env", `VAULT_PATH=${config.vaultPath}`,
		"--env", `KNOWLEDGE_FOLDERS=${config.knowledgeFolders.join(",")}`,
	];
	if (config.wereadApiKey) {
		args.push("--env", `WEREAD_API_KEY=${config.wereadApiKey}`);
	}
	args.push("obsidian-vault", "--", config.nodeBin, config.mcpServerPath);

	execFileSync(codexBin, args, { timeout: 10000, stdio: "ignore" });
	console.log("[ai-daily] Codex MCP server registered");
}

// ---------------------------------------------------------------------------
// Find node (reuse logic from claude-code but simpler)
// ---------------------------------------------------------------------------

function findNodeBin(): string {
	const { existsSync } = require("fs") as typeof import("fs");
	const home = process.env.HOME || process.env.USERPROFILE || "";

	const candidates = [
		`${home}/.nvm/current/bin/node`,
		`${home}/.volta/bin/node`,
		"/opt/homebrew/bin/node",
		"/usr/local/bin/node",
		"/usr/bin/node",
	];
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}
	return "node";
}

// ---------------------------------------------------------------------------
// Spawn Codex
// ---------------------------------------------------------------------------

export function spawnCodex(
	prompt: string,
	options: ClaudeCodeOptions,
	callbacks: ClaudeCodeStreamCallbacks
): { abort: () => void } {
	const { spawn } = require("child_process") as typeof import("child_process");
	const { mcpConfig, sessionId, model } = options;

	const nodeBin = findNodeBin();
	ensureCodexMcp({
		mcpServerPath: mcpConfig.mcpServerPath,
		vaultPath: mcpConfig.vaultPath,
		knowledgeFolders: mcpConfig.knowledgeFolders,
		wereadApiKey: mcpConfig.wereadApiKey,
		nodeBin,
	});

	let args: string[];
	if (sessionId) {
		args = [
			"exec", "resume", sessionId, prompt,
			"--json",
			"--dangerously-bypass-approvals-and-sandbox",
			"--sandbox", "danger-full-access",
		];
	} else {
		args = [
			"exec", prompt,
			"--json",
			"--dangerously-bypass-approvals-and-sandbox",
			"--sandbox", "danger-full-access",
		];
	}

	if (model) {
		args.push("-m", model);
	}

	const codexBin = getCodexPath();
	console.log("[ai-daily] spawn codex:", codexBin, args.filter(a => a !== prompt).join(" "));

	let child: ChildProcess;
	try {
		child = spawn(codexBin, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
			cwd: mcpConfig.vaultPath || undefined,
		});
	} catch (e) {
		callbacks.onError(`Failed to spawn codex: ${e instanceof Error ? e.message : String(e)}`);
		return { abort: () => {} };
	}

	let fullText = "";
	let buffer = "";

	child.stdout?.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf-8");

		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line);
				handleCodexStreamEvent(event, callbacks, (t) => { fullText += t; });
			} catch {
				callbacks.onText(line);
				fullText += line;
			}
		}
	});

	child.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString("utf-8").trim();
		if (text) console.warn("[ai-daily] codex stderr:", text);
	});

	child.on("close", (code: number | null) => {
		if (buffer.trim()) {
			try {
				const event = JSON.parse(buffer);
				handleCodexStreamEvent(event, callbacks, (t) => { fullText += t; });
			} catch {
				callbacks.onText(buffer);
				fullText += buffer;
			}
		}

		if (code !== 0 && code !== null && !fullText) {
			callbacks.onError(`Codex exited with code ${code}`);
		} else {
			callbacks.onDone(fullText);
		}
	});

	child.on("error", (err: Error) => {
		callbacks.onError(`Codex error: ${err.message}`);
	});

	return {
		abort: () => {
			child.kill("SIGTERM");
		},
	};
}

// ---------------------------------------------------------------------------
// Codex JSONL stream event parsing
// ---------------------------------------------------------------------------

function handleCodexStreamEvent(
	event: Record<string, unknown>,
	callbacks: ClaudeCodeStreamCallbacks,
	appendText: (t: string) => void
): void {
	const type = event.type as string | undefined;

	switch (type) {
		case "thread.started": {
			const threadId = event.thread_id as string | undefined;
			if (threadId) callbacks.onSessionId?.(threadId);
			break;
		}
		case "item.started": {
			const item = event.item as Record<string, unknown> | undefined;
			if (!item) break;
			if (item.type === "command_execution") {
				const id = (item.id as string) || `tool-${Date.now()}`;
				const cmd = (item.command as string) || "";
				callbacks.onToolCall?.(id, "shell", { command: cmd }, "running");
			} else if (item.type === "mcp_tool_call") {
				const id = (item.id as string) || `tool-${Date.now()}`;
				const name = (item.name as string) || (item.tool as string) || "mcp_tool";
				const input = (item.arguments as Record<string, unknown>) || {};
				callbacks.onToolCall?.(id, name, input, "running");
			}
			break;
		}
		case "item.completed": {
			const item = event.item as Record<string, unknown> | undefined;
			if (!item) break;
			if (item.type === "command_execution") {
				const id = (item.id as string) || "";
				const output = (item.aggregated_output as string) || "";
				const exitCode = item.exit_code as number | null;
				const isError = exitCode !== null && exitCode !== 0;
				callbacks.onToolCall?.(id, "shell", {}, isError ? "error" : "done");
				if (output) callbacks.onToolResult?.(id, output, isError);
			} else if (item.type === "mcp_tool_call") {
				const id = (item.id as string) || "";
				const output = (item.output as string) || JSON.stringify(item.result ?? "");
				const isError = item.status === "failed";
				const name = (item.name as string) || (item.tool as string) || "mcp_tool";
				callbacks.onToolCall?.(id, name, {}, isError ? "error" : "done");
				if (output) callbacks.onToolResult?.(id, output, isError);
			} else if (item.type === "agent_message") {
				const text = (item.text as string) || "";
				if (text) {
					callbacks.onText(text);
					appendText(text);
				}
			} else if (item.type === "reasoning") {
				const text = (item.text as string) || "";
				if (text) callbacks.onThinking?.(text);
			} else if (item.type === "error") {
				const msg = (item.message as string) || "Unknown error";
				console.warn("[ai-daily] codex item error:", msg);
			}
			break;
		}
		case "turn.completed": {
			break;
		}
		case "turn.failed": {
			const error = event.error as Record<string, unknown> | undefined;
			const msg = (error?.message as string) || "Codex turn failed";
			callbacks.onError(msg);
			break;
		}
		case "error": {
			const msg = (event.message as string) || "Codex error";
			callbacks.onError(msg);
			break;
		}
	}
}
