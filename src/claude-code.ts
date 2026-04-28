import { Platform } from "obsidian";
import { ChildProcess } from "child_process";

let cachedAvailable: boolean | null = null;

export async function isClaudeCodeAvailable(): Promise<boolean> {
	if (!Platform.isDesktopApp) return false;
	if (cachedAvailable !== null) return cachedAvailable;

	try {
		const { execFile } = require("child_process") as typeof import("child_process");
		const result = await new Promise<boolean>((resolve) => {
			execFile("claude", ["--version"], { timeout: 5000 }, (err: Error | null) => {
				resolve(!err);
			});
		});
		cachedAvailable = result;
		return result;
	} catch {
		cachedAvailable = false;
		return false;
	}
}

export function resetClaudeCodeCache(): void {
	cachedAvailable = null;
}

export interface ClaudeCodeStreamCallbacks {
	onText: (delta: string) => void;
	onToolCall?: (name: string, status: "running" | "done" | "error") => void;
	onError: (error: string) => void;
	onDone: (fullText: string) => void;
}

export function spawnClaudeCode(
	prompt: string,
	mcpConfig: { vaultPath: string; mcpServerPath: string; knowledgeFolders: string[] },
	callbacks: ClaudeCodeStreamCallbacks
): { abort: () => void } {
	const { spawn } = require("child_process") as typeof import("child_process");

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

	let child: ChildProcess;
	try {
		child = spawn("claude", args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
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
			break;
		}
	}
}
