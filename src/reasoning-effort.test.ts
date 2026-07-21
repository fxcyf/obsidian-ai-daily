import { describe, expect, it } from "vitest";
import { appendClaudeEffortArg, appendCodexReasoningEffortArg } from "./reasoning-effort";

describe("desktop reasoning effort arguments", () => {
	it("passes Claude effort through the native CLI flag", () => {
		const args = ["-p", "hello"];
		appendClaudeEffortArg(args, "high");
		expect(args).toEqual(["-p", "hello", "--effort", "high"]);
	});

	it("passes Codex effort through the supported config override", () => {
		const args = ["exec", "hello"];
		appendCodexReasoningEffortArg(args, "xhigh");
		expect(args).toEqual(["exec", "hello", "-c", 'model_reasoning_effort="xhigh"']);
	});

	it("inherits CLI defaults when effort is empty", () => {
		const args: string[] = [];
		appendClaudeEffortArg(args, "");
		appendCodexReasoningEffortArg(args, "");
		expect(args).toEqual([]);
	});
});
