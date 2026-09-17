import { describe, expect, it } from "vitest";
import {
	BACKEND_CONTEXT_STRATEGIES,
	CONVERSATION_BACKENDS,
	buildTextHistoryHandoff,
	buildTextSeededFirstTurn,
	historyBeforeCurrentTurn,
	planBackendContext,
	resolveCliConversationBackend,
} from "./conversation-context";

describe("conversation backend handoff", () => {
	it("requires an explicit initialization strategy for every supported backend", () => {
		expect(CONVERSATION_BACKENDS).toEqual([
			"api",
			"local-claude-code",
			"local-codex",
			"proxy-claude-code",
			"proxy-codex",
		]);
		expect(Object.keys(BACKEND_CONTEXT_STRATEGIES).sort()).toEqual(
			[...CONVERSATION_BACKENDS].sort()
		);
		expect(BACKEND_CONTEXT_STRATEGIES).toEqual({
			api: "client-managed",
			"local-claude-code": "native-seed",
			"local-codex": "text-seed",
			"proxy-claude-code": "native-seed",
			"proxy-codex": "native-seed",
		});
	});

	it("resolves local and proxy CLI backends without sharing runtime identity", () => {
		expect(resolveCliConversationBackend("local", "codex")).toBe("local-codex");
		expect(resolveCliConversationBackend("proxy", "codex")).toBe("proxy-codex");
		expect(resolveCliConversationBackend("local", "claude-code")).toBe("local-claude-code");
	});

	it("plans one history seed for a new backend session and none for resume", () => {
		const messages = [
			{ role: "user" as const, content: "旧问题", source: "proxy" },
			{ role: "assistant" as const, content: "旧回答", source: "proxy" },
			{ role: "user" as const, content: "继续说", source: "codex" },
		];

		expect(planBackendContext({
			backend: "local-codex",
			hasSession: false,
			messages,
		})).toEqual({
			backend: "local-codex",
			mode: "text-seed",
			history: [
				{ role: "user", content: "旧问题" },
				{ role: "assistant", content: "旧回答" },
			],
		});

		expect(planBackendContext({
			backend: "local-codex",
			hasSession: true,
			messages,
		})).toEqual({
			backend: "local-codex",
			mode: "resume",
			history: [],
		});
	});

	it("collects the persisted conversation before the current user turn", () => {
		expect(historyBeforeCurrentTurn([
			{ role: "user", content: "旧问题", source: "proxy" },
			{ role: "assistant", content: "旧回答", source: "proxy" },
			{ role: "user", content: "继续说", source: "codex" },
		])).toEqual([
			{ role: "user", content: "旧问题" },
			{ role: "assistant", content: "旧回答" },
		]);
	});

	it("builds a role-preserving text handoff for a backend without native seeding", () => {
		const handoff = buildTextHistoryHandoff([
			{ role: "user", content: "我的代号是雨燕" },
			{ role: "assistant", content: "记住了" },
		]);

		expect(handoff).toContain("历史对话上下文");
		expect(handoff).toContain('"role": "user"');
		expect(handoff).toContain('"content": "我的代号是雨燕"');
		expect(handoff).toContain('"role": "assistant"');
	});

	it("does not add a handoff block for a new conversation", () => {
		expect(buildTextHistoryHandoff([])).toBe("");
	});

	it("places prior history between system context and the new Codex turn", () => {
		const prompt = buildTextSeededFirstTurn({
			systemPrompt: "SYSTEM-CONTEXT",
			history: [{ role: "assistant", content: "历史标记-42" }],
			currentMessage: "这个标记是什么？",
		});

		expect(prompt.indexOf("SYSTEM-CONTEXT")).toBeLessThan(prompt.indexOf("历史标记-42"));
		expect(prompt.indexOf("历史标记-42")).toBeLessThan(prompt.indexOf("这个标记是什么？"));
	});
});
