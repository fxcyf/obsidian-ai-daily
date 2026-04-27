import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter, findHeadingRange } from "./vault-tools";

describe("parseFrontmatter", () => {
	it("parses YAML frontmatter with string, array, and boolean values", () => {
		const content = `---
title: My Note
tags: [ai, rag]
draft: true
count: 42
---
# Hello

Body text`;
		const { frontmatter, body } = parseFrontmatter(content);
		expect(frontmatter.title).toBe("My Note");
		expect(frontmatter.tags).toEqual(["ai", "rag"]);
		expect(frontmatter.draft).toBe(true);
		expect(frontmatter.count).toBe(42);
		expect(body).toBe("# Hello\n\nBody text");
	});

	it("returns empty frontmatter for content without YAML header", () => {
		const content = "# Just a heading\n\nSome text";
		const { frontmatter, body } = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe(content);
	});

	it("handles quoted array values", () => {
		const content = `---
tags: ["hello world", "foo bar"]
---
body`;
		const { frontmatter } = parseFrontmatter(content);
		expect(frontmatter.tags).toEqual(["hello world", "foo bar"]);
	});

	it("handles false boolean", () => {
		const content = `---
published: false
---
body`;
		const { frontmatter } = parseFrontmatter(content);
		expect(frontmatter.published).toBe(false);
	});
});

describe("serializeFrontmatter", () => {
	it("serializes object to YAML frontmatter string", () => {
		const fm = { title: "Test", tags: ["ai", "ml"], draft: true };
		const result = serializeFrontmatter(fm);
		expect(result).toBe('---\ntitle: Test\ntags: ["ai", "ml"]\ndraft: true\n---\n');
	});

	it("handles empty object", () => {
		const result = serializeFrontmatter({});
		expect(result).toBe("---\n---\n");
	});
});

describe("findHeadingRange", () => {
	const content = `# Title

Intro text.

## Section A

Content A.

### Subsection A1

Nested content.

## Section B

Content B.`;

	it("finds a top-level heading range", () => {
		const { start, end } = findHeadingRange(content, "Title");
		expect(start).toBe(0);
		expect(content.substring(start, end)).toContain("Intro text.");
		expect(content.substring(start, end)).toContain("## Section A");
	});

	it("finds a mid-level heading and includes sub-headings", () => {
		const { start, end } = findHeadingRange(content, "Section A");
		const section = content.substring(start, end);
		expect(section).toContain("Content A.");
		expect(section).toContain("### Subsection A1");
		expect(section).not.toContain("Content B.");
	});

	it("finds heading at end of file", () => {
		const { start, end } = findHeadingRange(content, "Section B");
		const section = content.substring(start, end);
		expect(section).toContain("Content B.");
		expect(end).toBe(content.length);
	});

	it("returns -1 for non-existent heading", () => {
		const { start, end } = findHeadingRange(content, "Non-existent");
		expect(start).toBe(-1);
		expect(end).toBe(-1);
	});
});
