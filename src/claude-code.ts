import { Platform } from "obsidian";
import { ChildProcess } from "child_process";

declare const __MCP_SERVER_CODE__: string | undefined;

let cachedClaudePath: string | false | null = null;
let cachedNodePath: string | null = null;
let cachedMcpServerPath: string | null = null;

export function getMcpServerPath(): string {
	if (cachedMcpServerPath) return cachedMcpServerPath;

	const { writeFileSync, mkdirSync, existsSync } = require("fs") as typeof import("fs");
	const { join } = require("path") as typeof import("path");
	const tmpDir = join(process.env.TMPDIR || "/tmp", "ai-daily-mcp");
	try { mkdirSync(tmpDir, { recursive: true }); } catch { /* exists */ }
	const serverPath = join(tmpDir, "mcp-server.js");

	if (typeof __MCP_SERVER_CODE__ === "string" && __MCP_SERVER_CODE__.length > 0) {
		writeFileSync(serverPath, __MCP_SERVER_CODE__);
		cachedMcpServerPath = serverPath;
		return serverPath;
	}

	// Fallback: try to find mcp-server.js alongside the plugin
	return serverPath;
}

// ---------------------------------------------------------------------------
// NVM alias resolution (filesystem-based, no env vars needed in Electron)
// ---------------------------------------------------------------------------

const MIN_NODE_MAJOR = 18;

function nodeMajorVersion(versionDir: string): number {
	const m = versionDir.match(/^v(\d+)/);
	return m ? parseInt(m[1], 10) : 0;
}

function resolveNvmNodeBin(home: string): string | null {
	const { existsSync, readFileSync, readdirSync } = require("fs") as typeof import("fs");
	const nvmDir = process.env.NVM_DIR || `${home}/.nvm`;

	// Fast path: symlinked current (verify version is new enough)
	const current = `${nvmDir}/current/bin`;
	if (existsSync(current)) {
		try {
			const target = require("fs").readlinkSync(`${nvmDir}/current`);
			if (nodeMajorVersion(require("path").basename(target)) >= MIN_NODE_MAJOR) {
				return current;
			}
		} catch {
			return current;
		}
	}

	// Read alias/default and resolve the chain (up to 5 levels, matching Claudian)
	const aliasDir = `${nvmDir}/alias`;
	const versionsDir = `${nvmDir}/versions/node`;
	if (!existsSync(versionsDir)) return null;

	let target = "default";
	const seen = new Set<string>();
	for (let i = 0; i < 5; i++) {
		if (seen.has(target)) break;
		seen.add(target);

		const aliasFile = `${aliasDir}/${target}`;
		if (!existsSync(aliasFile)) break;

		target = readFileSync(aliasFile, "utf-8").trim();
		if (!target) break;
	}

	// target is now a version specifier like "22", "22.1", "v22.1.0", "node", "stable"
	if (target === "node" || target === "stable") {
		target = ""; // match latest
	}

	try {
		const installed = readdirSync(versionsDir)
			.filter((v: string) => nodeMajorVersion(v) >= MIN_NODE_MAJOR)
			.sort();
		if (installed.length === 0) return null;

		let match: string | undefined;
		if (target) {
			const prefix = target.startsWith("v") ? target : `v${target}`;
			match = installed.filter((v: string) => v.startsWith(prefix)).pop();
		}
		if (!match) match = installed.pop();

		if (match) {
			const bin = `${versionsDir}/${match}/bin`;
			if (existsSync(bin)) return bin;
		}
	} catch { /* versions dir unreadable */ }

	return null;
}

// ---------------------------------------------------------------------------
// FNM resolution
// ---------------------------------------------------------------------------

function resolveFnmNodeBin(home: string): string | null {
	const { existsSync, readdirSync, readlinkSync } = require("fs") as typeof import("fs");
	const { join } = require("path") as typeof import("path");

	// FNM uses different directories per platform
	const candidates = [
		`${home}/Library/Application Support/fnm/node-versions`,  // macOS
		`${home}/.local/share/fnm/node-versions`,                 // Linux
		`${home}/.fnm/node-versions`,                             // legacy / custom
	];

	// Check for fnm aliases/default first
	const aliasDirs = [
		`${home}/Library/Application Support/fnm/aliases`,
		`${home}/.local/share/fnm/aliases`,
		`${home}/.fnm/aliases`,
	];
	for (const aliasDir of aliasDirs) {
		const defaultAlias = join(aliasDir, "default");
		if (existsSync(defaultAlias)) {
			try {
				const resolved = readlinkSync(defaultAlias);
				const bin = join(resolved, "installation/bin");
				if (existsSync(bin)) return bin;
			} catch { /* not a symlink or broken */ }
		}
	}

	for (const dir of candidates) {
		try {
			const versions = readdirSync(dir).sort();
			if (versions.length > 0) {
				const latest = versions.pop()!;
				const bin = `${dir}/${latest}/installation/bin`;
				if (existsSync(bin)) return bin;
			}
		} catch { /* dir doesn't exist */ }
	}
	return null;
}

// ---------------------------------------------------------------------------
// Build enhanced PATH for spawning (Electron's PATH is minimal)
// ---------------------------------------------------------------------------

function buildEnhancedPath(home: string): string {
	const { existsSync } = require("fs") as typeof import("fs");

	const dirs: string[] = [];

	// Node version managers (highest priority — these are what the user likely uses)
	const nvmBin = resolveNvmNodeBin(home);
	if (nvmBin) dirs.push(nvmBin);

	const fnmBin = resolveFnmNodeBin(home);
	if (fnmBin) dirs.push(fnmBin);

	// Volta (manages node, npm, yarn, pnpm)
	const voltaBin = `${home}/.volta/bin`;
	if (existsSync(voltaBin)) dirs.push(voltaBin);

	// asdf version manager
	const asdfShims = `${home}/.asdf/shims`;
	if (existsSync(asdfShims)) dirs.push(asdfShims);

	// Common install locations
	dirs.push(
		`${home}/.local/bin`,
		`${home}/.npm-global/bin`,
		`${home}/Library/pnpm`,
		`${home}/.bun/bin`,
		"/opt/homebrew/bin",        // macOS ARM
		"/usr/local/bin",           // macOS x86 / Linux
	);

	// If the claude binary lives in a directory with node, add that too
	if (cachedClaudePath && cachedClaudePath !== "claude") {
		const { dirname } = require("path") as typeof import("path");
		const claudeDir = dirname(cachedClaudePath);
		if (!dirs.includes(claudeDir)) dirs.unshift(claudeDir);
	}

	return [...dirs, process.env.PATH || ""].join(":");
}

// ---------------------------------------------------------------------------
// Find node executable (absolute path)
// ---------------------------------------------------------------------------

function findNodeExecutable(home: string): string | null {
	const { existsSync } = require("fs") as typeof import("fs");

	if (cachedNodePath) return cachedNodePath;

	// Check well-known locations
	const nvmBin = resolveNvmNodeBin(home);
	if (nvmBin) {
		const candidate = `${nvmBin}/node`;
		if (existsSync(candidate)) { cachedNodePath = candidate; return candidate; }
	}

	const fnmBin = resolveFnmNodeBin(home);
	if (fnmBin) {
		const candidate = `${fnmBin}/node`;
		if (existsSync(candidate)) { cachedNodePath = candidate; return candidate; }
	}

	const staticPaths = [
		`${home}/.volta/bin/node`,
		`${home}/.asdf/shims/node`,
		"/opt/homebrew/bin/node",
		"/usr/local/bin/node",
		"/usr/bin/node",
	];
	for (const p of staticPaths) {
		if (existsSync(p)) { cachedNodePath = p; return p; }
	}

	return null;
}

// ---------------------------------------------------------------------------
// Find Claude CLI binary
// ---------------------------------------------------------------------------

function getClaudeSearchPaths(home: string): string[] {
	return [
		// User-level installs (most common for npm -g / pnpm)
		`${home}/.local/bin/claude`,
		`${home}/.npm-global/bin/claude`,
		`${home}/Library/pnpm/claude`,
		`${home}/.pnpm-global/bin/claude`,
		// Version managers
		`${home}/.volta/bin/claude`,
		`${home}/.asdf/shims/claude`,
		`${home}/.bun/bin/claude`,
		// NVM-managed
		...(resolveNvmNodeBin(home) ? [`${resolveNvmNodeBin(home)}/claude`] : []),
		// System-wide
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude",
		"/usr/bin/claude",
	];
}

async function findClaudeBinary(): Promise<string | false> {
	const { existsSync } = require("fs") as typeof import("fs");
	const { execFile } = require("child_process") as typeof import("child_process");
	const home = process.env.HOME || process.env.USERPROFILE || "";

	const candidates = getClaudeSearchPaths(home);
	for (const p of candidates) {
		if (existsSync(p)) {
			console.log(`[ai-daily] found claude at: ${p}`);
			return p;
		}
	}

	// Fallback: try enhanced PATH (covers edge cases)
	const enhancedPath = home ? buildEnhancedPath(home) : process.env.PATH || "";
	return new Promise<string | false>((resolve) => {
		execFile("claude", ["--version"], {
			timeout: 5000,
			env: { ...process.env, PATH: enhancedPath },
		}, (err: Error | null) => {
			if (!err) {
				console.log("[ai-daily] found claude via enhanced PATH");
				resolve("claude");
			} else {
				console.log("[ai-daily] claude not found");
				resolve(false);
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Public API: detection & cache
// ---------------------------------------------------------------------------

export async function isClaudeCodeAvailable(): Promise<boolean> {
	if (Platform.isMobile) return false;
	if (cachedClaudePath !== null) return cachedClaudePath !== false;

	try {
		cachedClaudePath = await findClaudeBinary();
		console.log("[ai-daily] claude detection result:", cachedClaudePath);
		return cachedClaudePath !== false;
	} catch (e) {
		console.error("[ai-daily] claude detection error:", e);
		cachedClaudePath = false;
		return false;
	}
}

export function getClaudePath(): string {
	return cachedClaudePath || "claude";
}

export function resetClaudeCodeCache(): void {
	cachedClaudePath = null;
	cachedNodePath = null;
}

// ---------------------------------------------------------------------------
// Stream callbacks & options
// ---------------------------------------------------------------------------

export interface ClaudeCodeStreamCallbacks {
	onText: (delta: string) => void;
	onToolCall?: (name: string, input: Record<string, unknown>, status: "running" | "done" | "error") => void;
	onError: (error: string) => void;
	onDone: (fullText: string) => void;
	onSessionId?: (id: string) => void;
}

export interface ClaudeCodeOptions {
	mcpConfig: { vaultPath: string; mcpServerPath: string; knowledgeFolders: string[] };
	sessionId?: string;
}

// ---------------------------------------------------------------------------
// Spawn Claude Code
// ---------------------------------------------------------------------------

export function spawnClaudeCode(
	prompt: string,
	options: ClaudeCodeOptions,
	callbacks: ClaudeCodeStreamCallbacks
): { abort: () => void } {
	const { spawn } = require("child_process") as typeof import("child_process");
	const { mcpConfig, sessionId } = options;
	const home = process.env.HOME || process.env.USERPROFILE || "";

	// Resolve node to absolute path for MCP server command
	const nodeBin = findNodeExecutable(home) || "node";

	// Build MCP config as JSON for --mcp-config
	const { writeFileSync, mkdirSync, unlinkSync } = require("fs") as typeof import("fs");
	const { join } = require("path") as typeof import("path");
	const tmpDir = join(process.env.TMPDIR || "/tmp", "ai-daily-mcp");
	try { mkdirSync(tmpDir, { recursive: true }); } catch { /* exists */ }
	const mcpConfigPath = join(tmpDir, `mcp-${Date.now()}.json`);
	const mcpConfigJson = {
		mcpServers: {
			"obsidian-vault": {
				command: nodeBin,
				args: [mcpConfig.mcpServerPath],
				env: {
					VAULT_PATH: mcpConfig.vaultPath,
					KNOWLEDGE_FOLDERS: mcpConfig.knowledgeFolders.join(","),
				},
			},
		},
	};
	const mcpJsonStr = JSON.stringify(mcpConfigJson, null, 2);
	writeFileSync(mcpConfigPath, mcpJsonStr);
	console.log("[ai-daily] MCP config path:", mcpConfigPath);
	console.log("[ai-daily] MCP config:", mcpJsonStr);
	console.log("[ai-daily] node binary:", nodeBin);
	console.log("[ai-daily] MCP server path:", mcpConfig.mcpServerPath);

	// Verify MCP server file exists
	const { existsSync } = require("fs") as typeof import("fs");
	if (!existsSync(mcpConfig.mcpServerPath)) {
		console.error("[ai-daily] MCP server file NOT FOUND:", mcpConfig.mcpServerPath);
	}

	const args = [
		"-p", prompt,
		"--output-format", "stream-json",
		"--verbose",
		"--permission-mode", "bypassPermissions",
		"--tools", "ReadFile,Grep,Glob,WebSearch,WebFetch,TodoWrite",
		"--mcp-config", mcpConfigPath,
	];
	if (sessionId) {
		args.push("--resume", sessionId);
	}

	const claudeBin = getClaudePath();
	console.log("[ai-daily] spawn:", claudeBin, args.filter(a => a !== prompt).join(" "));
	const env = { ...process.env };
	if (home) {
		env.PATH = buildEnhancedPath(home);
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
		try { unlinkSync(mcpConfigPath); } catch { /* best-effort cleanup */ }

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

// ---------------------------------------------------------------------------
// Stream event parsing
// ---------------------------------------------------------------------------

const pendingTools = new Map<string, string>();

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
						const input = (b.input as Record<string, unknown>) || {};
						const id = b.id as string | undefined;
						if (id) pendingTools.set(id, b.name);
						callbacks.onToolCall?.(b.name, input, "running");
					}
				}
			}
			const sid = event.session_id as string | undefined;
			if (sid) callbacks.onSessionId?.(sid);
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
			pendingTools.clear();
			break;
		}
	}

	// Handle tool_result from user messages (tool completion)
	if (type === "user") {
		const msg = event.message as Record<string, unknown> | undefined;
		if (msg?.content && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				const b = block as Record<string, unknown>;
				if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
					const toolName = pendingTools.get(b.tool_use_id);
					if (toolName) {
						const isError = b.is_error === true;
						callbacks.onToolCall?.(toolName, {}, isError ? "error" : "done");
						pendingTools.delete(b.tool_use_id);
					}
				}
			}
		}
	}
}
