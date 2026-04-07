/**
 * Vault tool implementations — the "hands" of the agent.
 * Executes tool calls from Claude against the Obsidian vault.
 */

import { App, TFile, TFolder } from "obsidian";

export class VaultTools {
	private app: App;
	private dailyFolder: string;
	private knowledgeFolders: string[];

	constructor(app: App, dailyFolder: string, knowledgeFolders: string[] = []) {
		this.app = app;
		this.dailyFolder = dailyFolder;
		this.knowledgeFolders = knowledgeFolders;
	}

	/** Route a tool call to the right handler. */
	async execute(
		name: string,
		input: Record<string, unknown>
	): Promise<string> {
		switch (name) {
			case "read_note":
				return this.readNote(input.path as string);
			case "search_vault":
				return this.searchVault(
					input.query as string,
					input.folder as string | undefined,
					input.tag as string | undefined
				);
			case "append_to_note":
				return this.appendToNote(
					input.path as string,
					input.content as string
				);
			case "list_notes":
				return this.listNotes(
					input.folder as string | undefined,
					(input.limit as number) || 20
				);
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

	/** Parse YAML frontmatter tags from note content. */
	private parseTags(content: string): string[] {
		const match = content.match(/^---\n([\s\S]*?)\n---/);
		if (!match) return [];
		const yaml = match[1];
		// Match tags: [a, b] or tags:\n- a\n- b
		const tagsMatch = yaml.match(/^tags:\s*\[([^\]]*)\]/m);
		if (tagsMatch) {
			return tagsMatch[1].split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
		}
		const listTags: string[] = [];
		const lines = yaml.split("\n");
		let inTags = false;
		for (const line of lines) {
			if (/^tags:\s*$/.test(line)) {
				inTags = true;
				continue;
			}
			if (inTags) {
				const item = line.match(/^\s*-\s+(.+)/);
				if (item) {
					listTags.push(item[1].trim().toLowerCase());
				} else {
					break;
				}
			}
		}
		return listTags;
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

			const content = await this.app.vault.cachedRead(file);

			// Tag filter
			if (lowerTag) {
				const tags = this.parseTags(content);
				if (!tags.includes(lowerTag)) continue;
			}

			const lowerContent = content.toLowerCase();
			const idx = lowerContent.indexOf(lowerQuery);

			if (idx !== -1) {
				const start = Math.max(0, idx - 50);
				const end = Math.min(content.length, idx + query.length + 100);
				const snippet = content.slice(start, end).replace(/\n/g, " ");
				results.push({ path: file.path, snippet: `...${snippet}...` });
			}

			if (results.length >= 10) break;
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

	/** List notes in a specific folder, or all knowledge folders + daily folder if not specified. */
	private async listNotes(folder?: string, limit: number = 20): Promise<string> {
		const foldersToList = folder
			? [folder]
			: [this.dailyFolder, ...this.knowledgeFolders];

		const allFiles: TFile[] = [];

		for (const folderPath of foldersToList) {
			const f = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(f instanceof TFolder)) continue;
			const mdFiles = f.children.filter(
				(c): c is TFile => c instanceof TFile && c.extension === "md"
			);
			allFiles.push(...mdFiles);
		}

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

	/** Load recent daily notes as context string. */
	async loadRecentContext(days: number): Promise<string> {
		const folder = this.app.vault.getAbstractFileByPath(this.dailyFolder);
		if (!(folder instanceof TFolder)) return "";

		const files = folder.children
			.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
			.sort((a, b) => b.basename.localeCompare(a.basename))
			.slice(0, days);

		const parts: string[] = [];
		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			parts.push(`# ${file.basename}\n\n${content}`);
		}

		return parts.join("\n\n---\n\n");
	}

	/** Load recent notes from knowledge folders as context. */
	async loadKnowledgeContext(limit: number = 5): Promise<string> {
		const allFiles: TFile[] = [];

		for (const folderPath of this.knowledgeFolders) {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) continue;
			const mdFiles = folder.children.filter(
				(c): c is TFile => c instanceof TFile && c.extension === "md"
			);
			allFiles.push(...mdFiles);
		}

		if (allFiles.length === 0) return "";

		const recent = allFiles
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, limit);

		const parts: string[] = [];
		for (const file of recent) {
			const content = await this.app.vault.cachedRead(file);
			// Truncate long articles to keep context manageable
			const truncated = content.length > 2000
				? content.slice(0, 2000) + "\n\n...(truncated)"
				: content;
			parts.push(`# ${file.path}\n\n${truncated}`);
		}

		return parts.join("\n\n---\n\n");
	}
}
