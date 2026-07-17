import { requestUrl } from "obsidian";
import {
	AnthropicStreamAssembler,
	type ApiResponse,
	type ContentBlock,
	type TextBlock,
	type ToolUseBlock,
} from "./anthropic-sse";
import type { PreparedImage } from "./image-tools";

const STREAM_CHUNK_SIZE = 6;
const STREAM_CHUNK_DELAY_MS = 22;

export const API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 4096;
const COMPRESS_MAX_OUTPUT_TOKENS = 2048;
const COMPRESS_BLOB_MAX_CHARS = 120_000;

const RETRY_MAX = 3;
const RETRY_BASE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 180_000;

function isRetryableStatus(status: number): boolean {
	return status === 429 || status === 529;
}

async function sleepMs(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`请求超时（${Math.round(ms / 1000)}s），请稍后重试`)), ms)
		),
	]);
}

function retryDelayMs(attempt: number, status: number, retryAfterHeader?: string): number {
	if (retryAfterHeader) {
		const secs = Number(retryAfterHeader);
		if (!Number.isNaN(secs) && secs > 0) return secs * 1000;
	}
	const delay = RETRY_BASE_MS * Math.pow(2, attempt);
	console.warn(`[ai-daily] API ${status}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${RETRY_MAX})`);
	return delay;
}

async function emitTypewriterText(
	text: string,
	onTextDelta: (s: string) => void
): Promise<void> {
	let pos = 0;
	while (pos < text.length) {
		const chunk = text.slice(pos, pos + STREAM_CHUNK_SIZE);
		onTextDelta(chunk);
		pos += STREAM_CHUNK_SIZE;
		if (pos < text.length) {
			await new Promise((r) => setTimeout(r, STREAM_CHUNK_DELAY_MS));
		}
	}
}

class TextDeltaTypewriter {
	private queue = Promise.resolve();

	constructor(private onTextDelta: (s: string) => void) {}

	enqueue(text: string): void {
		if (!text) return;
		this.queue = this.queue.then(() =>
			emitTypewriterText(text, this.onTextDelta)
		);
	}

	async flush(): Promise<void> {
		await this.queue;
	}
}

// ── Tool definitions (from shared source) ───────────────────────────

import {
	TOOL_DEFS,
	PODCAST_TOOL_DEFS,
	WEB_FETCH_TOOL_DEF,
	WEREAD_TOOL_DEF,
	FEED_TOOL_DEFS,
	toAnthropicTool,
} from "./tool-definitions";

const WEB_SEARCH_TOOL = {
	type: "web_search_20250305" as const,
	name: "web_search",
	max_uses: 5,
};

const WEB_FETCH_TOOL = toAnthropicTool(WEB_FETCH_TOOL_DEF);
const WEREAD_TOOL = toAnthropicTool(WEREAD_TOOL_DEF);
const PODCAST_TOOLS = PODCAST_TOOL_DEFS.map(toAnthropicTool);
const FEED_TOOLS = FEED_TOOL_DEFS.map(toAnthropicTool);
export const VAULT_TOOLS = TOOL_DEFS.map(toAnthropicTool);

// ── Types ───────────────────────────────────────────────────────────

export type { ApiResponse, ContentBlock, TextBlock, ToolUseBlock };

export interface ClaudeMessage {
	role: "user" | "assistant";
	content: string | ContentBlock[];
}

export type ToolResultContent = string | { type: string; [key: string]: unknown }[];

export interface ToolResult {
	type: "tool_result";
	tool_use_id: string;
	content: ToolResultContent;
	is_error?: boolean;
}

export type ToolExecutor = (
	name: string,
	input: Record<string, unknown>
) => Promise<string | ToolResultContent>;

export type StreamMode = "auto" | "real" | "typewriter" | "off";

export function estimateTextTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

function messageContentToString(content: ClaudeMessage["content"]): string {
	if (typeof content === "string") return content;
	return JSON.stringify(content);
}

export function estimateMessagesTokens(
	messages: ClaudeMessage[],
	systemPrompt: string
): number {
	let n = estimateTextTokens(systemPrompt);
	for (const m of messages) {
		n += estimateTextTokens(messageContentToString(m.content)) + 4;
	}
	return n;
}

// ── Shared simple API call ──────────────────────────────────────────

interface SimpleCallOptions {
	apiKey: string;
	model: string;
	systemPrompt: string;
	userMessage: string;
	maxTokens?: number;
}

function extractTextFromResponse(json: unknown): string {
	if (typeof json !== "object" || json === null) return "";
	const resp = json as Record<string, unknown>;
	if (!Array.isArray(resp.content)) return "";
	for (const block of resp.content) {
		if (typeof block === "object" && block !== null) {
			const b = block as Record<string, unknown>;
			if (b.type === "text" && typeof b.text === "string") return b.text;
		}
	}
	return "";
}

export async function callClaudeSimple(options: SimpleCallOptions): Promise<string> {
	const { apiKey, model, systemPrompt, userMessage, maxTokens = MAX_TOKENS } = options;

	const bodyObj: Record<string, unknown> = {
		model,
		max_tokens: maxTokens,
		messages: [{ role: "user", content: userMessage }],
		stream: true,
	};
	if (systemPrompt) {
		bodyObj.system = [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];
	}

	let res: Response | undefined;
	for (let attempt = 0; ; attempt++) {
		res = await fetch(API_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
				"anthropic-dangerous-direct-browser-access": "true",
			},
			body: JSON.stringify(bodyObj),
		});

		if (isRetryableStatus(res.status) && attempt < RETRY_MAX) {
			await sleepMs(retryDelayMs(attempt, res.status, res.headers.get("retry-after") ?? undefined));
			continue;
		}
		break;
	}

	if (!res!.ok) {
		let errText = "";
		try { errText = await res!.text(); } catch { /* ignore */ }
		throw new Error(`Claude API error ${res!.status}: ${errText.slice(0, 500)}`);
	}

	if (!res!.body) {
		throw new Error("Claude API: response has no body (no ReadableStream)");
	}

	const assembler = new AnthropicStreamAssembler({});
	const reader = res!.body!.getReader();
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			if (text) assembler.push(text);
		}
		const tail = decoder.decode();
		if (tail) assembler.push(tail);
	} finally {
		try { reader.releaseLock(); } catch { /* ignore */ }
	}

	const response = assembler.finalize();
	for (const block of response.content) {
		if (block.type === "text") return block.text;
	}
	return "";
}

// ── Client ──────────────────────────────────────────────────────────

export function buildToolsArray(enableWebSearch: boolean, enableWeRead: boolean = false, enablePodcast: boolean = false, enableFeeds: boolean = false): Record<string, unknown>[] {
	const tools: Record<string, unknown>[] = [...VAULT_TOOLS];
	if (enableWebSearch) {
		tools.push(WEB_SEARCH_TOOL, WEB_FETCH_TOOL);
	}
	if (enableWeRead) {
		tools.push(WEREAD_TOOL);
	}
	if (enablePodcast) {
		tools.push(...PODCAST_TOOLS);
	}
	if (enableFeeds) {
		tools.push(...FEED_TOOLS);
	}
	if (tools.length > 0) {
		tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } };
	}
	return tools;
}

export interface ClaudeClientOptions {
	streamMode?: StreamMode;
	enableWebSearch?: boolean;
	enableWeRead?: boolean;
	enablePodcast?: boolean;
	enableFeeds?: boolean;
	compressThresholdEst?: number;
	compressKeepMessages?: number;
	onCompress?: (detail: string) => void;
	onStreamFallback?: (reason: string) => void;
	proxyUrl?: string;
	proxyToken?: string;
}

export class ClaudeClient {
	private apiKey: string;
	private model: string;
	private messages: ClaudeMessage[] = [];
	private systemPrompt: string;
	private streamMode: StreamMode;
	private enableWebSearch: boolean;
	private enableWeRead: boolean;
	private enablePodcast: boolean;
	private enableFeeds: boolean;
	private compressThresholdEst: number;
	private compressKeepMessages: number;
	private onCompress?: (detail: string) => void;
	private onStreamFallback?: (reason: string) => void;
	private abortController: AbortController | null = null;
	private proxyUrl?: string;
	private proxyToken?: string;
	private proxySessionIds: Partial<Record<"claude-code" | "codex", string>> = {};
	private proxyTaskIds: Partial<Record<"claude-code" | "codex", string>> = {};

	constructor(
		apiKey: string,
		model: string,
		systemPrompt: string,
		options?: ClaudeClientOptions
	) {
		this.apiKey = apiKey;
		this.model = model;
		this.systemPrompt = systemPrompt;
		this.streamMode = options?.streamMode ?? "auto";
		this.enableWebSearch = options?.enableWebSearch ?? false;
		this.enableWeRead = options?.enableWeRead ?? false;
		this.enablePodcast = options?.enablePodcast ?? false;
		this.enableFeeds = options?.enableFeeds ?? false;
		this.compressThresholdEst =
			options?.compressThresholdEst ?? 90_000;
		this.compressKeepMessages = Math.max(
			2,
			options?.compressKeepMessages ?? 8
		);
		this.onCompress = options?.onCompress;
		this.onStreamFallback = options?.onStreamFallback;
		const rawUrl = options?.proxyUrl?.trim();
		this.proxyUrl = rawUrl && !/^https?:\/\//i.test(rawUrl) ? `https://${rawUrl}` : rawUrl;
		this.proxyToken = options?.proxyToken;
	}

	getProxySessionId(backend: "claude-code" | "codex"): string | undefined {
		return this.proxySessionIds[backend];
	}

	setProxySessionId(backend: "claude-code" | "codex", id: string): void {
		this.proxySessionIds[backend] = id;
	}

	clearProxySessionId(backend?: "claude-code" | "codex"): void {
		if (backend) {
			delete this.proxySessionIds[backend];
			delete this.proxyTaskIds[backend];
		} else {
			this.proxySessionIds = {};
			this.proxyTaskIds = {};
		}
	}

	getProxyTaskId(backend: "claude-code" | "codex"): string | undefined {
		return this.proxyTaskIds[backend];
	}

	setProxyTaskId(backend: "claude-code" | "codex", id: string): void {
		this.proxyTaskIds[backend] = id;
	}

	isProxyMode(): boolean {
		return !!(this.proxyUrl && this.proxyToken);
	}

	getModel(): string {
		return this.model;
	}

	getMessagesSnapshot(): ClaudeMessage[] {
		return this.messages.map((m) =>
			typeof m.content === "string"
				? { role: m.role, content: m.content }
				: {
						role: m.role,
						content: JSON.parse(
							JSON.stringify(m.content)
						) as ContentBlock[],
					}
		);
	}

	setHistoryFromStrings(
		turns: { role: "user" | "assistant"; content: string }[]
	): void {
		this.messages = turns.map((t) => ({
			role: t.role,
			content: t.content,
		}));
	}

	estimateContextTokens(): number {
		return estimateMessagesTokens(this.messages, this.systemPrompt);
	}

	abort(): void {
		this.abortController?.abort();
		this.abortController = null;
	}

	async chat(
		userMessage: string,
		executeTool: ToolExecutor,
		onAssistantDelta?: (delta: string, accumulated: string) => void,
		images?: PreparedImage[],
		onToolCall?: (name: string, input: Record<string, unknown>, status: "start" | "done" | "error") => void
	): Promise<string> {
		if (images && images.length > 0) {
			const content: Record<string, unknown>[] = images.map((img) => ({
				type: "image",
				source: {
					type: "base64",
					media_type: img.mediaType,
					data: img.base64,
				},
			}));
			content.push({ type: "text", text: userMessage });
			this.messages.push({
				role: "user",
				content: content as unknown as ContentBlock[],
			});
		} else {
			this.messages.push({ role: "user", content: userMessage });
		}

		await this.maybeCompressHistory();

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		const collectedText: string[] = [];
		let priorAssistantText = "";

		try {
		while (true) {
			if (signal.aborted) break;

			let roundStream = "";
			const onDelta = onAssistantDelta
				? (d: string) => {
						roundStream += d;
						onAssistantDelta(d, priorAssistantText + roundStream);
					}
				: undefined;

			this.stripImageData();
			const response = await this.callApi(onDelta, signal);

			const u = response.usage;
			if (u.cache_read_input_tokens || u.cache_creation_input_tokens) {
				console.log(`[ai-daily] cache: read=${u.cache_read_input_tokens ?? 0} created=${u.cache_creation_input_tokens ?? 0} input=${u.input_tokens}`);
			}

			let roundText = "";
			for (const block of response.content) {
				if (block.type === "text") {
					collectedText.push((block as TextBlock).text);
					roundText += (block as TextBlock).text;
				}
			}
			priorAssistantText += roundText;

			if (response.stop_reason === "end_turn") {
				this.messages.push({
					role: "assistant",
					content: response.content,
				});
				break;
			}

			const toolUses = response.content.filter(
				(b): b is ToolUseBlock => b.type === "tool_use"
			);

			if (toolUses.length === 0) {
				this.messages.push({
					role: "assistant",
					content: response.content,
				});
				break;
			}

			this.messages.push({
				role: "assistant",
				content: response.content,
			});

			const results: ToolResult[] = [];
			for (const tool of toolUses) {
				if (signal.aborted) break;
				onToolCall?.(tool.name, tool.input, "start");
				try {
					const result = await executeTool(tool.name, tool.input);
					onToolCall?.(tool.name, tool.input, "done");
					results.push({
						type: "tool_result",
						tool_use_id: tool.id,
						content: result,
					});
				} catch (e) {
					onToolCall?.(tool.name, tool.input, "error");
					results.push({
						type: "tool_result",
						tool_use_id: tool.id,
						content: `Error: ${e instanceof Error ? e.message : String(e)}`,
						is_error: true,
					});
				}
			}

			this.messages.push({ role: "user", content: results as unknown as ContentBlock[] });
		}

		} catch (e) {
			if (signal.aborted) {
				if (collectedText.length > 0) {
					this.messages.push({ role: "assistant", content: collectedText.join("") });
				}
				return collectedText.join("");
			}
			throw e;
		} finally {
			this.abortController = null;
		}

		return collectedText.join("");
	}

	async proxyChat(
		userMessage: string,
		onAssistantDelta?: (delta: string, accumulated: string) => void,
		onToolCall?: (name: string, input: Record<string, unknown>, status: "start" | "done" | "error") => void,
		seedHistory?: { role: string; content: string }[],
		proxyBackend?: "claude-code" | "codex",
		proxyModel?: string,
		codexPermissionMode?: "read-only" | "vault-write",
		onStatus?: (message: string) => void,
	): Promise<string> {
		if (!this.proxyUrl || !this.proxyToken) {
			throw new Error("Proxy mode not configured");
		}

		this.messages.push({ role: "user", content: userMessage });
		const backend = proxyBackend ?? "claude-code";
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		try {
			const body: Record<string, unknown> = { message: userMessage };
			if (proxyBackend) {
				body.backend = proxyBackend;
			}
			if (proxyModel) {
				body.model = proxyModel;
			}
			if (proxyBackend === "codex" && codexPermissionMode) {
				body.codexPermissionMode = codexPermissionMode;
			}
			if (this.proxySessionIds[backend]) {
				body.sessionId = this.proxySessionIds[backend];
			} else {
				body.systemPrompt = this.systemPrompt;
				if (seedHistory?.length) {
					body.history = seedHistory;
				}
			}

			const PROXY_RETRY_MAX = 2;
			let resp: Response | null = null;
			let lastError: Error | null = null;

			for (let attempt = 0; attempt <= PROXY_RETRY_MAX; attempt++) {
				if (signal.aborted) break;
				try {
					resp = await fetch(`${this.proxyUrl}/chat`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${this.proxyToken}`,
						},
						body: JSON.stringify(body),
						signal,
					});
					if (resp.ok) break;
					const errText = await resp.text();
					lastError = new Error(`Proxy error ${resp.status}: ${errText}`);
					if (resp.status >= 400 && resp.status < 500) throw lastError;
				} catch (e) {
					if (signal.aborted) throw e;
					lastError = e instanceof Error ? e : new Error(String(e));
					if (e instanceof Error && e.name === "AbortError") throw e;
				}
				if (attempt < PROXY_RETRY_MAX) {
					const delay = 3000 * (attempt + 1);
					console.warn(`[ai-daily] proxy retry ${attempt + 1}/${PROXY_RETRY_MAX} in ${delay / 1000}s`);
					await sleepMs(delay);
				}
			}

			if (!resp?.ok) {
				throw lastError || new Error("Proxy request failed");
			}

			const reader = resp.body?.getReader();
			if (!reader) throw new Error("No response stream");

			const decoder = new TextDecoder();
			let accumulated = "";
			let buffer = "";
			let receivedDone = false;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const jsonStr = line.slice(6).trim();
					if (!jsonStr) continue;

					let event: { type: string; content?: string; name?: string; input?: Record<string, unknown>; status?: "start" | "done" | "error"; sessionId?: string; result?: string; message?: string };
					try {
						event = JSON.parse(jsonStr);
					} catch {
						continue;
					}

					if (event.type === "task_id" && (event as Record<string, unknown>).taskId) {
						this.proxyTaskIds[backend] = (event as Record<string, unknown>).taskId as string;
					} else if (event.type === "text" && event.content) {
						accumulated += event.content;
						onAssistantDelta?.(event.content, accumulated);
					} else if (event.type === "tool_use" && event.name) {
						if (event.status) {
							onToolCall?.(event.name, event.input || {}, event.status);
						} else {
							onToolCall?.(event.name, event.input || {}, "start");
							onToolCall?.(event.name, event.input || {}, "done");
						}
					} else if (event.type === "status" && event.message) {
						onStatus?.(event.message);
					} else if (event.type === "done") {
						receivedDone = true;
						if (event.sessionId) {
							this.proxySessionIds[backend] = event.sessionId;
						}
						if (event.result) {
							accumulated = event.result;
						}
					} else if (event.type === "error") {
						throw new Error(`Proxy: ${event.message || "unknown error"}`);
					}
				}
			}

			if (!receivedDone && this.proxyTaskIds[backend] && this.proxyUrl) {
				try {
					const recovered = await this.recoverFromTask(backend, signal);
					if (recovered !== null) {
						accumulated = recovered;
					}
				} catch {
					console.warn("[ai-daily] SSE truncation recovery failed, using partial content");
				}
			}

			this.messages.push({ role: "assistant", content: accumulated });
			return accumulated;
		} catch (e) {
			if (signal.aborted) {
				return "";
			}
			throw e;
		} finally {
			this.abortController = null;
		}
	}

	private async recoverFromTask(backend: "claude-code" | "codex", signal?: AbortSignal): Promise<string | null> {
		const taskId = this.proxyTaskIds[backend];
		if (!taskId || !this.proxyUrl) return null;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);
		try {
			const resp = await fetch(`${this.proxyUrl}/task/${taskId}`, {
				headers: { Authorization: `Bearer ${this.proxyToken}` },
				signal: signal ?? controller.signal,
			});
			if (!resp.ok) return null;
			const data = await resp.json() as {
				status: string;
				result?: string;
				sessionId?: string;
			};
			if (data.sessionId) this.proxySessionIds[backend] = data.sessionId;
			if (data.status === "done" && data.result) return data.result;
			return null;
		} catch {
			return null;
		} finally {
			clearTimeout(timeout);
		}
	}

	clearHistory(): void {
		this.messages = [];
	}

	rewindLastTurn(): boolean {
		if (this.messages.length < 2) return false;
		while (this.messages.length > 0) {
			const last = this.messages[this.messages.length - 1];
			const isToolResult =
				last.role === "user" && Array.isArray(last.content) &&
				(last.content as Record<string, unknown>[]).some((b) => b.type === "tool_result");
			const isAssistant = last.role === "assistant";
			if (!isToolResult && !isAssistant) break;
			this.messages.pop();
		}
		if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === "user") {
			this.messages.pop();
		}
		return true;
	}

	private stripImageData(): void {
		const lastIdx = this.messages.length - 1;
		for (let mi = 0; mi < this.messages.length; mi++) {
			if (mi === lastIdx) continue;
			const msg = this.messages[mi];
			if (typeof msg.content === "string" || !Array.isArray(msg.content)) continue;
			for (let i = msg.content.length - 1; i >= 0; i--) {
				const block = msg.content[i] as Record<string, unknown>;
				if (block.type === "image") {
					msg.content.splice(i, 1, {
						type: "text",
						text: "[图片已发送，已从上下文中移除以节省空间]",
					} as unknown as ContentBlock);
				} else if (block.type === "tool_result") {
					const inner = block.content;
					if (Array.isArray(inner)) {
						block.content = (inner as Record<string, unknown>[])
							.filter((b) => b.type !== "image");
						if ((block.content as unknown[]).length === 0) {
							block.content = "[图片已发送，已从上下文中移除以节省空间]";
						}
					}
				}
			}
		}
	}

	private async maybeCompressHistory(): Promise<void> {
		const threshold = this.compressThresholdEst;
		if (threshold <= 0) return;
		if (this.messages.length <= this.compressKeepMessages) return;

		const est = estimateMessagesTokens(this.messages, this.systemPrompt);
		if (est < threshold) return;

		const toCompress = this.messages.slice(
			0,
			this.messages.length - this.compressKeepMessages
		);
		const kept = this.messages.slice(-this.compressKeepMessages);

		let blob = "";
		for (const m of toCompress) {
			const prefix = m.role === "user" ? "用户" : "助手";
			blob += `${prefix}: ${messageContentToString(m.content)}\n\n`;
		}

		let summary: string;
		try {
			summary = await callClaudeSimple({
				apiKey: this.apiKey,
				model: "claude-haiku-4-5",
				systemPrompt: "",
				userMessage:
					"请将以下对话压缩为简洁的中文摘要，保留关键事实、决定与待办，省略寒暄。不超过 900 字。\n\n" +
					blob.slice(0, COMPRESS_BLOB_MAX_CHARS),
				maxTokens: COMPRESS_MAX_OUTPUT_TOKENS,
			});
		} catch (e) {
			this.onCompress?.(
				`摘要失败，已截断最早 ${toCompress.length} 条消息: ${e instanceof Error ? e.message : String(e)}`
			);
			this.messages = kept;
			return;
		}

		this.messages = [
			{
				role: "user",
				content:
					"[此前对话摘要，为节省上下文由系统自动生成]\n\n" + summary,
			},
			...kept,
		];
		this.onCompress?.(
			`上下文较长，已将此前 ${toCompress.length} 条消息压缩为摘要。`
		);
	}

	// ── Streaming dispatch ──────────────────────────────────────────

	private async callApi(
		onTextDelta?: (s: string) => void,
		signal?: AbortSignal
	): Promise<ApiResponse> {
		if (this.streamMode === "off") {
			return this.callApiNonStreaming(signal);
		}

		if (this.streamMode === "auto" || this.streamMode === "real") {
			try {
				return await this.callApiRealStream(onTextDelta, signal);
			} catch (e) {
				if (signal?.aborted) throw e;
				if (this.streamMode === "real") {
					throw e;
				}
				const msg = e instanceof Error ? e.message : String(e);
				console.warn(
					"[ai-daily] real stream failed, falling back to typewriter:",
					msg
				);
				this.onStreamFallback?.(msg);
			}
		}

		return this.callApiTypewriter(onTextDelta, signal);
	}

	private async callApiRealStream(
		onTextDelta?: (s: string) => void,
		signal?: AbortSignal
	): Promise<ApiResponse> {
		const body = { ...this.buildRequestBody(), stream: true };

		let res: Response | undefined;
		for (let attempt = 0; ; attempt++) {
			res = await fetch(API_URL, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-api-key": this.apiKey,
					"anthropic-version": ANTHROPIC_VERSION,
					"anthropic-dangerous-direct-browser-access": "true",
				},
				body: JSON.stringify(body),
				signal,
			});

			if (isRetryableStatus(res.status) && attempt < RETRY_MAX) {
				await sleepMs(retryDelayMs(attempt, res.status, res.headers.get("retry-after") ?? undefined));
				continue;
			}
			break;
		}

		if (!res!.ok) {
			let errText = "";
			try {
				errText = await res!.text();
			} catch {
				/* ignore */
			}
			throw new Error(
				`Claude API stream HTTP ${res!.status}: ${errText.slice(0, 500)}`
			);
		}

		if (!res!.body) {
			throw new Error(
				"Claude API stream: response has no body (no ReadableStream)"
			);
		}

		const visualTypewriter = onTextDelta
			? new TextDeltaTypewriter(onTextDelta)
			: null;
		const assembler = new AnthropicStreamAssembler({
			onTextDelta: visualTypewriter
				? (delta) => visualTypewriter.enqueue(delta)
				: undefined,
		});
		const reader = res!.body!.getReader();
		const decoder = new TextDecoder();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const text = decoder.decode(value, { stream: true });
				if (text) assembler.push(text);
			}
			const tail = decoder.decode();
			if (tail) assembler.push(tail);
		} finally {
			try {
				reader.releaseLock();
			} catch {
				/* ignore */
			}
		}

		const response = assembler.finalize();
		await visualTypewriter?.flush();
		return response;
	}

	private buildRequestBody(): Record<string, unknown> {
		const messages = this.messages.map((m) => ({ ...m }));
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "user") continue;
			if (typeof m.content === "string") {
				m.content = [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] as unknown as ContentBlock[];
			} else if (Array.isArray(m.content) && m.content.length > 0) {
				const last = { ...m.content[m.content.length - 1], cache_control: { type: "ephemeral" } };
				m.content = [...m.content.slice(0, -1), last as ContentBlock];
			}
			break;
		}
		return {
			model: this.model,
			max_tokens: MAX_TOKENS,
			system: [{ type: "text", text: this.systemPrompt, cache_control: { type: "ephemeral" } }],
			tools: buildToolsArray(this.enableWebSearch, this.enableWeRead, this.enablePodcast, this.enableFeeds),
			messages,
		};
	}

	private async callApiNonStreaming(signal?: AbortSignal): Promise<ApiResponse> {
		const body = this.buildRequestBody();

		for (let attempt = 0; ; attempt++) {
			if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
			const resp = await withTimeout(requestUrl({
				url: API_URL,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.apiKey,
					"anthropic-version": ANTHROPIC_VERSION,
				},
				body: JSON.stringify(body),
			}), REQUEST_TIMEOUT_MS);

			if (isRetryableStatus(resp.status) && attempt < RETRY_MAX) {
				await sleepMs(retryDelayMs(attempt, resp.status, resp.headers?.["retry-after"]));
				continue;
			}
			if (resp.status >= 400) {
				throw new Error(`Claude API error ${resp.status}: ${resp.text}`);
			}

			const json = resp.json as Record<string, unknown>;
			if (!json || !Array.isArray(json.content)) {
				throw new Error("Claude API: unexpected response format");
			}
			return json as unknown as ApiResponse;
		}
	}

	private async callApiTypewriter(
		onTextDelta?: (s: string) => void,
		signal?: AbortSignal
	): Promise<ApiResponse> {
		const response = await this.callApiNonStreaming(signal);

		if (onTextDelta) {
			const fullText = response.content
				.filter((b): b is TextBlock => b.type === "text")
				.map((b) => b.text)
				.join("");
			if (fullText) await emitTypewriterText(fullText, onTextDelta);
		}

		return response;
	}
}
