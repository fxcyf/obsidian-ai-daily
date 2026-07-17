import { describe, expect, it } from "vitest";
import { appServerRequest, buildCodexHistoryItems } from "./codex-app-server.js";

describe("Codex app-server history", () => {
	it("converts chat history into role-preserving Responses API items", () => {
		expect(buildCodexHistoryItems([
			{ role: "user", content: "question" },
			{ role: "assistant", content: "answer" },
		])).toEqual([
			{ type: "message", role: "user", content: [{ type: "input_text", text: "question" }] },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
		]);
	});

	it("serializes newline-delimited JSON-RPC requests", () => {
		expect(appServerRequest(1, "initialize", { clientInfo: { name: "test", version: "1" } }))
			.toBe('{"id":1,"method":"initialize","params":{"clientInfo":{"name":"test","version":"1"}}}\n');
	});
});
