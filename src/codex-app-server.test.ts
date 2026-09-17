import { describe, expect, it } from "vitest";
import {
	appServerRequest,
	buildCodexHistoryItems,
	buildCodexThreadOpenRequest,
} from "./codex-app-server";

describe("local Codex app-server history", () => {
	it("converts UI history into native role-preserving thread items", () => {
		expect(buildCodexHistoryItems([
			{ role: "user", content: "question" },
			{ role: "assistant", content: "answer" },
		])).toEqual([
			{ type: "message", role: "user", content: [{ type: "input_text", text: "question" }] },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
		]);
	});

	it("serializes newline-delimited app-server requests", () => {
		expect(appServerRequest(3, "thread/inject_items", { threadId: "thread-1", items: [] }))
			.toBe('{"id":3,"method":"thread/inject_items","params":{"threadId":"thread-1","items":[]}}\n');
	});

	it("starts with developer instructions but resumes only the native thread", () => {
		expect(buildCodexThreadOpenRequest({
			cwd: "/vault",
			model: "gpt-test",
			reasoningEffort: "high",
			systemPrompt: "vault instructions",
		})).toEqual({
			method: "thread/start",
			params: {
				cwd: "/vault",
				approvalPolicy: "never",
				sandbox: "read-only",
				model: "gpt-test",
				config: { model_reasoning_effort: "high" },
				ephemeral: false,
				developerInstructions: "vault instructions",
			},
		});

		const resume = buildCodexThreadOpenRequest({
			sessionId: "thread-1",
			cwd: "/vault",
			systemPrompt: "must not be repeated",
		});
		expect(resume.method).toBe("thread/resume");
		expect(resume.params).toEqual(expect.objectContaining({ threadId: "thread-1" }));
		expect(resume.params).not.toHaveProperty("developerInstructions");
	});
});
