import { describe, expect, it } from "vitest";
import {
	appendClaudeEffortArg,
	appendClaudeSessionArgs,
	appendCodexReasoningEffortArg,
} from "./reasoning-effort";

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

	it("keeps app instructions when starting or resuming Claude Code", () => {
		const freshArgs: string[] = [];
		appendClaudeSessionArgs(freshArgs, undefined, "vault instructions");
		expect(freshArgs).toEqual(["--append-system-prompt", "vault instructions"]);

		const resumeArgs: string[] = [];
		appendClaudeSessionArgs(resumeArgs, "session-1", "vault instructions");
		expect(resumeArgs).toEqual([
			"--resume", "session-1",
			"--append-system-prompt", "vault instructions",
		]);
	});
});
