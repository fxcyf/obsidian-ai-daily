import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	newSessionId,
	titleFromMessages,
	isValidChatSession,
	shouldPruneToday,
	type PersistedMessage,
} from "./chat-session";

describe("newSessionId", () => {
	it("returns a string matching YYYY-MM-DD_HHmmss format", () => {
		const id = newSessionId();
		expect(id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}$/);
	});
});

describe("titleFromMessages", () => {
	it("returns first user message trimmed to 30 chars", () => {
		const msgs: PersistedMessage[] = [
			{ role: "user", content: "Hello world" },
			{ role: "assistant", content: "Hi!" },
		];
		expect(titleFromMessages(msgs)).toBe("Hello world");
	});

	it("truncates long messages with ellipsis", () => {
		const long = "A".repeat(50);
		const msgs: PersistedMessage[] = [{ role: "user", content: long }];
		expect(titleFromMessages(msgs)).toBe("A".repeat(30) + "…");
	});

	it("returns default title when no user messages", () => {
		const msgs: PersistedMessage[] = [
			{ role: "assistant", content: "Hi!" },
		];
		expect(titleFromMessages(msgs)).toBe("新对话");
	});

	it("returns default title for empty array", () => {
		expect(titleFromMessages([])).toBe("新对话");
	});

	it("collapses whitespace", () => {
		const msgs: PersistedMessage[] = [
			{ role: "user", content: "  hello   world  " },
		];
		expect(titleFromMessages(msgs)).toBe("hello world");
	});
});

describe("isValidChatSession", () => {
	const valid = {
		id: "2025-01-01_120000",
		title: "Test",
		model: "claude-haiku-4-5",
		created: "2025-01-01T12:00:00Z",
		updated: "2025-01-01T12:00:00Z",
		messages: [{ role: "user", content: "hi" }],
	};

	it("accepts a valid session", () => {
		expect(isValidChatSession(valid)).toBe(true);
	});

	it("rejects null", () => {
		expect(isValidChatSession(null)).toBe(false);
	});

	it("rejects non-object", () => {
		expect(isValidChatSession("string")).toBe(false);
	});

	it("rejects missing fields", () => {
		const { id, ...rest } = valid;
		expect(isValidChatSession(rest)).toBe(false);
	});

	it("rejects invalid message shape", () => {
		expect(
			isValidChatSession({ ...valid, messages: [{ role: 123 }] })
		).toBe(false);
	});

	it("accepts empty messages array", () => {
		expect(isValidChatSession({ ...valid, messages: [] })).toBe(true);
	});
});

describe("shouldPruneToday", () => {
	const store: Record<string, string> = {};

	beforeEach(() => {
		for (const k of Object.keys(store)) delete store[k];
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => { store[k] = v; },
			removeItem: (k: string) => { delete store[k]; },
			clear: () => { for (const k of Object.keys(store)) delete store[k]; },
		});
	});

	it("returns true on first call", () => {
		expect(shouldPruneToday()).toBe(true);
	});

	it("returns false on second call same day", () => {
		shouldPruneToday();
		expect(shouldPruneToday()).toBe(false);
	});
});
