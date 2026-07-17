import { describe, expect, it } from "vitest";
import toolPolicy from "../agent-tool-policy.json";
import {
	FEED_TOOL_DEFS,
	PODCAST_TOOL_DEFS,
	TOOL_DEFS,
	WEREAD_TOOL_DEF,
} from "./tool-definitions";

describe("agent tool policy", () => {
	const definedMcpTools = new Set([
		...TOOL_DEFS,
		...PODCAST_TOOL_DEFS,
		...FEED_TOOL_DEFS,
		WEREAD_TOOL_DEF,
	].map((tool) => tool.name));

	it("only references defined MCP tools", () => {
		const configured = [
			...toolPolicy.codex.readOnlyMcp,
			...toolPolicy.codex.vaultWriteMcp,
			...toolPolicy.codex.alwaysDisabledMcp,
		];
		expect(configured.filter((name) => !definedMcpTools.has(name))).toEqual([]);
	});

	it("keeps destructive tools out of enabled profiles", () => {
		const enabled = new Set([
			...toolPolicy.codex.readOnlyMcp,
			...toolPolicy.codex.vaultWriteMcp,
		]);
		for (const name of toolPolicy.codex.alwaysDisabledMcp) {
			expect(enabled.has(name)).toBe(false);
		}
	});

	it("keeps Claude Code shell and direct write tools disabled", () => {
		for (const tools of [
			toolPolicy.claudeCode.desktopBuiltins,
			toolPolicy.claudeCode.proxyBuiltins,
		]) {
			expect(tools).not.toContain("Bash");
			expect(tools).not.toContain("Write");
			expect(tools).not.toContain("Edit");
		}
	});
});
