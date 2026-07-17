import { describe, expect, it } from "vitest";
import { normalizeMarkdownForObsidian } from "./markdown-normalize";

describe("normalizeMarkdownForObsidian", () => {
	it("converts Codex LaTeX delimiters to Obsidian MathJax delimiters", () => {
		const input = "Before \\(c_i\\).\n\n\\[\nD \\longrightarrow c_i\n\\]";
		expect(normalizeMarkdownForObsidian(input)).toBe(
			"Before $c_i$.\n\n$$\nD \\longrightarrow c_i\n$$"
		);
	});

	it("preserves delimiters inside inline and fenced code", () => {
		const input = "`\\(inline\\)`\n```tex\n\\[code\\]\n```\n\\(math\\)";
		expect(normalizeMarkdownForObsidian(input)).toBe(
			"`\\(inline\\)`\n```tex\n\\[code\\]\n```\n$math$"
		);
	});
});
