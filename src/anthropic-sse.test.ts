import { describe, expect, it, vi } from "vitest";
import {
	AnthropicStreamAssembler,
	SseParser,
	type ApiResponse,
	type ToolUseBlock,
} from "./anthropic-sse";

// ── Helpers ─────────────────────────────────────────────────────────

function ev(eventName: string, data: unknown, sep: "\n\n" | "\r\n\r\n" = "\n\n"): string {
	const lines = sep === "\r\n\r\n" ? "\r\n" : "\n";
	return `event: ${eventName}${lines}data: ${JSON.stringify(data)}${sep}`;
}

function fullTextStream(text: string, sep: "\n\n" | "\r\n\r\n" = "\n\n"): string {
	return [
		ev("message_start", {
			type: "message_start",
			message: { id: "msg_1", usage: { input_tokens: 10, output_tokens: 0 } },
		}, sep),
		ev("content_block_start", {
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		}, sep),
		ev("content_block_delta", {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text },
		}, sep),
		ev("content_block_stop", { type: "content_block_stop", index: 0 }, sep),
		ev("message_delta", {
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: { output_tokens: 5 },
		}, sep),
		ev("message_stop", { type: "message_stop" }, sep),
	].join("");
}

function runRawSse(rawSse: string, callbacks?: ConstructorParameters<typeof AnthropicStreamAssembler>[0]): ApiResponse {
	const a = new AnthropicStreamAssembler(callbacks);
	a.push(rawSse);
	return a.finalize();
}

// ── SseParser ───────────────────────────────────────────────────────

describe("SseParser", () => {
	it("parses LF-separated events", () => {
		const p = new SseParser();
		const out = p.push("event: a\ndata: {\"x\":1}\n\nevent: b\ndata: {\"y\":2}\n\n");
		expect(out).toEqual([
			{ event: "a", data: '{"x":1}' },
			{ event: "b", data: '{"y":2}' },
		]);
	});

	it("parses CRLF-separated events", () => {
		const p = new SseParser();
		const out = p.push("event: a\r\ndata: {\"x\":1}\r\n\r\nevent: b\r\ndata: {\"y\":2}\r\n\r\n");
		expect(out).toEqual([
			{ event: "a", data: '{"x":1}' },
			{ event: "b", data: '{"y":2}' },
		]);
	});

	it("handles mixed LF and CRLF separators in one stream", () => {
		const p = new SseParser();
		const out = p.push(
			"event: a\ndata: 1\n\nevent: b\r\ndata: 2\r\n\r\nevent: c\ndata: 3\n\n"
		);
		expect(out.map((e) => e.data)).toEqual(["1", "2", "3"]);
	});

	it("buffers across chunk boundaries", () => {
		const p = new SseParser();
		expect(p.push("event: a\ndata: he")).toEqual([]);
		expect(p.push("llo")).toEqual([]);
		expect(p.push("\n\n")).toEqual([{ event: "a", data: "hello" }]);
	});

	it("ignores comments and unknown fields", () => {
		const p = new SseParser();
		const out = p.push(": this is a comment\nid: 42\nevent: msg\ndata: hi\n\n");
		expect(out).toEqual([{ event: "msg", data: "hi" }]);
	});

	it("preserves residual buffer when no terminator yet", () => {
		const p = new SseParser();
		p.push("event: a\ndata: partial");
		expect(p.residual()).toBe("event: a\ndata: partial");
	});
});

// ── AnthropicStreamAssembler: text path ─────────────────────────────

describe("AnthropicStreamAssembler — text path", () => {
	it("assembles a single text block end-to-end", () => {
		const onTextDelta = vi.fn();
		const resp = runRawSse(fullTextStream("Hello world"), { onTextDelta });
		expect(resp.content).toEqual([{ type: "text", text: "Hello world" }]);
		expect(resp.stop_reason).toBe("end_turn");
		expect(resp.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
		expect(onTextDelta).toHaveBeenCalledWith("Hello world");
	});

	it("works with CRLF separators (regression for 2eb571c)", () => {
		const sse = fullTextStream("hi", "\r\n\r\n");
		const onTextDelta = vi.fn();
		const a = new AnthropicStreamAssembler({ onTextDelta });
		a.push(sse);
		const resp = a.finalize();
		expect(resp.content).toEqual([{ type: "text", text: "hi" }]);
		expect(onTextDelta).toHaveBeenCalledWith("hi");
	});

	it("handles event split across multiple push() calls", () => {
		const sse = fullTextStream("Hello world");
		const a = new AnthropicStreamAssembler();
		// Feed one byte at a time - extreme stress test for the parser buffering.
		for (let i = 0; i < sse.length; i++) {
			a.push(sse[i]);
		}
		const resp = a.finalize();
		expect(resp.content).toEqual([{ type: "text", text: "Hello world" }]);
	});

	it("accumulates multiple text_delta events into one block", () => {
		const sse = [
			ev("message_start", {
				type: "message_start",
				message: { usage: { input_tokens: 1, output_tokens: 0 } },
			}),
			ev("content_block_start", {
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			}),
			ev("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "Hel" },
			}),
			ev("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "lo" },
			}),
			ev("content_block_stop", { type: "content_block_stop", index: 0 }),
			ev("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 2 },
			}),
			ev("message_stop", { type: "message_stop" }),
		].join("");
		const deltas: string[] = [];
		const a = new AnthropicStreamAssembler({
			onTextDelta: (d) => deltas.push(d),
		});
		a.push(sse);
		const resp = a.finalize();
		expect(resp.content).toEqual([{ type: "text", text: "Hello" }]);
		expect(deltas).toEqual(["Hel", "lo"]);
	});
});

// ── AnthropicStreamAssembler: tool_use path ─────────────────────────

describe("AnthropicStreamAssembler — tool_use path", () => {
	function toolUseStream(partials: string[], finalInput: Record<string, unknown>): string {
		// Note: finalInput is only for human readability of tests; the assembler
		// re-builds .input from concatenating partials and JSON.parse'ing.
		void finalInput;
		const parts = [
			ev("message_start", {
				type: "message_start",
				message: { usage: { input_tokens: 1, output_tokens: 0 } },
			}),
			ev("content_block_start", {
				type: "content_block_start",
				index: 0,
				content_block: {
					type: "tool_use",
					id: "tool_xyz",
					name: "search_vault",
					input: {}, // 始发空 input；assembler 应清掉用 partials 重建
				},
			}),
		];
		for (const p of partials) {
			parts.push(
				ev("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: p },
				})
			);
		}
		parts.push(
			ev("content_block_stop", { type: "content_block_stop", index: 0 }),
			ev("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "tool_use" },
				usage: { output_tokens: 5 },
			}),
			ev("message_stop", { type: "message_stop" })
		);
		return parts.join("");
	}

	it("reassembles tool_use input from JSON partials", () => {
		const sse = toolUseStream(['{"query":', '"hello"', "}"], { query: "hello" });
		const resp = runRawSse(sse);
		expect(resp.content).toHaveLength(1);
		const block = resp.content[0] as ToolUseBlock;
		expect(block.type).toBe("tool_use");
		expect(block.id).toBe("tool_xyz");
		expect(block.name).toBe("search_vault");
		expect(block.input).toEqual({ query: "hello" });
		expect(resp.stop_reason).toBe("tool_use");
	});

	it("treats empty input partials as {}", () => {
		const sse = toolUseStream([], {});
		const resp = runRawSse(sse);
		const block = resp.content[0] as ToolUseBlock;
		expect(block.input).toEqual({});
	});

	it("works when partials are split mid-quote across chunks", () => {
		const sse = toolUseStream(['{"que', 'ry":"hel', 'lo"}'], { query: "hello" });
		const a = new AnthropicStreamAssembler();
		// Stress: split the entire SSE bytes into 7-char chunks.
		for (let i = 0; i < sse.length; i += 7) {
			a.push(sse.slice(i, i + 7));
		}
		const resp = a.finalize();
		const block = resp.content[0] as ToolUseBlock;
		expect(block.input).toEqual({ query: "hello" });
	});

	it("invokes onToolInputDelta with each partial", () => {
		const sse = toolUseStream(['{"a":', "1}"], { a: 1 });
		const partials: string[] = [];
		const a = new AnthropicStreamAssembler({
			onToolInputDelta: (idx, p) => {
				expect(idx).toBe(0);
				partials.push(p);
			},
		});
		a.push(sse);
		a.finalize();
		expect(partials).toEqual(['{"a":', "1}"]);
	});

	it("throws with helpful message when partial JSON is malformed", () => {
		// Missing closing brace; final concatenated buffer is invalid JSON.
		const sse = toolUseStream(['{"a":1'], { a: 1 });
		expect(() => runRawSse(sse)).toThrow(/tool_use input JSON parse failed/);
	});
});

// ── AnthropicStreamAssembler: error & robustness ────────────────────

describe("AnthropicStreamAssembler — error paths", () => {
	it("throws if finalize() before message_stop", () => {
		const a = new AnthropicStreamAssembler();
		a.push(
			ev("message_start", {
				type: "message_start",
				message: { usage: { input_tokens: 1, output_tokens: 0 } },
			})
		);
		expect(() => a.finalize()).toThrow(/before message_stop/);
	});

	it("throws on explicit `error` SSE event", () => {
		const a = new AnthropicStreamAssembler();
		expect(() =>
			a.push(
				ev("error", {
					type: "error",
					error: { type: "overloaded_error", message: "calm down" },
				})
			)
		).toThrow(/error event/);
	});

	it("throws when SSE data is not valid JSON", () => {
		const a = new AnthropicStreamAssembler();
		expect(() => a.push("event: message_start\ndata: not-json\n\n")).toThrow(
			/not valid JSON/
		);
	});

	it("ignores ping events without affecting state", () => {
		const sse =
			ev("ping", { type: "ping" }) + fullTextStream("hi");
		const resp = runRawSse(sse);
		expect(resp.content).toEqual([{ type: "text", text: "hi" }]);
	});

	it("preserves multiple blocks in correct order with mixed types", () => {
		// content_block 0 = text, 1 = tool_use
		const sse = [
			ev("message_start", {
				type: "message_start",
				message: { usage: { input_tokens: 1, output_tokens: 0 } },
			}),
			ev("content_block_start", {
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			}),
			ev("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "let me search" },
			}),
			ev("content_block_stop", { type: "content_block_stop", index: 0 }),
			ev("content_block_start", {
				type: "content_block_start",
				index: 1,
				content_block: {
					type: "tool_use",
					id: "t1",
					name: "search_vault",
					input: {},
				},
			}),
			ev("content_block_delta", {
				type: "content_block_delta",
				index: 1,
				delta: { type: "input_json_delta", partial_json: '{"query":"x"}' },
			}),
			ev("content_block_stop", { type: "content_block_stop", index: 1 }),
			ev("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "tool_use" },
				usage: { output_tokens: 10 },
			}),
			ev("message_stop", { type: "message_stop" }),
		].join("");
		const resp = runRawSse(sse);
		expect(resp.content).toEqual([
			{ type: "text", text: "let me search" },
			{
				type: "tool_use",
				id: "t1",
				name: "search_vault",
				input: { query: "x" },
			},
		]);
		expect(resp.stop_reason).toBe("tool_use");
	});
});
