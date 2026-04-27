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
			"列出指定文件夹中的笔记，按修改时间排序。不指定文件夹则列出所有知识库文件夹的笔记。",
		input_schema: {
			type: "object" as const,
			properties: {
				folder: {
					type: "string",
					description: "文件夹路径，如 Raw、Wiki（可选，不填则列出全部）",
				},
				limit: {
					type: "number",
					description: "返回最近几篇（默认 20）",
				},
			},
			required: [],
		},
	},
	{
		name: "create_note",
		description:
			"创建一篇新笔记。支持传入 frontmatter 对象，自动生成 YAML 头。会自动创建中间目录。如果路径已存在则报错。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径，如 Wiki/concept.md",
				},
				content: {
					type: "string",
					description: "笔记正文内容（Markdown）",
				},
				frontmatter: {
					type: "object",
					description: "可选的 frontmatter 对象，如 {tags: ['ai'], summary: '...'}",
				},
			},
			required: ["path", "content"],
		},
	},
	{
		name: "edit_note",
		description:
			"编辑笔记中的指定部分。支持三种定位模式：search_replace（按原文匹配替换，最精确）、heading（替换整个标题 section）、line_range（按行号范围替换）。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径",
				},
				mode: {
					type: "string",
					enum: ["heading", "line_range", "search_replace"],
					description: "定位模式",
				},
				target: {
					description: "search_replace/heading 模式传字符串，line_range 模式传 {start, end} 行号对象（从 1 开始）",
				},
				replacement: {
					type: "string",
					description: "替换后的新内容",
				},
			},
			required: ["path", "mode", "target", "replacement"],
		},
	},
	{
		name: "rename_note",
		description:
			"重命名或移动笔记到新路径。Obsidian 会自动更新所有反向链接引用。目标路径不能已存在。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "当前笔记路径",
				},
				new_path: {
					type: "string",
					description: "新路径，如 Wiki/new-name.md",
				},
			},
			required: ["path", "new_path"],
		},
	},
	{
		name: "delete_note",
		description:
			"删除笔记（两步确认）。第一次调用返回笔记预览和确认提示，需要带 confirmed: true 再次调用才会执行删除。文件会被移到系统回收站。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径",
				},
				confirmed: {
					type: "boolean",
					description: "设为 true 确认删除",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "get_links",
		description:
			"获取笔记的双向链接关系。返回该笔记链接到的其他笔记（outlinks）和链接到该笔记的其他笔记（backlinks）。用于理解笔记间的关系和知识图谱结构。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径，如 Wiki/concept.md",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "update_frontmatter",
		description:
			"修改笔记的 YAML frontmatter。支持设置（set）和删除（delete）字段。如果笔记没有 frontmatter 则自动创建。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径",
				},
				set: {
					type: "object",
					description: "要设置/覆盖的字段，如 {tags: ['ai', 'rag'], summary: '...'}",
				},
				delete: {
					type: "array",
					items: { type: "string" },
					description: "要删除的字段名列表，如 ['draft', 'temp']",
				},
			},
			required: ["path"],
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
	const resp = await requestUrl({
		url: API_URL,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": ANTHROPIC_VERSION,
		},
		body: JSON.stringify({
			model,
			max_tokens: maxTokens,
			system: systemPrompt,
			messages: [{ role: "user", content: userMessage }],
		}),
	});

	if (resp.status >= 400) {
		throw new Error(`Claude API error ${resp.status}: ${resp.text}`);
	}

	return extractTextFromResponse(resp.json) || "";
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
	streamMode?: StreamMode;
	enableWebSearch?: boolean;
	compressThresholdEst?: number;
	compressKeepMessages?: number;
	onCompress?: (detail: string) => void;
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

	async chat(
		userMessage: string,
		executeTool: ToolExecutor,
		onAssistantDelta?: (delta: string, accumulated: string) => void,
		images?: PreparedImage[]
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

			this.messages.push({ role: "user", content: results as unknown as ContentBlock[] });
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
			summary = await callClaudeSimple({
				apiKey: this.apiKey,
				model: this.model,
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

		return this.callApiTypewriter(onTextDelta);
	}

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
			max_tokens: MAX_TOKENS,
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

		const json = resp.json as Record<string, unknown>;
		if (!json || !Array.isArray(json.content)) {
			throw new Error("Claude API: unexpected response format");
		}
		return json as unknown as ApiResponse;
	}

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
