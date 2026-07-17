import { describe, expect, it } from "vitest";
import { resolveKnowledgePath } from "./knowledge-path.js";

describe("resolveKnowledgePath", () => {
	it("prefixes a path relative to a single logical knowledge root", () => {
		expect(resolveKnowledgePath("Wiki/topic.md", ["KB"])).toBe("KB/Wiki/topic.md");
	});

	it("keeps an already-prefixed vault-relative path", () => {
		expect(resolveKnowledgePath("KB/Wiki/topic.md", ["KB"])).toBe("KB/Wiki/topic.md");
	});

	it("does not guess when multiple knowledge roots are configured", () => {
		expect(resolveKnowledgePath("topic.md", ["Raw", "Wiki"])).toBe("topic.md");
	});

	it("normalizes leading slashes and Windows separators", () => {
		expect(resolveKnowledgePath("/Wiki\\topic.md", ["KB/"])).toBe("KB/Wiki/topic.md");
	});
});
