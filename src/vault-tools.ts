import { App, TFile, TFolder } from "obsidian";

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
