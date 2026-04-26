/**
 * Anthropic SSE 解析与组装。
 *
 * 关注点分离：本模块只做"字节流 → ApiResponse"的纯逻辑，不接触 fetch、
 * 不接触 Obsidian API。Phase 2 在 ClaudeClient 里调用本模块完成真流式。
 *
 * 涉及的真实坑（吸取自 commit `2eb571c` 的教训）：
 * - 事件分隔可能是 `\n\n` 也可能是 `\r\n\r\n`，必须同时识别。
 * - 单个 SSE event 可能横跨多次 reader.read() 的 chunk，解析器必须
 *   维护跨 chunk 缓冲区，不能假设一次 push 就是一个完整事件。
 * - tool_use 的入参是分多次 input_json_delta 拼接的 partial JSON，
 *   只有在 content_block_stop 之后才能 JSON.parse；中途 parse 必挂。
 */

// ── Types（Phase 2 起会成为 claude.ts 的 canonical 类型） ───────────

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

/** Server-side tools 如 web_search 用此类型。结构与 tool_use 相同。 */
export interface ServerToolUseBlock {
	type: "server_tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

/** web_search_tool_result 等内置工具的结果块；保持原样透传。 */
export interface OpaqueBlock {
	type: string;
	[key: string]: unknown;
}

export type ContentBlock = TextBlock | ToolUseBlock | ServerToolUseBlock | OpaqueBlock;

export interface ApiResponse {
	content: ContentBlock[];
	stop_reason: string;
	usage: { input_tokens: number; output_tokens: number };
}

export interface StreamCallbacks {
	/** 模型每个 text_delta 触发一次。 */
	onTextDelta?: (delta: string) => void;
	/** 调试用：tool_use 的 partial JSON 增量。一般 UI 不订阅。 */
	onToolInputDelta?: (toolUseIndex: number, partialJson: string) => void;
}

// ── Low-level SSE byte parser ───────────────────────────────────────

export interface SseEvent {
	event?: string;
	data: string;
}

/**
 * 跨 chunk 缓冲的 SSE 解析器：每次 push 一段字节，吐出在此段中切完整的事件。
 * 同时识别 LF/CRLF 分隔。
 */
export class SseParser {
	private buffer = "";

	push(chunk: string): SseEvent[] {
		this.buffer += chunk;
		const events: SseEvent[] = [];
		while (true) {
			const boundary = findEventBoundary(this.buffer);
			if (!boundary) break;
			const raw = this.buffer.slice(0, boundary.index);
			this.buffer = this.buffer.slice(boundary.index + boundary.sepLen);
			const ev = parseSingleEvent(raw);
			if (ev !== null) events.push(ev);
		}
		return events;
	}

	/** 返回内部残留缓冲（一般用于诊断流非正常结束）。 */
	residual(): string {
		return this.buffer;
	}
}

function findEventBoundary(
	buf: string
): { index: number; sepLen: number } | null {
	const lf = buf.indexOf("\n\n");
	const crlf = buf.indexOf("\r\n\r\n");
	if (lf < 0 && crlf < 0) return null;
	if (crlf < 0) return { index: lf, sepLen: 2 };
	if (lf < 0) return { index: crlf, sepLen: 4 };
	return crlf <= lf
		? { index: crlf, sepLen: 4 }
		: { index: lf, sepLen: 2 };
}

function parseSingleEvent(raw: string): SseEvent | null {
	if (!raw.trim()) return null;
	let event: string | undefined;
	const dataLines: string[] = [];
	for (const line of raw.split(/\r?\n/)) {
		if (line.startsWith(":")) continue; // SSE comment
		if (line.startsWith("event:")) {
			event = line.slice(6).trim();
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).trim());
		}
		// 其它字段（id/retry）我们不用，忽略。
	}
	if (dataLines.length === 0 && !event) return null;
	return { event, data: dataLines.join("\n") };
}

// ── Anthropic event semantics ───────────────────────────────────────

interface AnthropicEvent {
	type: string;
	index?: number;
	content_block?: ContentBlock & { input?: Record<string, unknown> };
	delta?: {
		type?: string;
		text?: string;
		partial_json?: string;
		stop_reason?: string;
		stop_sequence?: string | null;
	};
	message?: {
		usage?: { input_tokens?: number; output_tokens?: number };
	};
	usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * 完整的"字节流 → ApiResponse"装配器。
 * 用法：new AnthropicStreamAssembler({onTextDelta}); .push(chunk); ...; .finalize();
 */
export class AnthropicStreamAssembler {
	private parser = new SseParser();
	private blocks: (ContentBlock | undefined)[] = [];
	private toolJsonBuffers = new Map<number, string>();
	private stopReason = "";
	private usage = { input_tokens: 0, output_tokens: 0 };
	private gotMessageStop = false;
	private callbacks: StreamCallbacks;

	constructor(callbacks: StreamCallbacks = {}) {
		this.callbacks = callbacks;
	}

	push(chunk: string): void {
		for (const ev of this.parser.push(chunk)) {
			if (!ev.data || ev.data === "[DONE]") continue;
			let payload: AnthropicEvent;
			try {
				payload = JSON.parse(ev.data) as AnthropicEvent;
			} catch (e) {
				throw new Error(
					`anthropic-sse: SSE data is not valid JSON (event=${ev.event ?? "?"}): ${ev.data.slice(
						0,
						200
					)}`
				);
			}
			this.handleEvent(payload);
		}
	}

	finalize(): ApiResponse {
		if (!this.gotMessageStop) {
			const residual = this.parser.residual();
			throw new Error(
				`anthropic-sse: stream ended before message_stop (residual=${residual.length}b)`
			);
		}
		const content = this.blocks.filter(
			(b): b is ContentBlock => b !== undefined
		);
		return {
			content,
			stop_reason: this.stopReason || "end_turn",
			usage: this.usage,
		};
	}

	private handleEvent(p: AnthropicEvent): void {
		switch (p.type) {
			case "message_start": {
				const u = p.message?.usage;
				if (u) {
					this.usage = {
						input_tokens: u.input_tokens ?? this.usage.input_tokens,
						output_tokens:
							u.output_tokens ?? this.usage.output_tokens,
					};
				}
				return;
			}
			case "content_block_start": {
				if (p.index === undefined || !p.content_block) return;
				// 复制一份，避免后续就地修改污染 SSE 原始对象。
				const block = { ...p.content_block } as ContentBlock;
				if (
					(block as { type?: string }).type === "tool_use" ||
					(block as { type?: string }).type === "server_tool_use"
				) {
					// 始发可能携带空 input，我们清掉用 partial_json 累积的方式重建。
					(block as ToolUseBlock).input = {};
					this.toolJsonBuffers.set(p.index, "");
				}
				this.blocks[p.index] = block;
				return;
			}
			case "content_block_delta": {
				if (p.index === undefined || !p.delta) return;
				const block = this.blocks[p.index];
				if (p.delta.type === "text_delta") {
					const text = p.delta.text ?? "";
					if (block && block.type === "text") {
						(block as TextBlock).text =
							((block as TextBlock).text ?? "") + text;
					}
					if (text) this.callbacks.onTextDelta?.(text);
				} else if (p.delta.type === "input_json_delta") {
					const partial = p.delta.partial_json ?? "";
					const buf =
						(this.toolJsonBuffers.get(p.index) ?? "") + partial;
					this.toolJsonBuffers.set(p.index, buf);
					if (partial) {
						this.callbacks.onToolInputDelta?.(p.index, partial);
					}
				}
				// thinking_delta / signature_delta / 其它新类型：暂忽略，保留 forward-compat。
				return;
			}
			case "content_block_stop": {
				if (p.index === undefined) return;
				const block = this.blocks[p.index];
				if (
					block &&
					(block.type === "tool_use" || block.type === "server_tool_use")
				) {
					const raw = this.toolJsonBuffers.get(p.index) ?? "";
					this.toolJsonBuffers.delete(p.index);
					if (raw.trim() === "") {
						(block as ToolUseBlock).input = {};
					} else {
						try {
							(block as ToolUseBlock).input = JSON.parse(raw);
						} catch (e) {
							throw new Error(
								`anthropic-sse: tool_use input JSON parse failed at block ${p.index}: ${raw.slice(
									0,
									500
								)}`
							);
						}
					}
				}
				return;
			}
			case "message_delta": {
				if (p.delta?.stop_reason) {
					this.stopReason = p.delta.stop_reason;
				}
				if (p.usage) {
					this.usage = {
						input_tokens:
							p.usage.input_tokens ?? this.usage.input_tokens,
						output_tokens:
							p.usage.output_tokens ?? this.usage.output_tokens,
					};
				}
				return;
			}
			case "message_stop":
				this.gotMessageStop = true;
				return;
			case "ping":
				return;
			case "error":
				throw new Error(
					`anthropic-sse: error event: ${JSON.stringify(p).slice(0, 500)}`
				);
		}
	}
}
