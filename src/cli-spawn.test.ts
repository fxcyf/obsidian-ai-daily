import { describe, expect, it, vi, beforeEach } from "vitest";
import { existsSync } from "fs";
import toolPolicy from "../agent-tool-policy.json";
import { buildCodexMcpArgs, spawnCodex } from "./codex";
import { buildEnhancedPath, findNodeExecutable } from "./claude-code";

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

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(existsSync).mockReturnValue(true);
});

describe("Claude Code spawn args", () => {
	it("builds --tools flag from policy", () => {
		const tools = toolPolicy.claudeCode.desktopBuiltins.join(",");
		expect(tools).toBe("Read,Grep,Glob,WebSearch,WebFetch,TodoWrite,ToolSearch");
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
	it("uses the shared enhanced Node path when spawning the MCP server", () => {
		const home = process.env.HOME || "";
		const nodeBin = findNodeExecutable(home);
		expect(nodeBin).not.toBeNull();
		expect(buildEnhancedPath(home).split(":")).toContain(nodeBin!.replace(/\/node$/, ""));
	});

	it("fails clearly before spawning when the embedded MCP file is missing", () => {
		vi.mocked(existsSync).mockImplementation((path) => path !== "/missing/mcp-server.mjs");
		const onError = vi.fn();

		spawnCodex("prompt", {
			mcpConfig: {
				mcpServerPath: "/missing/mcp-server.mjs",
				vaultPath: "/vault",
				knowledgeFolders: ["Wiki"],
			},
		}, { onText: vi.fn(), onError, onDone: vi.fn() });

		expect(onError).toHaveBeenCalledWith(expect.stringContaining("Obsidian MCP server file not found"));
	});

	it("injects the Obsidian MCP server without global config writes", () => {
		const args = buildCodexMcpArgs({
			mcpServerPath: "/tmp/ai-daily-mcp/mcp-server.mjs",
			vaultPath: "/vault/Personal Notes",
			knowledgeFolders: ["Raw", "Wiki"],
			wereadApiKey: "secret-key",
			nodeBin: "/usr/bin/node",
		});
		const configValues = args.filter((_, index) => index % 2 === 1);

		expect(args.filter((arg) => arg === "-c")).toHaveLength(6);
		expect(configValues).toContain('mcp_servers.obsidian-vault.enabled=true');
		expect(configValues).toContain('mcp_servers.obsidian-vault.command="/usr/bin/node"');
		expect(configValues).toContain('mcp_servers.obsidian-vault.args=["/tmp/ai-daily-mcp/mcp-server.mjs"]');
		expect(configValues).toContain('mcp_servers.obsidian-vault.env.VAULT_PATH="/vault/Personal Notes"');
		expect(configValues).toContain('mcp_servers.obsidian-vault.env.KNOWLEDGE_FOLDERS="Raw,Wiki"');
		expect(configValues).toContain('mcp_servers.obsidian-vault.env.WEREAD_API_KEY="secret-key"');
	});

	it("omits the WeRead secret when it is not configured", () => {
		const args = buildCodexMcpArgs({
			mcpServerPath: "/tmp/mcp.mjs",
			vaultPath: "/vault",
			knowledgeFolders: ["Wiki"],
			nodeBin: "node",
		});
		expect(args.join(" ")).not.toContain("WEREAD_API_KEY");
	});

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
