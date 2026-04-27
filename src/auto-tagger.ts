import { App, TFile, TFolder } from "obsidian";
import { callClaudeSimple } from "./claude";
import { parseFrontmatter, serializeFrontmatter } from "./vault-tools";

export interface AutoTaggerOptions {
	apiKey: string;
	model: string;
	folders: string[];
	customPrompt?: string;
	onTagged?: (path: string) => void;
	onError?: (path: string, error: string) => void;
}

const DEBOUNCE_MS = 5000;
const AUTO_TAG_MARKER = "auto-tagged";

export class AutoTagger {
	private app: App;
	private options: AutoTaggerOptions;
	private pending = new Map<string, ReturnType<typeof setTimeout>>();
	private processing = new Set<string>();

	constructor(app: App, options: AutoTaggerOptions) {
		this.app = app;
		this.options = options;
	}

	updateOptions(options: Partial<AutoTaggerOptions>): void {
		Object.assign(this.options, options);
	}

	handleFileEvent(file: TFile): void {
		if (!file.path.endsWith(".md")) return;
		if (!this.isInWatchedFolder(file.path)) return;
		if (this.processing.has(file.path)) return;

		const existing = this.pending.get(file.path);
		if (existing) clearTimeout(existing);

		this.pending.set(
			file.path,
			setTimeout(() => {
				this.pending.delete(file.path);
				this.processFile(file);
			}, DEBOUNCE_MS)
		);
	}

	destroy(): void {
		for (const timer of this.pending.values()) {
			clearTimeout(timer);
		}
		this.pending.clear();
	}

	private isInWatchedFolder(path: string): boolean {
		return this.options.folders.some(
			(f) => path.startsWith(f + "/") || path === f
		);
	}

	private async processFile(file: TFile): Promise<void> {
		const abstract = this.app.vault.getAbstractFileByPath(file.path);
		if (!(abstract instanceof TFile)) return;

		this.processing.add(file.path);
		try {
			const content = await this.app.vault.cachedRead(abstract);
			const { frontmatter } = parseFrontmatter(content);

			if (frontmatter[AUTO_TAG_MARKER] === true) return;

			if (content.replace(/^---[\s\S]*?---\n?/, "").trim().length < 50) return;

			const existingTags = this.collectVaultTags();
			const result = await this.callTaggingAPI(content, existingTags);
			if (!result) return;

			const freshContent = await this.app.vault.cachedRead(abstract);
			const { frontmatter: freshFm, body } = parseFrontmatter(freshContent);

			if (freshFm[AUTO_TAG_MARKER] === true) return;

			const updated = { ...freshFm };
			if (result.tags && result.tags.length > 0) {
				updated.tags = result.tags;
			}
			if (result.summary) {
				updated.summary = result.summary;
			}
			updated[AUTO_TAG_MARKER] = true;

			const newContent = serializeFrontmatter(updated) + body;
			await this.app.vault.modify(abstract, newContent);

			this.options.onTagged?.(file.path);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.options.onError?.(file.path, msg);
		} finally {
			this.processing.delete(file.path);
		}
	}

	private collectVaultTags(): string[] {
		const tagCounts = new Map<string, number>();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache?.frontmatter?.tags) continue;
			const raw = cache.frontmatter.tags;
			const tags: string[] = Array.isArray(raw)
				? raw.map(String)
				: typeof raw === "string"
					? raw.split(",").map((t: string) => t.trim()).filter(Boolean)
					: [];
			for (const tag of tags) {
				const normalized = tag.toLowerCase().replace(/^#/, "");
				tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
			}
		}
		return [...tagCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 50)
			.map(([tag]) => tag);
	}

	private async callTaggingAPI(
		noteContent: string,
		existingTags: string[]
	): Promise<{ tags: string[]; summary: string } | null> {
		const truncated = noteContent.slice(0, 8000);
		const tagHint =
			existingTags.length > 0
				? `\n\n已有标签体系（优先复用）：${existingTags.join(", ")}`
				: "";

		const systemPrompt =
			this.options.customPrompt ||
			"你是一个知识库标注助手。根据笔记内容生成合适的标签和摘要。";

		const userMessage = `请为以下笔记生成标签和摘要。

要求：
1. 标签 3-6 个，小写英文或中文短语，优先复用已有标签
2. 摘要 1-2 句话，中文
3. 严格按 JSON 格式返回：{"tags": ["tag1", "tag2"], "summary": "摘要"}
4. 只返回 JSON，不要其他内容${tagHint}

笔记内容：
${truncated}`;

		const response = await callClaudeSimple({
			apiKey: this.options.apiKey,
			model: this.options.model,
			systemPrompt,
			userMessage,
			maxTokens: 512,
		});

		return parseTaggingResponse(response);
	}
}

export function parseTaggingResponse(
	response: string
): { tags: string[]; summary: string } | null {
	try {
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return null;
		const parsed = JSON.parse(jsonMatch[0]);
		const tags = Array.isArray(parsed.tags)
			? parsed.tags.filter((t: unknown) => typeof t === "string" && t.length > 0)
			: [];
		const summary = typeof parsed.summary === "string" ? parsed.summary : "";
		if (tags.length === 0 && !summary) return null;
		return { tags, summary };
	} catch {
		return null;
	}
}
