import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import { generateGuideFiles } from "./vault-guide";

describe("vault guide templates", () => {
	it("generates shared Claude and Codex agent entry points", () => {
		const files = generateGuideFiles(DEFAULT_SETTINGS);
		const paths = files.map((file) => file.path);
		const agents = files.find((file) => file.path === "_cortex-guide/AGENTS.md");

		expect(paths).toContain("_cortex-guide/CLAUDE.md");
		expect(paths).toContain("_cortex-guide/AGENTS.md");
		expect(agents?.content).toContain("CLAUDE.md");
		expect(agents?.content).toContain("Codex");
	});
});
