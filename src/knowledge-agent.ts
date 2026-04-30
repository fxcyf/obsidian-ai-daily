import { App, TFile } from "obsidian";
import { ClaudeClient } from "./claude";
import { VaultTools } from "./vault-tools";
import { parseFrontmatter } from "./vault-tools";

export const MAX_NOTES_PER_RUN = 5;
const ORGANIZED_MARKER = "organized";

export async function findUnorganizedNotes(app: App, folder: string): Promise<TFile[]> {
	return app.vault.getMarkdownFiles().filter((f) => {
		if (!f.path.startsWith(folder + "/") && f.path !== folder) return false;
		const cache = app.metadataCache.getFileCache(f);
		if (cache?.frontmatter?.[ORGANIZED_MARKER] === true) return false;
		return true;
	});
}

export interface HealthCheckResult {
	missingFrontmatter: { path: string; missing: string[] }[];
	orphanNotes: string[];
	emptyNotes: string[];
	duplicateTitles: { title: string; paths: string[] }[];
	brokenLinks: { source: string; target: string }[];
	totalNotes: number;
}

export async function wikiHealthCheck(
	app: App,
	folders: string[]
): Promise<HealthCheckResult> {
	const files = app.vault.getMarkdownFiles().filter((f) =>
		folders.some((dir) => f.path.startsWith(dir + "/") || f.path === dir)
	);

	const result: HealthCheckResult = {
		missingFrontmatter: [],
		orphanNotes: [],
		emptyNotes: [],
		duplicateTitles: [],
		brokenLinks: [],
		totalNotes: files.length,
	};

	const titleMap = new Map<string, string[]>();

	for (const file of files) {
		const content = await app.vault.cachedRead(file);
		const { frontmatter, body } = parseFrontmatter(content);

		const missing: string[] = [];
		if (!frontmatter.tags || (Array.isArray(frontmatter.tags) && frontmatter.tags.length === 0)) {
			missing.push("tags");
		}
		if (!frontmatter.summary) {
			missing.push("summary");
		}
		if (missing.length > 0) {
			result.missingFrontmatter.push({ path: file.path, missing });
		}

		const trimmed = body.trim();
		if (trimmed.length === 0) {
			result.emptyNotes.push(file.path);
		}

		const title = file.basename.toLowerCase();
		const existing = titleMap.get(title);
		if (existing) {
			existing.push(file.path);
		} else {
			titleMap.set(title, [file.path]);
		}

		const backlinks = app.metadataCache.resolvedLinks;
		let hasIncoming = false;
		for (const [sourcePath, links] of Object.entries(backlinks)) {
			if (sourcePath === file.path) continue;
			if (links[file.path]) {
				hasIncoming = true;
				break;
			}
		}
		if (!hasIncoming) {
			result.orphanNotes.push(file.path);
		}
	}

	for (const [title, paths] of titleMap) {
		if (paths.length > 1) {
			result.duplicateTitles.push({ title, paths });
		}
	}

	const allResolvedLinks = app.metadataCache.resolvedLinks;
	const unresolvedLinks = (app.metadataCache as unknown as { unresolvedLinks?: Record<string, Record<string, number>> }).unresolvedLinks;
	if (unresolvedLinks) {
		for (const [source, targets] of Object.entries(unresolvedLinks)) {
			if (!folders.some((dir) => source.startsWith(dir + "/") || source === dir)) continue;
			for (const target of Object.keys(targets)) {
				result.brokenLinks.push({ source, target });
			}
		}
	}

	return result;
}

export function formatHealthCheckReport(result: HealthCheckResult): string {
	const sections: string[] = [];
	const score = computeHealthScore(result);

	sections.push(`## Wiki 健康检查报告\n`);
	sections.push(`**总计**: ${result.totalNotes} 篇笔记 | **健康分数**: ${score}/100\n`);

	if (result.emptyNotes.length > 0) {
		sections.push(`### ⚠️ 空笔记 (${result.emptyNotes.length})`);
		sections.push(result.emptyNotes.map((p) => `- [[${pathToName(p)}]]`).join("\n"));
	}

	if (result.missingFrontmatter.length > 0) {
		sections.push(`### 📋 缺少 Frontmatter (${result.missingFrontmatter.length})`);
		const items = result.missingFrontmatter.slice(0, 20).map(
			(e) => `- [[${pathToName(e.path)}]] — 缺少: ${e.missing.join(", ")}`
		);
		if (result.missingFrontmatter.length > 20) {
			items.push(`- ... 还有 ${result.missingFrontmatter.length - 20} 篇`);
		}
		sections.push(items.join("\n"));
	}

	if (result.orphanNotes.length > 0) {
		sections.push(`### 🔗 孤岛笔记 — 无入链 (${result.orphanNotes.length})`);
		const items = result.orphanNotes.slice(0, 20).map(
			(p) => `- [[${pathToName(p)}]]`
		);
		if (result.orphanNotes.length > 20) {
			items.push(`- ... 还有 ${result.orphanNotes.length - 20} 篇`);
		}
		sections.push(items.join("\n"));
	}

	if (result.brokenLinks.length > 0) {
		sections.push(`### ❌ 断链 (${result.brokenLinks.length})`);
		const items = result.brokenLinks.slice(0, 15).map(
			(l) => `- [[${pathToName(l.source)}]] → \`${l.target}\``
		);
		if (result.brokenLinks.length > 15) {
			items.push(`- ... 还有 ${result.brokenLinks.length - 15} 条`);
		}
		sections.push(items.join("\n"));
	}

	if (result.duplicateTitles.length > 0) {
		sections.push(`### 📑 疑似重复条目 (${result.duplicateTitles.length} 组)`);
		sections.push(result.duplicateTitles.map(
			(d) => `- **${d.title}**: ${d.paths.map((p) => `[[${pathToName(p)}]]`).join(", ")}`
		).join("\n"));
	}

	const allClean = result.emptyNotes.length === 0
		&& result.missingFrontmatter.length === 0
		&& result.orphanNotes.length === 0
		&& result.brokenLinks.length === 0
		&& result.duplicateTitles.length === 0;

	if (allClean) {
		sections.push("✅ 知识库状态良好，没有发现问题！");
	}

	return sections.join("\n\n");
}

export function computeHealthScore(r: HealthCheckResult): number {
	if (r.totalNotes === 0) return 100;
	let score = 100;
	score -= Math.min(30, (r.missingFrontmatter.length / r.totalNotes) * 30);
	score -= Math.min(25, (r.orphanNotes.length / r.totalNotes) * 25);
	score -= Math.min(20, r.emptyNotes.length * 5);
	score -= Math.min(15, r.brokenLinks.length * 3);
	score -= Math.min(10, r.duplicateTitles.length * 5);
	return Math.max(0, Math.round(score));
}

function pathToName(path: string): string {
	const base = path.split("/").pop() || path;
	return base.replace(/\.md$/, "");
}

export async function prepareDistillation(
	app: App,
	messages: { role: string; content: string }[],
	opts: {
		knowledgeFolders: string[];
		targetFolder: string;
	}
): Promise<{ systemPrompt: string; userMessage: string }> {
	const allFolders = opts.knowledgeFolders.join("、");
	const existingStructure = await getWikiStructureSummary(app, opts.targetFolder);

	const systemPrompt = `你是一个知识蒸馏 Agent。你的任务是从对话历史中提取有价值的事实性知识，保存为 Wiki 条目。

你可以使用工具来搜索、读取、创建和编辑笔记。

蒸馏流程：
1. 分析对话历史，识别有价值的事实性知识（排除闲聊、问候等）
2. 对每个知识点，用 search_vault 搜索 ${opts.targetFolder}/ 中是否已有相关条目
3. 已有条目：用 edit_note 补充新知识，保持原有结构和格式
4. 没有条目：用 create_note 在 ${opts.targetFolder}/ 中创建新条目
5. 每个条目必须有 frontmatter（tags、summary）和 wiki-link 关联
6. 新建条目后，检查是否有相关的已有条目需要添加交叉引用

知识库文件夹: ${allFolders}
目标文件夹: ${opts.targetFolder}

## 组织结构维护

${existingStructure}

维护规则：
- 新条目的 tags 应尽量复用已有 tag，避免创建同义 tag（如已有 "机器学习" 就不要再用 "ML"）
- 如果已有子文件夹按主题分类，新条目应放入合适的子文件夹
- 创建或编辑条目时，主动添加 [[wiki-link]] 指向相关条目，维护知识网络
- 编辑已有条目时，保持其原有的标题层级和内容结构

重要约束：
- 只提取事实性、可复用的知识，跳过纯闲聊
- Wiki 条目标题简洁、概念化（名词或名词短语）
- 内容用中文，结构清晰
- 优先合并到已有条目，避免创建内容重叠的新条目`;

	const conversationText = messages
		.filter((m) => m.content.length > 0)
		.map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
		.join("\n\n");

	const userMessage = `请从以下对话中提取知识并保存为 Wiki 条目：

${conversationText.slice(0, 12000)}

完成后，请简要说明你提取了哪些知识、创建或更新了哪些条目。`;

	return { systemPrompt, userMessage };
}

export async function distillConversation(
	app: App,
	messages: { role: string; content: string }[],
	opts: {
		apiKey: string;
		model: string;
		knowledgeFolders: string[];
		targetFolder: string;
	}
): Promise<string> {
	const vaultTools = new VaultTools(app, opts.knowledgeFolders);
	const { systemPrompt, userMessage } = await prepareDistillation(app, messages, {
		knowledgeFolders: opts.knowledgeFolders,
		targetFolder: opts.targetFolder,
	});

	const client = new ClaudeClient(opts.apiKey, opts.model, systemPrompt, {
		streamMode: "off",
		enableWebSearch: false,
	});

	return client.chat(
		userMessage,
		(name, input) => vaultTools.execute(name, input)
	);
}

async function getWikiStructureSummary(app: App, targetFolder: string): Promise<string> {
	const files = app.vault.getMarkdownFiles().filter(
		(f) => f.path.startsWith(targetFolder + "/")
	);

	if (files.length === 0) return "目标文件夹为空，可自由创建条目。";

	const subfolders = new Set<string>();
	const allTags = new Map<string, number>();

	for (const file of files) {
		const rel = file.path.slice(targetFolder.length + 1);
		const slashIdx = rel.indexOf("/");
		if (slashIdx !== -1) {
			subfolders.add(rel.slice(0, slashIdx));
		}

		const cache = app.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.tags) {
			const raw = cache.frontmatter.tags;
			const tags: string[] = Array.isArray(raw)
				? raw.map(String)
				: typeof raw === "string"
					? raw.split(",").map((t: string) => t.trim()).filter(Boolean)
					: [];
			for (const tag of tags) {
				allTags.set(tag, (allTags.get(tag) || 0) + 1);
			}
		}
	}

	const parts: string[] = [`当前 ${targetFolder}/ 中有 ${files.length} 篇条目。`];

	if (subfolders.size > 0) {
		parts.push(`子文件夹: ${[...subfolders].sort().join("、")}`);
	}

	if (allTags.size > 0) {
		const sorted = [...allTags.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 30)
			.map(([tag, count]) => `${tag}(${count})`);
		parts.push(`常用 tags: ${sorted.join("、")}`);
	}

	return parts.join("\n");
}
