import * as fs from "node:fs/promises";
import * as path from "node:path";

const MAX_SEARCH_RESULTS = 10;

export class VaultOps {
	constructor(
		private vaultRoot: string,
		private knowledgeFolders: string[] = []
	) {}

	private resolve(notePath: string): string {
		return path.join(this.vaultRoot, notePath);
	}

	private relative(absPath: string): string {
		return path.relative(this.vaultRoot, absPath);
	}

	async readNote(notePath: string): Promise<string> {
		try {
			return await fs.readFile(this.resolve(notePath), "utf-8");
		} catch {
			return `File not found: ${notePath}`;
		}
	}

	async searchVault(
		query: string,
		folder?: string,
		tag?: string
	): Promise<string> {
		const lowerQuery = query.toLowerCase();
		const lowerTag = tag?.toLowerCase().replace(/^#/, "");
		const results: { path: string; snippet: string }[] = [];

		const files = await this.listMarkdownFiles();

		for (const filePath of files) {
			if (folder && !filePath.startsWith(folder)) continue;

			const content = await fs.readFile(
				this.resolve(filePath),
				"utf-8"
			);

			if (lowerTag) {
				const tags = getTagsFromContent(content);
				if (!tags.includes(lowerTag)) continue;
			}

			const lowerContent = content.toLowerCase();
			const idx = lowerContent.indexOf(lowerQuery);

			if (idx !== -1) {
				const start = Math.max(0, idx - 50);
				const end = Math.min(
					content.length,
					idx + query.length + 100
				);
				const snippet = content.slice(start, end).replace(/\n/g, " ");
				results.push({ path: filePath, snippet: `...${snippet}...` });
			}

			if (results.length >= MAX_SEARCH_RESULTS) break;
		}

		if (results.length === 0)
			return `No results for "${query}"${tag ? ` with tag #${lowerTag}` : ""}`;

		return results.map((r) => `**${r.path}**\n${r.snippet}`).join("\n\n");
	}

	async appendToNote(notePath: string, content: string): Promise<string> {
		const abs = this.resolve(notePath);
		try {
			await fs.access(abs);
		} catch {
			return `File not found: ${notePath}`;
		}
		const existing = await fs.readFile(abs, "utf-8");
		await fs.writeFile(abs, existing + "\n\n" + content, "utf-8");
		return `Content appended to ${notePath}`;
	}

	async listNotes(folder?: string, limit: number = 20): Promise<string> {
		const foldersToList = folder ? [folder] : [...this.knowledgeFolders];
		const allFiles = await this.listMarkdownFiles();

		const filtered = allFiles.filter((f) =>
			foldersToList.some(
				(dir) => f.startsWith(dir + "/") || f.startsWith(dir)
			)
		);

		if (filtered.length === 0) {
			return folder
				? `Folder not found or empty: ${folder}`
				: "No notes found in configured folders.";
		}

		const withMtime = await Promise.all(
			filtered.map(async (f) => {
				const stat = await fs.stat(this.resolve(f));
				return { path: f, mtime: stat.mtimeMs };
			})
		);

		return withMtime
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, limit)
			.map((f) => f.path)
			.join("\n");
	}

	async createNote(
		notePath: string,
		content: string,
		frontmatter?: Record<string, unknown>
	): Promise<string> {
		const normalized = normalizePath(notePath);
		const abs = this.resolve(normalized);

		try {
			await fs.access(abs);
			return `Error: file already exists: ${normalized}`;
		} catch {
			// file doesn't exist, proceed
		}

		let body = content;
		if (frontmatter && Object.keys(frontmatter).length > 0) {
			body = serializeFrontmatter(frontmatter) + content;
		}

		const dir = path.dirname(abs);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(abs, body, "utf-8");
		return `Created: ${normalized}`;
	}

	async editNote(
		notePath: string,
		mode: string,
		target: unknown,
		replacement: string
	): Promise<string> {
		const abs = this.resolve(notePath);
		let content: string;
		try {
			content = await fs.readFile(abs, "utf-8");
		} catch {
			return `File not found: ${notePath}`;
		}

		switch (mode) {
			case "search_replace": {
				const search = typeof target === "string" ? target : "";
				if (!search)
					return "Error: target string is required for search_replace mode";
				const idx = content.indexOf(search);
				if (idx === -1) return `Error: target text not found in ${notePath}`;
				const newContent =
					content.substring(0, idx) +
					replacement +
					content.substring(idx + search.length);
				await fs.writeFile(abs, newContent, "utf-8");
				return `Replaced text in ${notePath}`;
			}
			case "heading": {
				const heading = typeof target === "string" ? target : "";
				if (!heading)
					return "Error: target heading is required for heading mode";
				const { start, end } = findHeadingRange(content, heading);
				if (start === -1)
					return `Error: heading "${heading}" not found in ${notePath}`;
				const newContent =
					content.substring(0, start) +
					replacement +
					content.substring(end);
				await fs.writeFile(abs, newContent, "utf-8");
				return `Replaced heading section "${heading}" in ${notePath}`;
			}
			case "line_range": {
				if (typeof target !== "object" || target === null) {
					return "Error: target must be {start, end} for line_range mode";
				}
				const t = target as Record<string, unknown>;
				const startLine =
					typeof t.start === "number" ? t.start : -1;
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
				const newContent = [...before, replacement, ...after].join(
					"\n"
				);
				await fs.writeFile(abs, newContent, "utf-8");
				return `Replaced lines ${startLine}-${endLine} in ${notePath}`;
			}
			default:
				return `Error: unknown edit mode "${mode}". Use heading, line_range, or search_replace`;
		}
	}

	async renameNote(
		notePath: string,
		newPath: string
	): Promise<string> {
		const abs = this.resolve(notePath);
		const normalized = normalizePath(newPath);
		const absNew = this.resolve(normalized);

		try {
			await fs.access(abs);
		} catch {
			return `File not found: ${notePath}`;
		}
		try {
			await fs.access(absNew);
			return `Error: target path already exists: ${normalized}`;
		} catch {
			// target doesn't exist, proceed
		}

		await fs.mkdir(path.dirname(absNew), { recursive: true });
		await fs.rename(abs, absNew);
		return `Renamed: ${notePath} → ${normalized}`;
	}

	async deleteNote(
		notePath: string,
		confirmed: boolean
	): Promise<string> {
		const abs = this.resolve(notePath);
		let content: string;
		try {
			content = await fs.readFile(abs, "utf-8");
		} catch {
			return `File not found: ${notePath}`;
		}

		if (!confirmed) {
			const preview =
				content.length > 300
					? content.substring(0, 300) + "..."
					: content;
			return `⚠️ 确认删除 ${notePath}?\n\n文件大小: ${content.length} 字符\n\n预览:\n${preview}\n\n要执行删除，请带 confirmed: true 再次调用此工具。`;
		}

		const trashDir = this.resolve(".trash");
		await fs.mkdir(trashDir, { recursive: true });
		const trashPath = path.join(trashDir, path.basename(notePath));
		await fs.rename(abs, trashPath);
		return `Deleted (moved to .trash): ${notePath}`;
	}

	async getLinks(notePath: string): Promise<string> {
		const abs = this.resolve(notePath);
		let content: string;
		try {
			content = await fs.readFile(abs, "utf-8");
		} catch {
			return `File not found: ${notePath}`;
		}

		const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
		const outlinks: string[] = [];
		let match;
		while ((match = wikiLinkRegex.exec(content)) !== null) {
			const link = match[1].trim();
			if (!outlinks.includes(link)) outlinks.push(link);
		}

		const allFiles = await this.listMarkdownFiles();
		const basename = path.basename(notePath, ".md");
		const backlinks: string[] = [];

		for (const file of allFiles) {
			if (file === notePath) continue;
			const fileContent = await fs.readFile(this.resolve(file), "utf-8");
			if (fileContent.includes(`[[${basename}]]`) || fileContent.includes(`[[${basename}|`)) {
				backlinks.push(file);
			}
		}

		const parts: string[] = [`## Links for ${notePath}`];

		parts.push(`\n### Outlinks (${outlinks.length})`);
		if (outlinks.length > 0) {
			for (const link of outlinks) {
				parts.push(`- [[${link}]]`);
			}
		} else {
			parts.push("_No outgoing links_");
		}

		parts.push(`\n### Backlinks (${backlinks.length})`);
		if (backlinks.length > 0) {
			for (const link of backlinks) {
				const name = path.basename(link, ".md");
				parts.push(`- [[${name}]] (${link})`);
			}
		} else {
			parts.push("_No incoming links_");
		}

		return parts.join("\n");
	}

	async updateFrontmatter(
		notePath: string,
		set?: Record<string, unknown>,
		del?: string[]
	): Promise<string> {
		const abs = this.resolve(notePath);
		let content: string;
		try {
			content = await fs.readFile(abs, "utf-8");
		} catch {
			return `File not found: ${notePath}`;
		}

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

		const newContent =
			Object.keys(updated).length > 0
				? serializeFrontmatter(updated) + body
				: body;
		await fs.writeFile(abs, newContent, "utf-8");

		const changes: string[] = [];
		if (set) changes.push(`set: ${Object.keys(set).join(", ")}`);
		if (del) changes.push(`deleted: ${del.join(", ")}`);
		return `Updated frontmatter of ${notePath} (${changes.join("; ")})`;
	}

	private async listMarkdownFiles(): Promise<string[]> {
		const results: string[] = [];
		const walk = async (dir: string): Promise<void> => {
			let entries;
			try {
				entries = await fs.readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.name.startsWith(".")) continue;
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(full);
				} else if (entry.name.endsWith(".md")) {
					results.push(this.relative(full));
				}
			}
		};
		await walk(this.vaultRoot);
		return results;
	}
}

export function containsTraversal(p: string): boolean {
	const segments = p.split(/[\\/]/);
	return segments.some((s) => s === ".." || s === ".");
}

function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

const FM_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(
	content: string
): { frontmatter: Record<string, unknown>; body: string } {
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
			fm[key] = rawVal
				.slice(1, -1)
				.split(",")
				.map((s) => {
					const trimmed = s.trim();
					if (
						(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
						(trimmed.startsWith("'") && trimmed.endsWith("'"))
					) {
						return trimmed.slice(1, -1);
					}
					return trimmed;
				})
				.filter(Boolean);
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
			lines.push(
				`${key}: [${value.map((v) => JSON.stringify(String(v))).join(", ")}]`
			);
		} else if (typeof value === "string") {
			lines.push(`${key}: ${value}`);
		} else {
			lines.push(`${key}: ${JSON.stringify(value)}`);
		}
	}
	lines.push("---", "");
	return lines.join("\n");
}

export function findHeadingRange(
	content: string,
	heading: string
): { start: number; end: number } {
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
			startIdx =
				lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
			continue;
		}

		if (startIdx !== -1 && level <= headingLevel) {
			const endIdx =
				lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
			return { start: startIdx, end: endIdx };
		}
	}

	if (startIdx !== -1) {
		return { start: startIdx, end: content.length };
	}
	return { start: -1, end: -1 };
}

function getTagsFromContent(content: string): string[] {
	const { frontmatter } = parseFrontmatter(content);
	const raw = frontmatter.tags;
	if (!raw) return [];
	if (Array.isArray(raw)) {
		return raw.map((t) =>
			String(t).toLowerCase().replace(/^#/, "")
		);
	}
	if (typeof raw === "string") {
		return raw
			.split(",")
			.map((t) => t.trim().toLowerCase().replace(/^#/, ""))
			.filter(Boolean);
	}
	return [];
}
