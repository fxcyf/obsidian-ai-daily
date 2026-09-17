import { Platform } from "obsidian";
import { ChildProcess, spawn } from "child_process";
import { buildEnhancedPath, findNodeExecutable } from "./claude-code";
import type { ClaudeCodeStreamCallbacks, ClaudeCodeOptions } from "./claude-code";
import toolPolicy from "../agent-tool-policy.json";
import {
	appServerRequest,
	buildCodexHistoryItems,
	buildCodexThreadOpenRequest,
} from "./codex-app-server";

let cachedCodexPath: string | false | null = null;

export interface CodexOptions extends ClaudeCodeOptions {
	history?: { role: "user" | "assistant"; content: string }[];
	systemPrompt?: string;
}

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
// Build process-scoped MCP configuration for Codex
// ---------------------------------------------------------------------------

export function buildCodexMcpArgs(config: {
	mcpServerPath: string;
	vaultPath: string;
	knowledgeFolders: string[];
	wereadApiKey?: string;
	nodeBin: string;
}): string[] {
	const prefix = "mcp_servers.obsidian-vault";
	const args = [
		"-c", `${prefix}.enabled=true`,
		"-c", `${prefix}.command=${JSON.stringify(config.nodeBin)}`,
		"-c", `${prefix}.args=${JSON.stringify([config.mcpServerPath])}`,
		"-c", `${prefix}.env.VAULT_PATH=${JSON.stringify(config.vaultPath)}`,
		"-c", `${prefix}.env.KNOWLEDGE_FOLDERS=${JSON.stringify(config.knowledgeFolders.join(","))}`,
	];
	if (config.wereadApiKey) {
		args.push("-c", `${prefix}.env.WEREAD_API_KEY=${JSON.stringify(config.wereadApiKey)}`);
	}
	return args;
}

export function buildCodexAppServerArgs(
	mcpArgs: string[],
	enabledTools: string[],
): string[] {
	return [
		"app-server", "--stdio",
		...mcpArgs,
		"-c", 'approval_policy="never"',
		"-c", 'sandbox_mode="read-only"',
		"-c", `mcp_servers.obsidian-vault.enabled_tools=${JSON.stringify(enabledTools)}`,
		"-c", 'mcp_servers.obsidian-vault.default_tools_approval_mode="approve"',
	];
}

// ---------------------------------------------------------------------------
// Spawn Codex
// ---------------------------------------------------------------------------

export function spawnCodex(
	prompt: string,
	options: CodexOptions,
	callbacks: ClaudeCodeStreamCallbacks
): { abort: () => void } {
	const {
		mcpConfig,
		sessionId,
		history = [],
		systemPrompt,
		model,
		codexPermissionMode = "vault-write",
		codexReasoningEffort,
	} = options;
	const home = process.env.HOME || process.env.USERPROFILE || "";

	const nodeBin = findNodeExecutable(home) || "node";
	const { existsSync } = require("fs") as typeof import("fs");
	if (!existsSync(mcpConfig.mcpServerPath)) {
		callbacks.onError(`Obsidian MCP server file not found: ${mcpConfig.mcpServerPath}. Please reload or reinstall the Cortex plugin.`);
		return { abort: () => {} };
	}
	const mcpArgs = buildCodexMcpArgs({
		mcpServerPath: mcpConfig.mcpServerPath,
		vaultPath: mcpConfig.vaultPath,
		knowledgeFolders: mcpConfig.knowledgeFolders,
		wereadApiKey: mcpConfig.wereadApiKey,
		nodeBin,
	});

	const enabledTools = codexPermissionMode === "vault-write"
		? [...toolPolicy.codex.readOnlyMcp, ...toolPolicy.codex.vaultWriteMcp]
		: toolPolicy.codex.readOnlyMcp;
	const args = buildCodexAppServerArgs(mcpArgs, enabledTools);

	const codexBin = getCodexPath();
	const logArgs = args
		.map(a => a.includes(".env.WEREAD_API_KEY=") ? "mcp_servers.obsidian-vault.env.WEREAD_API_KEY=***" : a);
	console.log("[ai-daily] spawn codex:", codexBin, logArgs.join(" "));

	let child: ChildProcess;
	const env = { ...process.env };
	if (home) env.PATH = buildEnhancedPath(home);
	try {
		child = spawn(codexBin, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env,
			cwd: mcpConfig.vaultPath || undefined,
		});
	} catch (e) {
		callbacks.onError(`Failed to spawn codex: ${e instanceof Error ? e.message : String(e)}`);
		return { abort: () => {} };
	}

	let fullText = "";
	let buffer = "";
	let threadId = sessionId || "";
	let finished = false;
	let failed = false;

	const writeRequest = (id: number, method: string, params: Record<string, unknown>) => {
		child.stdin?.write(appServerRequest(id, method, params));
	};
	const startTurn = () => writeRequest(4, "turn/start", {
		threadId,
		input: [{ type: "text", text: prompt }],
	});
	const fail = (message: string) => {
		if (failed || finished) return;
		failed = true;
		callbacks.onError(message);
		child.stdin?.end();
	};
	const complete = () => {
		if (failed || finished) return;
		finished = true;
		callbacks.onDone(fullText);
		child.stdin?.end();
	};

	child.stdout?.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf-8");

		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line) as Record<string, unknown>;
				const method = event.method as string | undefined;
				const requestId = event.id as number | undefined;
				const params = (event.params as Record<string, unknown> | undefined) || {};

				if (event.error) {
					const error = event.error as Record<string, unknown>;
					fail((error.message as string) || "Codex app-server error");
				} else if (requestId === 1 && event.result) {
					const openRequest = buildCodexThreadOpenRequest({
						sessionId,
						cwd: mcpConfig.vaultPath || home || "/",
						model,
						reasoningEffort: codexReasoningEffort,
						systemPrompt,
					});
					writeRequest(2, openRequest.method, openRequest.params);
				} else if (requestId === 2 && event.result) {
					const result = event.result as Record<string, unknown>;
					const thread = result.thread as Record<string, unknown> | undefined;
					threadId = (thread?.id as string) || sessionId || threadId;
					if (!threadId) {
						fail("Codex app-server did not return a thread ID");
						continue;
					}
					callbacks.onSessionId?.(threadId);
					const historyItems = sessionId ? [] : buildCodexHistoryItems(history);
					if (historyItems.length > 0) {
						writeRequest(3, "thread/inject_items", { threadId, items: historyItems });
					} else {
						startTurn();
					}
				} else if (requestId === 3 && event.result) {
					startTurn();
				} else if (method === "item/agentMessage/delta") {
					const delta = (params.delta as string) || "";
					if (delta) {
						fullText += delta;
						callbacks.onText(delta);
					}
				} else if (method === "item/started") {
					handleAppServerItem(params, callbacks, "running");
				} else if (method === "item/completed") {
					handleAppServerItem(params, callbacks, "done");
				} else if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
					const delta = (params.delta as string) || "";
					if (delta) callbacks.onThinking?.(delta);
				} else if (method === "turn/completed") {
					complete();
				} else if (method === "mcpServer/elicitation/request" && requestId !== undefined) {
					child.stdin?.write(JSON.stringify({ id: requestId, result: { action: "approve" } }) + "\n");
				} else if (method === "error" || method === "turn/failed") {
					const error = params.error as Record<string, unknown> | undefined;
					const message = (params.message as string) || (error?.message as string) || "Codex error";
					if (params.willRetry !== true) fail(message);
				}
			} catch {
				console.warn("[ai-daily] invalid Codex app-server event:", line.slice(0, 500));
			}
		}
	});

	child.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString("utf-8").trim();
		if (text) console.warn("[ai-daily] codex stderr:", text);
	});

	child.on("close", (code: number | null) => {
		if (finished || failed) return;
		if (code !== 0 && code !== null) fail(`Codex app-server exited with code ${code}`);
		else complete();
	});

	child.on("error", (err: Error) => {
		fail(`Codex error: ${err.message}`);
	});

	writeRequest(1, "initialize", {
		clientInfo: { name: "obsidian-ai-daily", version: "0.1.0" },
	});

	return {
		abort: () => {
			child.kill("SIGTERM");
		},
	};
}

function handleAppServerItem(
	params: Record<string, unknown>,
	callbacks: ClaudeCodeStreamCallbacks,
	status: "running" | "done",
): void {
	const item = params.item as Record<string, unknown> | undefined;
	if (!item) return;
	const id = (item.id as string) || `tool-${Date.now()}`;
	if (item.type === "commandExecution") {
		const isError = status === "done" && item.status === "failed";
		callbacks.onToolCall?.(id, "shell", { command: item.command }, isError ? "error" : status);
		if (status === "done" && item.aggregatedOutput) {
			callbacks.onToolResult?.(id, String(item.aggregatedOutput), isError);
		}
	} else if (item.type === "mcpToolCall") {
		const isError = status === "done" && (item.status === "failed" || !!item.error);
		const name = (item.name as string) || (item.tool as string) || "mcp_tool";
		callbacks.onToolCall?.(
			id,
			name,
			(item.arguments as Record<string, unknown>) || {},
			isError ? "error" : status,
		);
		if (status === "done" && (item.output || item.result)) {
			const output = typeof item.output === "string" ? item.output : JSON.stringify(item.result ?? "");
			callbacks.onToolResult?.(id, output, isError);
		}
	}
}
