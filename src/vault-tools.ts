import { App, TFile, TFolder, normalizePath } from "obsidian";

const MAX_SEARCH_RESULTS = 10;
const KNOWLEDGE_CONTEXT_TRUNCATE = 2000;

export class VaultTools {
	private app: App;
	private knowledgeFolders: string[];

	constructor(app: App, knowledgeFolders: string[] = []) {
		this.app = app;
		this.knowledgeFolders = knowledgeFolders;
	}

	async execute(
		name: string,
		input: Record<string, unknown>
	): Promise<string> {
		switch (name) {
			case "read_note": {
				const path = typeof input.path === "string" ? input.path : "";
				if (!path) return "Error: path is required";
				if (containsTraversal(path)) return "Error: invalid path";
				return this.readNote(path);
			}
			case "search_vault": {
				const query = typeof input.query === "string" ? input.query : "";
				if (!query) return "Error: query is required";
				const folder = typeof input.folder === "string" ? input.folder : undefined;
				const tag = typeof input.tag === "string" ? input.tag : undefined;
				return this.searchVault(query, folder, tag);
			}
			case "append_to_note": {
				const path = typeof input.path === "string" ? input.path : "";
				const content = typeof input.content === "string" ? input.content : "";
				if (!path || !content) return "Error: path and content are required";
				if (containsTraversal(path)) return "Error: invalid path";
				return this.appendToNote(path, content);
			}
			case "list_notes": {
				const folder = typeof input.folder === "string" ? input.folder : undefined;
				const limit = typeof input.limit === "number" ? input.limit : 20;
				return this.listNotes(folder, limit);
			}
			case "create_note": {
				const path = typeof input.path === "string" ? input.path : "";
				const content = typeof input.content === "string" ? input.content : "";
				if (!path) return "Error: path is required";
				if (containsTraversal(path)) return "Error: invalid path";
				const frontmatter = typeof input.frontmatter === "object" && input.frontmatter !== null
					? input.frontmatter as Record<string, unknown>
					: undefined;
				return this.createNote(path, content, frontmatter);
			}
			case "edit_note": {
				const path = typeof input.path === "string" ? input.path : "";
				const mode = typeof input.mode === "string" ? input.mode : "";
				const replacement = typeof input.replacement === "string" ? input.replacement : "";
				if (!path || !mode) return "Error: path and mode are required";
				if (containsTraversal(path)) return "Error: invalid path";
				return this.editNote(path, mode, input.target, replacement);
			}
			case "rename_note": {
				const path = typeof input.path === "string" ? input.path : "";
				const newPath = typeof input.new_path === "string" ? input.new_path : "";
				if (!path || !newPath) return "Error: path and new_path are required";
				if (containsTraversal(path) || containsTraversal(newPath)) return "Error: invalid path";
				return this.renameNote(path, newPath);
			}
			case "delete_note": {
				const path = typeof input.path === "string" ? input.path : "";
				const confirmed = input.confirmed === true;
				if (!path) return "Error: path is required";
				if (containsTraversal(path)) return "Error: invalid path";
				return this.deleteNote(path, confirmed);
			}
			case "get_links": {
				const path = typeof input.path === "string" ? input.path : "";
				if (!path) return "Error: path is required";
				if (containsTraversal(path)) return "Error: invalid path";
				return this.getLinks(path);
			}
			case "update_frontmatter": {
				const path = typeof input.path === "string" ? input.path : "";
				if (!path) return "Error: path is required";
				if (containsTraversal(path)) return "Error: invalid path";
				const set = typeof input.set === "object" && input.set !== null
					? input.set as Record<string, unknown>
					: undefined;
				const del = Array.isArray(input.delete)
					? (input.delete as string[]).filter(s => typeof s === "string")
					: undefined;
				if (!set && !del) return "Error: at least one of set or delete is required";
				return this.updateFrontmatter(path, set, del);
			}
			default:
				return `Unknown tool: ${name}`;
		}
	}

	private async readNote(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return `File not found: ${path}`;
		}
		return this.app.vault.cachedRead(file);
	}

	private getTagsFromCache(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter?.tags) return [];
		const raw = cache.frontmatter.tags;
		if (Array.isArray(raw)) {
			return raw.map((t: string) => String(t).toLowerCase().replace(/^#/, ""));
		}
		if (typeof raw === "string") {
			return raw.split(",").map((t: string) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean);
		}
		return [];
	}

	private async searchVault(
		query: string,
		folder?: string,
		tag?: string
	): Promise<string> {
		const lowerQuery = query.toLowerCase();
		const lowerTag = tag?.toLowerCase().replace(/^#/, "");
		const results: { path: string; snippet: string }[] = [];
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			if (folder && !file.path.startsWith(folder)) continue;

			if (lowerTag) {
				const tags = this.getTagsFromCache(file);
				if (!tags.includes(lowerTag)) continue;
			}

			const content = await this.app.vault.cachedRead(file);
			const lowerContent = content.toLowerCase();
			const idx = lowerContent.indexOf(lowerQuery);

			if (idx !== -1) {
				const start = Math.max(0, idx - 50);
				const end = Math.min(content.length, idx + query.length + 100);
				const snippet = content.slice(start, end).replace(/\n/g, " ");
				results.push({ path: file.path, snippet: `...${snippet}...` });
			}

			if (results.length >= MAX_SEARCH_RESULTS) break;
		}

		if (results.length === 0) return `No results for "${query}"${tag ? ` with tag #${lowerTag}` : ""}`;

		return results
			.map((r) => `**${r.path}**\n${r.snippet}`)
			.join("\n\n");
	}

	private async appendToNote(
		path: string,
		content: string
	): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return `File not found: ${path}`;
		}
		await this.app.vault.append(file, "\n\n" + content);
		return `Content appended to ${path}`;
	}

	private async listNotes(folder?: string, limit: number = 20): Promise<string> {
		const foldersToList = folder
			? [folder]
			: [...this.knowledgeFolders];

		const allFiles = this.app.vault.getMarkdownFiles().filter((f) =>
			foldersToList.some((dir) => f.path.startsWith(dir + "/") || f.path.startsWith(dir))
		);

		if (allFiles.length === 0) {
			return folder
				? `Folder not found or empty: ${folder}`
				: "No notes found in configured folders.";
		}

		const sorted = allFiles
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, limit);

		return sorted.map((f) => f.path).join("\n");
	}

	private async createNote(
		path: string,
		content: string,
		frontmatter?: Record<string, unknown>
	): Promise<string> {
		const normalized = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing) {
			return `Error: file already exists: ${normalized}`;
		}

		let body = content;
		if (frontmatter && Object.keys(frontmatter).length > 0) {
			body = serializeFrontmatter(frontmatter) + content;
		}

		const dir = normalized.substring(0, normalized.lastIndexOf("/"));
		if (dir) {
			await this.ensureFolder(dir);
		}

		await this.app.vault.create(normalized, body);
		return `Created: ${normalized}`;
	}

	private async editNote(
		path: string,
		mode: string,
		target: unknown,
		replacement: string
	): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return `File not found: ${path}`;
		}

		const content = await this.app.vault.cachedRead(file);

		switch (mode) {
			case "search_replace": {
				const search = typeof target === "string" ? target : "";
				if (!search) return "Error: target string is required for search_replace mode";
				const idx = content.indexOf(search);
				if (idx === -1) return `Error: target text not found in ${path}`;
				const newContent = content.substring(0, idx) + replacement + content.substring(idx + search.length);
				await this.app.vault.modify(file, newContent);
				return `Replaced text in ${path}`;
			}
			case "heading": {
				const heading = typeof target === "string" ? target : "";
				if (!heading) return "Error: target heading is required for heading mode";
				const { start, end } = findHeadingRange(content, heading);
				if (start === -1) return `Error: heading "${heading}" not found in ${path}`;
				const newContent = content.substring(0, start) + replacement + content.substring(end);
				await this.app.vault.modify(file, newContent);
				return `Replaced heading section "${heading}" in ${path}`;
			}
			case "line_range": {
				if (typeof target !== "object" || target === null) {
					return "Error: target must be {start, end} for line_range mode";
				}
				const t = target as Record<string, unknown>;
				const startLine = typeof t.start === "number" ? t.start : -1;
				const endLine = typeof t.end === "number" ? t.end : -1;
				if (startLine < 1 || endLine < startLine) {
					return "Error: invalid line range (start >= 1, end >= start)";
				}
				const lines = content.split("\n");
				if (startLine > lines.length) {
					return `Error: start line ${startLine} exceeds file length (${lines.length} lines)`;
				}
				const before = lines.slice(0, startLine - 1);
				const after = lines.slice(Math.min(endLine, lines.length));
				const newContent = [...before, replacement, ...after].join("\n");
				await this.app.vault.modify(file, newContent);
				return `Replaced lines ${startLine}-${endLine} in ${path}`;
			}
			default:
				return `Error: unknown edit mode "${mode}". Use heading, line_range, or search_replace`;
		}
	}

	private async renameNote(path: string, newPath: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return `File not found: ${path}`;
		}
		const normalizedNew = normalizePath(newPath);
		const existingTarget = this.app.vault.getAbstractFileByPath(normalizedNew);
		if (existingTarget) {
			return `Error: target path already exists: ${normalizedNew}`;
		}
		const dir = normalizedNew.substring(0, normalizedNew.lastIndexOf("/"));
		if (dir) {
			await this.ensureFolder(dir);
		}
		await this.app.fileManager.renameFile(file, normalizedNew);
		return `Renamed: ${path} → ${normalizedNew}`;
	}

	private async deleteNote(path: string, confirmed: boolean): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return `File not found: ${path}`;
		}
		if (!confirmed) {
			const content = await this.app.vault.cachedRead(file);
			const preview = content.length > 300 ? content.substring(0, 300) + "..." : content;
			const size = content.length;
			return `⚠️ 确认删除 ${path}?\n\n文件大小: ${size} 字符\n\n预览:\n${preview}\n\n要执行删除，请带 confirmed: true 再次调用此工具。文件将被移到系统回收站。`;
		}
		await this.app.vault.trash(file, true);
		return `Deleted (moved to trash): ${path}`;
	}

	private getLinks(path: string): string {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return `File not found: ${path}`;
		}

		const outlinks: { path: string; title: string }[] = [];
		const resolvedLinks = this.app.metadataCache.resolvedLinks[path];
		if (resolvedLinks) {
			for (const targetPath of Object.keys(resolvedLinks)) {
				const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
				const title = targetFile instanceof TFile
					? targetFile.basename
					: targetPath;
				outlinks.push({ path: targetPath, title });
			}
		}

		const backlinks: { path: string; title: string }[] = [];
		const allResolved = this.app.metadataCache.resolvedLinks;
		for (const [sourcePath, links] of Object.entries(allResolved)) {
			if (sourcePath === path) continue;
			if (links[path]) {
				const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
				const title = sourceFile instanceof TFile
					? sourceFile.basename
					: sourcePath;
				backlinks.push({ path: sourcePath, title });
			}
		}

		const parts: string[] = [`## Links for ${path}`];

		parts.push(`\n### Outlinks (${outlinks.length})`);
		if (outlinks.length > 0) {
			for (const link of outlinks) {
				parts.push(`- [[${link.title}]] (${link.path})`);
			}
		} else {
			parts.push("_No outgoing links_");
		}

		parts.push(`\n### Backlinks (${backlinks.length})`);
		if (backlinks.length > 0) {
			for (const link of backlinks) {
				parts.push(`- [[${link.title}]] (${link.path})`);
			}
		} else {
			parts.push("_No incoming links_");
		}

		return parts.join("\n");
	}

	private async updateFrontmatter(
		path: string,
		set?: Record<string, unknown>,
		del?: string[]
	): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return `File not found: ${path}`;
		}
		const content = await this.app.vault.cachedRead(file);
		const { frontmatter: existing, body } = parseFrontmatter(content);

		const updated = { ...existing };
		if (set) {
			for (const [k, v] of Object.entries(set)) {
				updated[k] = v;
			}
		}
		if (del) {
			for (const key of del) {
				delete updated[key];
			}
		}

		const newContent = Object.keys(updated).length > 0
			? serializeFrontmatter(updated) + body
			: body;
		await this.app.vault.modify(file, newContent);

		const changes: string[] = [];
		if (set) changes.push(`set: ${Object.keys(set).join(", ")}`);
		if (del) changes.push(`deleted: ${del.join(", ")}`);
		return `Updated frontmatter of ${path} (${changes.join("; ")})`;
	}

	private async ensureFolder(dir: string): Promise<void> {
		const normalized = normalizePath(dir);
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFolder) return;
		await this.app.vault.createFolder(normalized);
	}

	async loadKnowledgeContext(limit: number = 5): Promise<string> {
		const allFiles = this.app.vault.getMarkdownFiles().filter((f) =>
			this.knowledgeFolders.some((dir) => f.path.startsWith(dir + "/") || f.path.startsWith(dir))
		);

		if (allFiles.length === 0) return "";

		const recent = allFiles
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, limit);

		const parts: string[] = [];
		for (const file of recent) {
			const content = await this.app.vault.cachedRead(file);
			const truncated = content.length > KNOWLEDGE_CONTEXT_TRUNCATE
				? content.slice(0, KNOWLEDGE_CONTEXT_TRUNCATE) + "\n\n...(truncated)"
				: content;
			parts.push(`# ${file.path}\n\n${truncated}`);
		}

		return parts.join("\n\n---\n\n");
	}
}

function containsTraversal(path: string): boolean {
	const segments = path.split(/[\\/]/);
	return segments.some((s) => s === ".." || s === ".");
}

const FM_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
	const match = content.match(FM_REGEX);
	if (!match) return { frontmatter: {}, body: content };

	const yamlBlock = match[1];
	const body = content.slice(match[0].length);
	const fm: Record<string, unknown> = {};

	for (const line of yamlBlock.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.substring(0, colonIdx).trim();
		if (!key) continue;
		const rawVal = line.substring(colonIdx + 1).trim();
		if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
			fm[key] = rawVal.slice(1, -1).split(",").map(s => {
				const trimmed = s.trim();
				if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
					(trimmed.startsWith("'") && trimmed.endsWith("'"))) {
					return trimmed.slice(1, -1);
				}
				return trimmed;
			}).filter(Boolean);
		} else if (rawVal === "true") {
			fm[key] = true;
		} else if (rawVal === "false") {
			fm[key] = false;
		} else if (rawVal !== "" && !isNaN(Number(rawVal))) {
			fm[key] = Number(rawVal);
		} else {
			fm[key] = rawVal.replace(/^["']|["']$/g, "");
		}
	}
	return { frontmatter: fm, body };
}

export function serializeFrontmatter(fm: Record<string, unknown>): string {
	const lines: string[] = ["---"];
	for (const [key, value] of Object.entries(fm)) {
		if (Array.isArray(value)) {
			lines.push(`${key}: [${value.map(v => JSON.stringify(String(v))).join(", ")}]`);
		} else if (typeof value === "string") {
			lines.push(`${key}: ${value}`);
		} else {
			lines.push(`${key}: ${JSON.stringify(value)}`);
		}
	}
	lines.push("---", "");
	return lines.join("\n");
}

export function findHeadingRange(content: string, heading: string): { start: number; end: number } {
	const lines = content.split("\n");
	let headingLevel = 0;
	let startIdx = -1;

	for (let i = 0; i < lines.length; i++) {
		const hMatch = lines[i].match(/^(#{1,6})\s+(.*)/);
		if (!hMatch) continue;

		const level = hMatch[1].length;
		const title = hMatch[2].trim();

		if (startIdx === -1 && title === heading) {
			headingLevel = level;
			startIdx = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
			continue;
		}

		if (startIdx !== -1 && level <= headingLevel) {
			const endIdx = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
			return { start: startIdx, end: endIdx };
		}
	}

	if (startIdx !== -1) {
		return { start: startIdx, end: content.length };
	}
	return { start: -1, end: -1 };
}
