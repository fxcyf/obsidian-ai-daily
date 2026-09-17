import { describe, expect, it } from "vitest";
import { claudeEffortArgs, claudeSessionArgs, codexReasoningConfig } from "./reasoning.js";

describe("proxy reasoning effort transport", () => {
	it("builds Claude CLI arguments", () => {
		expect(claudeEffortArgs("max")).toEqual(["--effort", "max"]);
		expect(claudeEffortArgs()).toEqual([]);
	});

	it("builds Codex app-server config", () => {
		expect(codexReasoningConfig("high")).toEqual({ model_reasoning_effort: "high" });
		expect(codexReasoningConfig()).toBeUndefined();
	});

	it("keeps app instructions on fresh and resumed Proxy Claude sessions", () => {
		expect(claudeSessionArgs(undefined, "vault instructions")).toEqual([
			"--append-system-prompt", "vault instructions",
		]);
		expect(claudeSessionArgs("session-1", "vault instructions")).toEqual([
			"--resume", "session-1",
			"--append-system-prompt", "vault instructions",
		]);
	});
});
