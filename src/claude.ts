/**
 * Claude API client with tool_use support.
 *
 * 三种数据源（按 streamMode 调度）：
 *   real       — 浏览器原生 fetch + SSE，Phase 0 已验证桌面可行；
 *                需要 anthropic-dangerous-direct-browser-access 头才能过 CORS
 *                （上次 ce3e360 回滚的根因）。
 *   typewriter — 用 requestUrl 一次拿完整响应，再客户端切片回放；
 *                兼容性最好，移动端 fetch CORS 不通时的兜底。
 *   off        — 一次性返回整段，不打字机动画。
 *
 * auto = 真流→打字机的自动降级链；任何 throw 都不冒泡到 UI。
 */

import { requestUrl } from "obsidian";
import {
	AnthropicStreamAssembler,
	type ApiResponse,
	type ContentBlock,
	type TextBlock,
	type ToolUseBlock,
} from "./anthropic-sse";

/** Characters per visual update chunk for the typewriter animation. */
const STREAM_CHUNK_SIZE = 6;
/** Delay between animation chunks (ms). Adjust for faster/slower effect. */
const STREAM_CHUNK_DELAY_MS = 22;

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

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

// ── Tool definitions ────────────────────────────────────────────────

const WEB_SEARCH_TOOL = {
	type: "web_search_20250305" as const,
	name: "web_search",
	max_uses: 5,
};

const WEB_FETCH_TOOL = {
	name: "web_fetch",
	description:
		"抓取指定 URL 的网页内容，返回纯文本。用于阅读搜索结果中的具体页面、文章或文档。",
	input_schema: {
		type: "object" as const,
		properties: {
			url: {
				type: "string",
				description: "要抓取的完整 URL",
			},
		},
		required: ["url"],
	},
};

export const VAULT_TOOLS = [
	{
		name: "read_note",
		description:
			"读取 vault 中指定路径的笔记全文。可用于读取日报、采集的文章（Raw/）、整理的知识条目（Wiki/）等。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径，如 Raw/some-article.md 或 Wiki/concept.md",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "search_vault",
		description:
			"在 vault 中搜索笔记。支持关键词全文搜索，可按文件夹和标签过滤。用于在知识库中查找相关内容。",
		input_schema: {
			type: "object" as const,
			properties: {
				query: {
					type: "string",
					description: "搜索关键词",
				},
				folder: {
					type: "string",
					description: "限定搜索的文件夹路径，如 Raw、Wiki（可选）",
				},
				tag: {
					type: "string",
					description: "按标签过滤，如 ai、rag（可选，匹配 frontmatter 中的 tags）",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "append_to_note",
		description:
			"将内容追加到指定笔记末尾。用于将对话中的洞察、总结写回笔记。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径",
				},
				content: {
					type: "string",
					description: "要追加的 Markdown 内容",
				},
			},
			required: ["path", "content"],
		},
	},
	{
		name: "list_notes",
		description:
			"列出指定文件夹中的笔记，按修改时间排序。不指定文件夹则列出所有知识库文件夹（Daily、Raw、Wiki 等）的笔记。",
		input_schema: {
			type: "object" as const,
			properties: {
				folder: {
					type: "string",
					description: "文件夹路径，如 Raw、Wiki、AI-Daily（可选，不填则列出全部）",
				},
				limit: {
					type: "number",
					description: "返回最近几篇（默认 20）",
				},
			},
			required: [],
		},
	},
];

// ── Types ───────────────────────────────────────────────────────────

export type { ApiResponse, ContentBlock, TextBlock, ToolUseBlock };

export interface ClaudeMessage {
	role: "user" | "assistant";
	content: string | ContentBlock[];
}

export interface ToolResult {
	type: "tool_result";
	tool_use_id: string;
	content: string;
	is_error?: boolean;
}

export type ToolExecutor = (
	name: string,
	input: Record<string, unknown>
) => Promise<string>;

export type StreamMode = "auto" | "real" | "typewriter" | "off";

/** Rough token estimate (≈ chars / 4), for UI and compression heuristics. */
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

// ── Client ──────────────────────────────────────────────────────────

export function buildToolsArray(enableWebSearch: boolean): Record<string, unknown>[] {
	const tools: Record<string, unknown>[] = [...VAULT_TOOLS];
	if (enableWebSearch) {
		tools.push(WEB_SEARCH_TOOL, WEB_FETCH_TOOL);
	}
	return tools;
}

export interface ClaudeClientOptions {
	/**
	 * Streaming mode：
	 *   - auto       (默认) 真流→打字机自动降级
	 *   - real       仅真流，失败直接报错（仅调试）
	 *   - typewriter 用 requestUrl 拉整段再切片回放（兼容性最好）
	 *   - off        一次性返回整段，无动画
	 */
	streamMode?: StreamMode;
	/** Enable web search and web fetch tools. */
	enableWebSearch?: boolean;
	/** Estimated token budget before compressing older turns (0 = disable). */
	compressThresholdEst?: number;
	/** Keep this many recent messages when compressing (must be ≥ 2). */
	compressKeepMessages?: number;
	/** Called when history was summarized for context. */
	onCompress?: (detail: string) => void;
	/** Called once per chat() when real-stream fell back to typewriter. */
	onStreamFallback?: (reason: string) => void;
}

export class ClaudeClient {
	private apiKey: string;
	private model: string;
	private messages: ClaudeMessage[] = [];
	private systemPrompt: string;
	private streamMode: StreamMode;
	private enableWebSearch: boolean;
	private compressThresholdEst: number;
	private compressKeepMessages: number;
	private onCompress?: (detail: string) => void;
	private onStreamFallback?: (reason: string) => void;

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
		this.compressThresholdEst =
			options?.compressThresholdEst ?? 90_000;
		this.compressKeepMessages = Math.max(
			2,
			options?.compressKeepMessages ?? 8
		);
		this.onCompress = options?.onCompress;
		this.onStreamFallback = options?.onStreamFallback;
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

	/** Restore plain string-only turns (from persisted chat). */
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

	/** Send a user message and run the tool loop until Claude is done. */
	async chat(
		userMessage: string,
		executeTool: ToolExecutor,
		onAssistantDelta?: (delta: string, accumulated: string) => void
	): Promise<string> {
		this.messages.push({ role: "user", content: userMessage });

		await this.maybeCompressHistory();

		const collectedText: string[] = [];
		let priorAssistantText = "";

		while (true) {
			let roundStream = "";
			const onDelta = onAssistantDelta
				? (d: string) => {
						roundStream += d;
						onAssistantDelta(d, priorAssistantText + roundStream);
					}
				: undefined;

			const response = await this.callApi(onDelta);

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
				try {
					const result = await executeTool(tool.name, tool.input);
					results.push({
						type: "tool_result",
						tool_use_id: tool.id,
						content: result,
					});
				} catch (e) {
					results.push({
						type: "tool_result",
						tool_use_id: tool.id,
						content: `Error: ${e instanceof Error ? e.message : String(e)}`,
						is_error: true,
					});
				}
			}

			this.messages.push({ role: "user", content: results as any });
		}

		return collectedText.join("");
	}

	clearHistory(): void {
		this.messages = [];
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
			summary = await this.summarizeConversationBlob(blob);
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

	private async summarizeConversationBlob(blob: string): Promise<string> {
		const body = {
			model: this.model,
			max_tokens: 2048,
			messages: [
				{
					role: "user" as const,
					content:
						"请将以下对话压缩为简洁的中文摘要，保留关键事实、决定与待办，省略寒暄。不超过 900 字。\n\n" +
						blob.slice(0, 120_000),
				},
			],
		};

		const resp = await requestUrl({
			url: API_URL,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": this.apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
			},
			body: JSON.stringify(body),
		});

		if (resp.status >= 400) {
			throw new Error(`Claude API error ${resp.status}: ${resp.text}`);
		}

		const json = resp.json as { content?: Array<{ type: string; text?: string }> };
		const texts = (json.content ?? [])
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "");
		return texts.join("\n").trim() || "（摘要为空）";
	}

	// ── Streaming dispatch ──────────────────────────────────────────

	private async callApi(
		onTextDelta?: (s: string) => void
	): Promise<ApiResponse> {
		if (this.streamMode === "off") {
			return this.callApiNonStreaming();
		}

		if (this.streamMode === "auto" || this.streamMode === "real") {
			try {
				return await this.callApiRealStream(onTextDelta);
			} catch (e) {
				if (this.streamMode === "real") {
					// 显式选了 real 时不掩盖错误——便于调试。
					throw e;
				}
				const msg = e instanceof Error ? e.message : String(e);
				console.warn(
					"[ai-daily] real stream failed, falling back to typewriter:",
					msg
				);
				this.onStreamFallback?.(msg);
				// 落到下面 typewriter 路径。
			}
		}

		return this.callApiTypewriter(onTextDelta);
	}

	/**
	 * 真流式：fetch + SSE。
	 *
	 * 关键头：anthropic-dangerous-direct-browser-access: true。
	 * 没有这个头时浏览器直连会被 CORS 拦截（fc03352 → ce3e360 的根因）。
	 */
	private async callApiRealStream(
		onTextDelta?: (s: string) => void
	): Promise<ApiResponse> {
		const body = { ...this.buildRequestBody(), stream: true };
		const res = await fetch(API_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": this.apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
				"anthropic-dangerous-direct-browser-access": "true",
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			let errText = "";
			try {
				errText = await res.text();
			} catch {
				/* ignore */
			}
			throw new Error(
				`Claude API stream HTTP ${res.status}: ${errText.slice(0, 500)}`
			);
		}

		if (!res.body) {
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
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const text = decoder.decode(value, { stream: true });
				if (text) assembler.push(text);
			}
			// flush decoder tail
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
		return {
			model: this.model,
			max_tokens: 4096,
			system: this.systemPrompt,
			tools: buildToolsArray(this.enableWebSearch),
			messages: this.messages,
		};
	}

	private async callApiNonStreaming(): Promise<ApiResponse> {
		const body = this.buildRequestBody();
		const resp = await requestUrl({
			url: API_URL,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": this.apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
			},
			body: JSON.stringify(body),
		});

		if (resp.status >= 400) {
			throw new Error(`Claude API error ${resp.status}: ${resp.text}`);
		}

		return resp.json as ApiResponse;
	}

	/**
	 * 伪流：拿到完整响应后客户端切片回放制造打字机效果。
	 * 兼容性最好（仅依赖 requestUrl），用作真流失败的兜底，或用户显式选择。
	 */
	private async callApiTypewriter(
		onTextDelta?: (s: string) => void
	): Promise<ApiResponse> {
		const response = await this.callApiNonStreaming();

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
