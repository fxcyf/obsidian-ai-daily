/**
 * Vault tool implementations — the "hands" of the agent.
 * Executes tool calls from Claude against the Obsidian vault.
 */

import { App, TFile, TFolder } from "obsidian";

export class VaultTools {
	private app: App;
	private dailyFolder: string;

	constructor(app: App, dailyFolder: string) {
		this.app = app;
		this.dailyFolder = dailyFolder;
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
					input.folder as string | undefined
				);
			case "append_to_note":
				return this.appendToNote(
					input.path as string,
					input.content as string
				);
			case "list_daily_notes":
				return this.listDailyNotes(
					(input.limit as number) || 10
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

	private async searchVault(
		query: string,
		folder?: string
	): Promise<string> {
		const lowerQuery = query.toLowerCase();
		const results: { path: string; snippet: string }[] = [];
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			if (folder && !file.path.startsWith(folder)) continue;

			const content = await this.app.vault.cachedRead(file);
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

		if (results.length === 0) return `No results for "${query}"`;

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

	private async listDailyNotes(limit: number): Promise<string> {
		const folder = this.app.vault.getAbstractFileByPath(this.dailyFolder);
		if (!(folder instanceof TFolder)) {
			return `Folder not found: ${this.dailyFolder}`;
		}

		const files = folder.children
			.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
			.sort((a, b) => b.basename.localeCompare(a.basename))
			.slice(0, limit);

		if (files.length === 0) return "No daily notes found.";

		return files.map((f) => f.path).join("\n");
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
}
