import { describe, expect, it } from "vitest";
import { getClaudeCodeModelOptions } from "./model-options";

describe("Claude Code model options", () => {
	it("offers defaults, aliases and pinned model IDs", () => {
		const values = getClaudeCodeModelOptions("sonnet").map(([value]) => value);
		expect(values).toContain("");
		expect(values).toContain("sonnet");
		expect(values).toContain("claude-opus-4-8");
	});

	it("preserves a previously saved custom model", () => {
		expect(getClaudeCodeModelOptions("claude-custom")).toContainEqual([
			"claude-custom",
			"已有自定义模型（claude-custom）",
		]);
	});
});
