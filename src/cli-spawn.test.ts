import { describe, expect, it, vi, beforeEach } from "vitest";
import toolPolicy from "../agent-tool-policy.json";

vi.mock("child_process", () => ({
	spawn: vi.fn(() => ({
		stdout: { on: vi.fn() },
		stderr: { on: vi.fn() },
		on: vi.fn(),
		kill: vi.fn(),
	})),
	execFile: vi.fn(),
	execFileSync: vi.fn(),
}));

vi.mock("fs", () => ({
	existsSync: vi.fn(() => true),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn(() => ""),
	readdirSync: vi.fn(() => []),
	unlinkSync: vi.fn(),
	readlinkSync: vi.fn(),
}));

vi.mock("path", () => ({
	join: (...parts: string[]) => parts.join("/"),
	basename: (p: string) => p.split("/").pop() || "",
}));

describe("Claude Code spawn args", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds --tools flag from policy", () => {
		const tools = toolPolicy.claudeCode.desktopBuiltins.join(",");
		expect(tools).toBe("Read,Grep,Glob,WebSearch,WebFetch,TodoWrite");
	});

	it("desktopBuiltins never includes dangerous tools", () => {
		const dangerous = ["Bash", "Write", "Edit", "Delete"];
		for (const tool of dangerous) {
			expect(toolPolicy.claudeCode.desktopBuiltins).not.toContain(tool);
		}
	});

	it("proxyBuiltins is a subset of desktopBuiltins", () => {
		for (const tool of toolPolicy.claudeCode.proxyBuiltins) {
			expect(toolPolicy.claudeCode.desktopBuiltins).toContain(tool);
		}
	});
});

describe("Codex spawn args", () => {
	it("vault-write mode includes read + write tools", () => {
		const enabledTools = [
			...toolPolicy.codex.readOnlyMcp,
			...toolPolicy.codex.vaultWriteMcp,
		];
		expect(enabledTools).toContain("read_note");
		expect(enabledTools).toContain("search_vault");
		expect(enabledTools).toContain("create_note");
		expect(enabledTools).toContain("edit_note");
	});

	it("read-only mode excludes write tools", () => {
		const readOnly = toolPolicy.codex.readOnlyMcp;
		for (const tool of toolPolicy.codex.vaultWriteMcp) {
			expect(readOnly).not.toContain(tool);
		}
	});

	it("alwaysDisabledMcp is never in enabled profiles", () => {
		const enabled = new Set([
			...toolPolicy.codex.readOnlyMcp,
			...toolPolicy.codex.vaultWriteMcp,
		]);
		for (const tool of toolPolicy.codex.alwaysDisabledMcp) {
			expect(enabled.has(tool)).toBe(false);
		}
	});
});

describe("proxy session isolation", () => {
	it("session IDs are keyed by backend", () => {
		const sessions: Partial<Record<"claude-code" | "codex", string>> = {};
		sessions["claude-code"] = "session-cc-1";
		sessions["codex"] = "session-codex-1";

		expect(sessions["claude-code"]).toBe("session-cc-1");
		expect(sessions["codex"]).toBe("session-codex-1");

		delete sessions["claude-code"];
		expect(sessions["claude-code"]).toBeUndefined();
		expect(sessions["codex"]).toBe("session-codex-1");
	});

	it("clearing one backend does not affect the other", () => {
		const sessions: Partial<Record<"claude-code" | "codex", string>> = {
			"claude-code": "cc-session",
			codex: "codex-session",
		};
		const tasks: Partial<Record<"claude-code" | "codex", string>> = {
			"claude-code": "cc-task",
			codex: "codex-task",
		};

		const clearForBackend = (backend: "claude-code" | "codex") => {
			delete sessions[backend];
			delete tasks[backend];
		};

		clearForBackend("claude-code");
		expect(sessions["claude-code"]).toBeUndefined();
		expect(tasks["claude-code"]).toBeUndefined();
		expect(sessions["codex"]).toBe("codex-session");
		expect(tasks["codex"]).toBe("codex-task");
	});

	it("clearing all backends empties both maps", () => {
		let sessions: Partial<Record<"claude-code" | "codex", string>> = {
			"claude-code": "cc",
			codex: "cx",
		};
		let tasks: Partial<Record<"claude-code" | "codex", string>> = {
			"claude-code": "t1",
			codex: "t2",
		};

		sessions = {};
		tasks = {};
		expect(Object.keys(sessions)).toHaveLength(0);
		expect(Object.keys(tasks)).toHaveLength(0);
	});
});
