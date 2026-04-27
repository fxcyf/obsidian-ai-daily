import { describe, expect, it } from "vitest";
import { parseTaggingResponse } from "./auto-tagger";

describe("parseTaggingResponse", () => {
	it("parses valid JSON with tags and summary", () => {
		const response = '{"tags": ["ai", "rag", "llm"], "summary": "一篇关于 RAG 的文章"}';
		const result = parseTaggingResponse(response);
		expect(result).toEqual({
			tags: ["ai", "rag", "llm"],
			summary: "一篇关于 RAG 的文章",
		});
	});

	it("extracts JSON from surrounding text", () => {
		const response = 'Here is the result:\n{"tags": ["ml"], "summary": "机器学习笔记"}\nDone.';
		const result = parseTaggingResponse(response);
		expect(result).toEqual({
			tags: ["ml"],
			summary: "机器学习笔记",
		});
	});

	it("returns null for empty response", () => {
		expect(parseTaggingResponse("")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		expect(parseTaggingResponse("not json at all")).toBeNull();
	});

	it("returns null for malformed JSON", () => {
		expect(parseTaggingResponse("{tags: broken}")).toBeNull();
	});

	it("returns null when both tags and summary are empty", () => {
		const response = '{"tags": [], "summary": ""}';
		expect(parseTaggingResponse(response)).toBeNull();
	});

	it("filters out non-string tags", () => {
		const response = '{"tags": ["valid", 123, null, "also-valid"], "summary": "test"}';
		const result = parseTaggingResponse(response);
		expect(result?.tags).toEqual(["valid", "also-valid"]);
	});

	it("filters out empty string tags", () => {
		const response = '{"tags": ["good", "", "ok"], "summary": "test"}';
		const result = parseTaggingResponse(response);
		expect(result?.tags).toEqual(["good", "ok"]);
	});

	it("handles response with only summary", () => {
		const response = '{"tags": [], "summary": "这是一篇总结"}';
		const result = parseTaggingResponse(response);
		expect(result).toEqual({ tags: [], summary: "这是一篇总结" });
	});

	it("handles response with only tags", () => {
		const response = '{"tags": ["ai"], "summary": ""}';
		const result = parseTaggingResponse(response);
		expect(result).toEqual({ tags: ["ai"], summary: "" });
	});

	it("handles missing summary field", () => {
		const response = '{"tags": ["ai", "ml"]}';
		const result = parseTaggingResponse(response);
		expect(result).toEqual({ tags: ["ai", "ml"], summary: "" });
	});

	it("handles missing tags field", () => {
		const response = '{"summary": "一段摘要"}';
		const result = parseTaggingResponse(response);
		expect(result).toEqual({ tags: [], summary: "一段摘要" });
	});

	it("handles JSON wrapped in markdown code block", () => {
		const response = '```json\n{"tags": ["react", "hooks"], "summary": "React hooks 笔记"}\n```';
		const result = parseTaggingResponse(response);
		expect(result).toEqual({
			tags: ["react", "hooks"],
			summary: "React hooks 笔记",
		});
	});
});
