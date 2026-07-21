import { describe, expect, it } from "vitest";
import { claudeEffortArgs, codexReasoningConfig } from "./reasoning.js";

describe("proxy reasoning effort transport", () => {
	it("builds Claude CLI arguments", () => {
		expect(claudeEffortArgs("max")).toEqual(["--effort", "max"]);
		expect(claudeEffortArgs()).toEqual([]);
	});

	it("builds Codex app-server config", () => {
		expect(codexReasoningConfig("high")).toEqual({ model_reasoning_effort: "high" });
		expect(codexReasoningConfig()).toBeUndefined();
	});
});
