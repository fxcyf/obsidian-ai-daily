/**
 * Claude API client with tool_use support and optional SSE streaming.
 * Uses Obsidian's requestUrl to bypass CORS; streaming uses fetch when available.
 */

import { requestUrl } from "obsidian";

const API_URL = "https://api.anthropic.com/v1/messages";

// ── Tool definitions ────────────────────────────────────────────────

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

interface TextBlock {
	type: "text";
	text: string;
}

interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

type ContentBlock = TextBlock | ToolUseBlock;

export interface ClaudeMessage {
	role: "user" | "assistant";
	content: string | ContentBlock[];
}

interface ApiResponse {
	content: ContentBlock[];
	stop_reason: string;
	usage: { input_tokens: number; output_tokens: number };
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

type StreamBlock =
	| { kind: "text"; text: string }
	| { kind: "tool_use"; id: string; name: string; inputJson: string };

/** Split on the first complete SSE event boundary (\r\n\r\n or \n\n). */
function consumeOneSseEvent(
	buffer: string
): { event: string; rest: string } | null {
	const rn = buffer.indexOf("\r\n\r\n");
	const nn = buffer.indexOf("\n\n");
	const candidates: { i: number; len: number }[] = [];
	if (rn !== -1) candidates.push({ i: rn, len: 4 });
	if (nn !== -1) candidates.push({ i: nn, len: 2 });
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => a.i - b.i);
	const { i, len } = candidates[0];
	return { event: buffer.slice(0, i), rest: buffer.slice(i + len) };
}

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

export interface ClaudeClientOptions {
	/** Use SSE streaming when fetch is available (falls back on failure). */
	stream?: boolean;
	/** Estimated token budget before compressing older turns (0 = disable). */
	compressThresholdEst?: number;
	/** Keep this many recent messages when compressing (must be ≥ 2). */
	compressKeepMessages?: number;
	/** Called when history was summarized for context. */
	onCompress?: (detail: string) => void;
}

export class ClaudeClient {
	private apiKey: string;
	private model: string;
	private messages: ClaudeMessage[] = [];
	private systemPrompt: string;
	private stream: boolean;
	private compressThresholdEst: number;
	private compressKeepMessages: number;
	private onCompress?: (detail: string) => void;

	constructor(
		apiKey: string,
		model: string,
		systemPrompt: string,
		options?: ClaudeClientOptions
	) {
		this.apiKey = apiKey;
		this.model = model;
		this.systemPrompt = systemPrompt;
		this.stream = options?.stream !== false;
		this.compressThresholdEst =
			options?.compressThresholdEst ?? 90_000;
		this.compressKeepMessages = Math.max(
			2,
			options?.compressKeepMessages ?? 8
		);
		this.onCompress = options?.onCompress;
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
					collectedText.push(block.text);
					roundText += block.text;
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
				"anthropic-version": "2023-06-01",
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

	private async callApi(
		onTextDelta?: (s: string) => void
	): Promise<ApiResponse> {
		if (this.stream && typeof fetch === "function" && onTextDelta) {
			try {
				return await this.callApiStreaming(onTextDelta);
			} catch (e) {
				console.warn("[ai-daily] streaming failed, using non-streaming", e);
			}
		}
		if (this.stream && typeof fetch === "function") {
			try {
				return await this.callApiStreaming(undefined);
			} catch (e) {
				console.warn("[ai-daily] streaming failed, using non-streaming", e);
			}
		}
		return this.callApiNonStreaming();
	}

	private buildRequestBody(): Record<string, unknown> {
		return {
			model: this.model,
			max_tokens: 4096,
			system: this.systemPrompt,
			tools: VAULT_TOOLS,
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
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify(body),
		});

		if (resp.status >= 400) {
			throw new Error(`Claude API error ${resp.status}: ${resp.text}`);
		}

		return resp.json as ApiResponse;
	}

	private async callApiStreaming(
		onTextDelta?: (s: string) => void
	): Promise<ApiResponse> {
		const body = { ...this.buildRequestBody(), stream: true };
		const jsonBody = JSON.stringify(body);

		try {
			const res = await fetch(API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.apiKey,
					"anthropic-version": "2023-06-01",
				},
				body: jsonBody,
			});

			if (!res.ok) {
				const errText = await res.text();
				throw new Error(`Claude API error ${res.status}: ${errText}`);
			}

			const reader = res.body?.getReader();
			if (!reader) throw new Error("No response body");

			const decoder = new TextDecoder();
			let buffer = "";

			const blocks: (StreamBlock | undefined)[] = [];
			let stopReason = "end_turn";
			let inputTokens = 0;
			let outputTokens = 0;
			const handlers = {
				onTextDelta,
				blocks,
				setStop: (r: string) => {
					stopReason = r;
				},
				addUsage: (i: number, o: number) => {
					inputTokens = i;
					outputTokens = o;
				},
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				let consumed: ReturnType<typeof consumeOneSseEvent>;
				while ((consumed = consumeOneSseEvent(buffer))) {
					buffer = consumed.rest;
					if (consumed.event.trim()) {
						this.parseSseEvent(consumed.event, handlers);
					}
				}
			}

			if (buffer.trim()) {
				this.parseSseEvent(buffer, handlers);
			}

			return this.streamAccumulatorsToResponse(
				blocks,
				stopReason,
				inputTokens,
				outputTokens
			);
		} catch (e) {
			console.warn(
				"[ai-daily] fetch SSE failed; using requestUrl (full body) + same parser",
				e
			);
			const resp = await requestUrl({
				url: API_URL,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.apiKey,
					"anthropic-version": "2023-06-01",
				},
				body: jsonBody,
			});

			if (resp.status >= 400) {
				throw new Error(`Claude API error ${resp.status}: ${resp.text}`);
			}

			return this.parseSsePlainText(resp.text, onTextDelta);
		}
	}

	private parseSsePlainText(
		raw: string,
		onTextDelta?: (s: string) => void
	): ApiResponse {
		const blocks: (StreamBlock | undefined)[] = [];
		let stopReason = "end_turn";
		let inputTokens = 0;
		let outputTokens = 0;
		const handlers = {
			onTextDelta,
			blocks,
			setStop: (r: string) => {
				stopReason = r;
			},
			addUsage: (i: number, o: number) => {
				inputTokens = i;
				outputTokens = o;
			},
		};

		let buffer = raw;
		let consumed: ReturnType<typeof consumeOneSseEvent>;
		while ((consumed = consumeOneSseEvent(buffer))) {
			buffer = consumed.rest;
			if (consumed.event.trim()) {
				this.parseSseEvent(consumed.event, handlers);
			}
		}
		if (buffer.trim()) {
			this.parseSseEvent(buffer, handlers);
		}

		return this.streamAccumulatorsToResponse(
			blocks,
			stopReason,
			inputTokens,
			outputTokens
		);
	}

	private streamAccumulatorsToResponse(
		blocks: (StreamBlock | undefined)[],
		stopReason: string,
		inputTokens: number,
		outputTokens: number
	): ApiResponse {
		const content: ContentBlock[] = [];
		for (const b of blocks) {
			if (!b) continue;
			if (b.kind === "text") {
				content.push({ type: "text", text: b.text });
			} else {
				let input: Record<string, unknown> = {};
				try {
					input = JSON.parse(b.inputJson || "{}") as Record<
						string,
						unknown
					>;
				} catch {
					input = {};
				}
				content.push({
					type: "tool_use",
					id: b.id,
					name: b.name,
					input,
				});
			}
		}

		return {
			content,
			stop_reason: stopReason,
			usage: {
				input_tokens: inputTokens,
				output_tokens: outputTokens,
			},
		};
	}

	private parseSseEvent(
		raw: string,
		ctx: {
			onTextDelta?: (s: string) => void;
			blocks: (StreamBlock | undefined)[];
			setStop: (r: string) => void;
			addUsage: (i: number, o: number) => void;
		}
	): void {
		const lines = raw.split("\n");
		for (const line of lines) {
			if (!line.startsWith("data:")) continue;
			const payload = line.slice(5).trim();
			if (!payload || payload === "[DONE]") continue;
			let data: Record<string, unknown>;
			try {
				data = JSON.parse(payload) as Record<string, unknown>;
			} catch {
				continue;
			}

			const type = data.type as string;

			if (type === "error") {
				const err = data.error as { message?: string } | undefined;
				throw new Error(err?.message ?? "Stream error");
			}

			if (type === "content_block_start") {
				const index = data.index as number;
				const cb = data.content_block as
					| { type: string; id?: string; name?: string }
					| undefined;
				if (!cb) continue;
				if (cb.type === "text") {
					ctx.blocks[index] = { kind: "text", text: "" };
				} else if (cb.type === "tool_use") {
					ctx.blocks[index] = {
						kind: "tool_use",
						id: cb.id ?? "",
						name: cb.name ?? "",
						inputJson: "",
					};
				}
			}

			if (type === "content_block_delta") {
				const index = data.index as number;
				const delta = data.delta as Record<string, unknown> | undefined;
				if (!delta) continue;
				const dt = delta.type as string;
				if (dt === "text_delta") {
					const text = (delta.text as string) ?? "";
					const blk = ctx.blocks[index];
					if (blk && blk.kind === "text") {
						blk.text += text;
						ctx.onTextDelta?.(text);
					}
				} else if (dt === "input_json_delta") {
					const partial = (delta.partial_json as string) ?? "";
					const blk = ctx.blocks[index];
					if (blk && blk.kind === "tool_use") {
						blk.inputJson += partial;
					}
				}
			}

			if (type === "message_delta") {
				const d = data.delta as
					| {
							stop_reason?: string;
							stop_sequence?: string | null;
							usage?: {
								input_tokens?: number;
								output_tokens?: number;
							};
					  }
					| undefined;
				if (d?.stop_reason) ctx.setStop(d.stop_reason);
				let usage = data.usage as
					| { input_tokens?: number; output_tokens?: number }
					| undefined;
				if (!usage && d?.usage) usage = d.usage;
				if (usage) {
					ctx.addUsage(
						usage.input_tokens ?? 0,
						usage.output_tokens ?? 0
					);
				}
			}
		}
	}
}
