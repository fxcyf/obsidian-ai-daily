import { describe, expect, it } from "vitest";
import {
	BACKEND_CONTEXT_STRATEGIES,
	CONVERSATION_BACKENDS,
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
			"local-codex": "native-seed",
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
			mode: "native-seed",
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

});
