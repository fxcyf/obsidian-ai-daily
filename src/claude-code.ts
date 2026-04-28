import { Platform } from "obsidian";
import { ChildProcess } from "child_process";

let cachedClaudePath: string | false | null = null;

const CLAUDE_SEARCH_PATHS = [
	"/usr/local/bin/claude",
	"/usr/bin/claude",
];

function getUserSearchPaths(): string[] {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (!home) return [];
	return [
		`${home}/.local/bin/claude`,
		`${home}/.npm-global/bin/claude`,
		`${home}/.nvm/current/bin/claude`,
		`${home}/Library/pnpm/claude`,
		`${home}/.pnpm-global/bin/claude`,
	];
}

function getNodePaths(home: string): string[] {
	const { existsSync, readdirSync } = require("fs") as typeof import("fs");
	const paths: string[] = [
		"/usr/local/bin",
		"/opt/homebrew/bin",
		`${home}/.local/bin`,
		`${home}/.npm-global/bin`,
		`${home}/Library/pnpm`,
	];

	const nvmDir = process.env.NVM_DIR || `${home}/.nvm`;
	const nvmCurrent = `${nvmDir}/current/bin`;
	if (existsSync(nvmCurrent)) {
		paths.unshift(nvmCurrent);
	} else {
		try {
			const versions = readdirSync(`${nvmDir}/versions/node`);
			if (versions.length > 0) {
				const latest = versions.sort().pop()!;
				paths.unshift(`${nvmDir}/versions/node/${latest}/bin`);
			}
		} catch { /* nvm not installed */ }
	}

	const fnmDir = `${home}/Library/Application Support/fnm/node-versions`;
	try {
		const versions = readdirSync(fnmDir);
		if (versions.length > 0) {
			const latest = versions.sort().pop()!;
			paths.unshift(`${fnmDir}/${latest}/installation/bin`);
		}
	} catch { /* fnm not installed */ }

	return paths;
}

async function findClaudeBinary(): Promise<string | false> {
	const { existsSync } = require("fs") as typeof import("fs");
	const { execFile } = require("child_process") as typeof import("child_process");

	const candidates = [...getUserSearchPaths(), ...CLAUDE_SEARCH_PATHS];
	for (const p of candidates) {
		if (existsSync(p)) {
			console.log(`[ai-daily] found claude at: ${p}`);
			return p;
		}
	}

	// fallback: try PATH
	return new Promise<string | false>((resolve) => {
		execFile("claude", ["--version"], { timeout: 5000 }, (err: Error | null) => {
			if (!err) {
				console.log("[ai-daily] found claude in PATH");
				resolve("claude");
			} else {
				console.log("[ai-daily] claude not found");
				resolve(false);
			}
		});
	});
}

export async function isClaudeCodeAvailable(): Promise<boolean> {
	console.log("[ai-daily] isClaudeCodeAvailable called, Platform.isMobile =", Platform.isMobile);
	if (Platform.isMobile) return false;
	if (cachedClaudePath !== null) {
		console.log("[ai-daily] using cached claude path:", cachedClaudePath);
		return cachedClaudePath !== false;
	}

	try {
		cachedClaudePath = await findClaudeBinary();
		console.log("[ai-daily] claude detection result:", cachedClaudePath);
		return cachedClaudePath !== false;
	} catch (e) {
		console.log("[ai-daily] claude detection error:", e);
		cachedClaudePath = false;
		return false;
	}
}

export function getClaudePath(): string {
	return cachedClaudePath || "claude";
}

export function resetClaudeCodeCache(): void {
	cachedClaudePath = null;
}

export interface ClaudeCodeStreamCallbacks {
	onText: (delta: string) => void;
	onToolCall?: (name: string, status: "running" | "done" | "error") => void;
	onError: (error: string) => void;
	onDone: (fullText: string) => void;
	onSessionId?: (id: string) => void;
}

export interface ClaudeCodeOptions {
	mcpConfig: { vaultPath: string; mcpServerPath: string; knowledgeFolders: string[] };
	sessionId?: string;
}

export function spawnClaudeCode(
	prompt: string,
	options: ClaudeCodeOptions,
	callbacks: ClaudeCodeStreamCallbacks
): { abort: () => void } {
	const { spawn } = require("child_process") as typeof import("child_process");
	const { mcpConfig, sessionId } = options;

	const mcpFlag = [
		"obsidian-vault",
		"-e", `VAULT_PATH=${mcpConfig.vaultPath}`,
		"-e", `KNOWLEDGE_FOLDERS=${mcpConfig.knowledgeFolders.join(",")}`,
		"--", "node", mcpConfig.mcpServerPath,
	].join(" ");

	const args = [
		"-p", prompt,
		"--output-format", "stream-json",
		"--mcp", mcpFlag,
	];
	if (sessionId) {
		args.push("--resume", sessionId);
	}

	const claudeBin = getClaudePath();
	const env = { ...process.env };
	const home = env.HOME || env.USERPROFILE || "";
	if (home) {
		const extraPaths = getNodePaths(home);
		env.PATH = [...extraPaths, env.PATH || ""].join(":");
	}

	let child: ChildProcess;
	try {
		child = spawn(claudeBin, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env,
		});
	} catch (e) {
		callbacks.onError(`Failed to spawn claude: ${e instanceof Error ? e.message : String(e)}`);
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
				handleStreamEvent(event, callbacks, (t) => { fullText += t; });
			} catch {
				// not JSON, treat as raw text
				callbacks.onText(line);
				fullText += line;
			}
		}
	});

	child.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString("utf-8").trim();
		if (text) console.warn("[ai-daily] claude stderr:", text);
	});

	child.on("close", (code: number | null) => {
		if (buffer.trim()) {
			try {
				const event = JSON.parse(buffer);
				handleStreamEvent(event, callbacks, (t) => { fullText += t; });
			} catch {
				callbacks.onText(buffer);
				fullText += buffer;
			}
		}

		if (code !== 0 && code !== null && !fullText) {
			callbacks.onError(`Claude Code exited with code ${code}`);
		} else {
			callbacks.onDone(fullText);
		}
	});

	child.on("error", (err: Error) => {
		callbacks.onError(`Claude Code error: ${err.message}`);
	});

	return {
		abort: () => {
			child.kill("SIGTERM");
		},
	};
}

function handleStreamEvent(
	event: Record<string, unknown>,
	callbacks: ClaudeCodeStreamCallbacks,
	appendText: (t: string) => void
): void {
	const type = event.type as string | undefined;

	switch (type) {
		case "assistant": {
			const msg = event.message as Record<string, unknown> | undefined;
			if (msg?.content && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					const b = block as Record<string, unknown>;
					if (b.type === "text" && typeof b.text === "string") {
						callbacks.onText(b.text);
						appendText(b.text);
					} else if (b.type === "tool_use" && typeof b.name === "string") {
						callbacks.onToolCall?.(b.name, "running");
					}
				}
			}
			break;
		}
		case "content_block_delta": {
			const delta = event.delta as Record<string, unknown> | undefined;
			if (delta?.type === "text_delta" && typeof delta.text === "string") {
				callbacks.onText(delta.text);
				appendText(delta.text);
			}
			break;
		}
		case "result": {
			const result = event.result as string | undefined;
			if (typeof result === "string" && result.length > 0) {
				callbacks.onText(result);
				appendText(result);
			}
			const sid = event.session_id as string | undefined;
			if (sid) callbacks.onSessionId?.(sid);
			break;
		}
	}
}
