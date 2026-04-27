import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { VaultOps, parseFrontmatter, serializeFrontmatter, findHeadingRange, containsTraversal } from "./vault-ops.js";

let tmpDir: string;
let vault: VaultOps;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-test-"));
	vault = new VaultOps(tmpDir, ["Raw", "Wiki"]);
	await fs.mkdir(path.join(tmpDir, "Raw"), { recursive: true });
	await fs.mkdir(path.join(tmpDir, "Wiki"), { recursive: true });
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("parseFrontmatter", () => {
	it("parses basic frontmatter", () => {
		const { frontmatter, body } = parseFrontmatter("---\ntags: [\"ai\", \"rag\"]\nsummary: test\n---\nHello");
		expect(frontmatter.tags).toEqual(["ai", "rag"]);
		expect(frontmatter.summary).toBe("test");
		expect(body).toBe("Hello");
	});

	it("handles missing frontmatter", () => {
		const { frontmatter, body } = parseFrontmatter("Just content");
		expect(frontmatter).toEqual({});
		expect(body).toBe("Just content");
	});

	it("parses booleans and numbers", () => {
		const { frontmatter } = parseFrontmatter("---\norganized: true\ncount: 42\n---\n");
		expect(frontmatter.organized).toBe(true);
		expect(frontmatter.count).toBe(42);
	});
});

describe("serializeFrontmatter", () => {
	it("serializes object to YAML", () => {
		const result = serializeFrontmatter({ tags: ["ai", "rag"], summary: "test" });
		expect(result).toContain("---");
		expect(result).toContain('tags: ["ai", "rag"]');
		expect(result).toContain("summary: test");
	});
});

describe("findHeadingRange", () => {
	it("finds heading section", () => {
		const content = "# Title\nSome text\n## Section A\nContent A\n## Section B\nContent B";
		const { start, end } = findHeadingRange(content, "Section A");
		expect(start).toBeGreaterThan(0);
		expect(content.slice(start, end)).toContain("Content A");
		expect(content.slice(start, end)).not.toContain("Content B");
	});

	it("returns -1 for missing heading", () => {
		const { start } = findHeadingRange("# Title\nContent", "Missing");
		expect(start).toBe(-1);
	});
});

describe("containsTraversal", () => {
	it("detects ..", () => expect(containsTraversal("../etc")).toBe(true));
	it("detects .", () => expect(containsTraversal("./foo")).toBe(true));
	it("allows normal paths", () => expect(containsTraversal("Raw/note.md")).toBe(false));
});

describe("VaultOps", () => {
	it("creates and reads a note", async () => {
		const result = await vault.createNote("Wiki/test.md", "Hello world");
		expect(result).toContain("Created");
		const content = await vault.readNote("Wiki/test.md");
		expect(content).toBe("Hello world");
	});

	it("creates note with frontmatter", async () => {
		await vault.createNote("Wiki/fm.md", "Body", { tags: ["ai"], summary: "test" });
		const content = await vault.readNote("Wiki/fm.md");
		expect(content).toContain("---");
		expect(content).toContain("tags:");
		expect(content).toContain("Body");
	});

	it("prevents duplicate creation", async () => {
		await vault.createNote("Wiki/dup.md", "First");
		const result = await vault.createNote("Wiki/dup.md", "Second");
		expect(result).toContain("already exists");
	});

	it("searches vault", async () => {
		await vault.createNote("Raw/article.md", "Machine learning is great");
		const result = await vault.searchVault("machine learning");
		expect(result).toContain("article.md");
	});

	it("searches with folder filter", async () => {
		await vault.createNote("Raw/a.md", "topic X");
		await vault.createNote("Wiki/b.md", "topic X");
		const result = await vault.searchVault("topic X", "Wiki");
		expect(result).toContain("Wiki/b.md");
		expect(result).not.toContain("Raw/a.md");
	});

	it("searches with tag filter", async () => {
		await vault.createNote("Raw/tagged.md", "content here", { tags: ["ai"] });
		await vault.createNote("Raw/untagged.md", "content here");
		const result = await vault.searchVault("content", undefined, "ai");
		expect(result).toContain("tagged.md");
		expect(result).not.toContain("untagged.md");
	});

	it("lists notes", async () => {
		await vault.createNote("Raw/a.md", "A");
		await vault.createNote("Raw/b.md", "B");
		const result = await vault.listNotes("Raw");
		expect(result).toContain("Raw/a.md");
		expect(result).toContain("Raw/b.md");
	});

	it("appends to note", async () => {
		await vault.createNote("Wiki/append.md", "Start");
		await vault.appendToNote("Wiki/append.md", "Added");
		const content = await vault.readNote("Wiki/append.md");
		expect(content).toContain("Start");
		expect(content).toContain("Added");
	});

	it("edits note with search_replace", async () => {
		await vault.createNote("Wiki/edit.md", "Hello world");
		await vault.editNote("Wiki/edit.md", "search_replace", "world", "universe");
		const content = await vault.readNote("Wiki/edit.md");
		expect(content).toBe("Hello universe");
	});

	it("renames note", async () => {
		await vault.createNote("Raw/old.md", "Content");
		const result = await vault.renameNote("Raw/old.md", "Wiki/new.md");
		expect(result).toContain("Renamed");
		const content = await vault.readNote("Wiki/new.md");
		expect(content).toBe("Content");
		const old = await vault.readNote("Raw/old.md");
		expect(old).toContain("File not found");
	});

	it("deletes note with two-step confirm", async () => {
		await vault.createNote("Raw/del.md", "To delete");
		const preview = await vault.deleteNote("Raw/del.md", false);
		expect(preview).toContain("确认删除");
		const result = await vault.deleteNote("Raw/del.md", true);
		expect(result).toContain("Deleted");
	});

	it("updates frontmatter", async () => {
		await vault.createNote("Wiki/fm2.md", "Body", { tags: ["old"], draft: true });
		await vault.updateFrontmatter("Wiki/fm2.md", { tags: ["new"], summary: "updated" }, ["draft"]);
		const content = await vault.readNote("Wiki/fm2.md");
		const { frontmatter } = parseFrontmatter(content);
		expect(frontmatter.tags).toEqual(["new"]);
		expect(frontmatter.summary).toBe("updated");
		expect(frontmatter.draft).toBeUndefined();
	});

	it("gets links", async () => {
		await vault.createNote("Wiki/a.md", "See [[b]]");
		await vault.createNote("Wiki/b.md", "Referenced by a");
		const result = await vault.getLinks("Wiki/a.md");
		expect(result).toContain("Outlinks (1)");
		expect(result).toContain("[[b]]");
	});
});
