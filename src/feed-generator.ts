/**
 * Feed generator — orchestrates RSS fetching, vault search, and Claude
 * to produce a daily feed note in the vault.
 */

import { App, TFile } from "obsidian";
import { fetchAllFeeds, type Article, type FeedSource } from "./feeds";
import type { AIDailyChatSettings } from "./settings";
import { callClaudeSimple } from "./claude";

// ── Claude prompt for feed generation ──────────────────────────────

const FEED_SYSTEM_PROMPT = `你是一个 AI/ML 领域的资深技术编辑，读者是有经验的开发者和研究者。
你的任务是基于多来源抓取的文章（RSS、Hacker News、Reddit、GitHub Trending）和用户笔记库中的相关内容，生成一份有深度的中文技术 Feed。

## 内容筛选原则
- **优先呈现正在被社区热议的内容**：关注社交热度（points、upvotes、stars today）和评论数，这些是 trending 的关键信号
- 多个来源同时提到同一话题 = 重要趋势，必须重点报道
- 优先选择：热门讨论、论文解读、技术方案、开源工具、架构设计、实验结果
- 降低优先级：企业合作新闻、产品发布公告、融资消息
- 如果一条内容只是"XX公司做了XX"而没有技术细节，可以跳过或合并到简讯中

## 输出格式
按主题分组输出 Markdown。每个主题下分三个来源：

### 🔥 主题名（如果是多源交叉热点，标注「Trending」）

#### 来自笔记库
- 如果有相关笔记，用 [[笔记路径]] 格式引用，简要说明关联
- 如果没有相关笔记，写"暂无相关笔记"

#### 最新动态
- 用 3-5 句话深入解读文章技术要点
- 标注来源链接
- 如有社区讨论亮点（高赞评论观点等），简要提及

#### AI 分析
- 综合以上信息，分析趋势和要点

## 其他要求
- 值得深入阅读的标注「⭐ 推荐精读」
- 社区热度特别高（500+ points/upvotes）的标注「🔥 热门」
- 纯行业动态放到末尾「📋 行业简讯」区域，每条一句话
- 输出纯 Markdown 格式
- 宁可少选几篇深入解读，也不要堆砌大量浅层摘要`;

// ── Types ──────────────────────────────────────────────────────────

export interface FeedProgress {
	stage: string;
	message: string;
}

// ── Vault context search ───────────────────────────────────────────

async function searchVaultForTopics(
	app: App,
	topics: string[],
	knowledgeFolders: string[]
): Promise<string> {
	if (topics.length === 0) return "";

	const results: { path: string; snippet: string }[] = [];

	const files = app.vault.getMarkdownFiles().filter((f) =>
		knowledgeFolders.some((folder) => f.path.startsWith(folder))
	);

	for (const topic of topics) {
		const lowerTopic = topic.toLowerCase();
		for (const file of files) {
			if (results.length >= 10) break;
			if (results.some((r) => r.path === file.path)) continue;

			const content = await app.vault.cachedRead(file);
			const lowerContent = content.toLowerCase();
			const idx = lowerContent.indexOf(lowerTopic);

			if (idx !== -1) {
				const start = Math.max(0, idx - 80);
				const end = Math.min(content.length, idx + topic.length + 150);
				const snippet = content.slice(start, end).replace(/\n/g, " ");
				results.push({ path: file.path, snippet: `...${snippet}...` });
			}
		}
	}

	if (results.length === 0) return "未找到相关笔记。";

	return results
		.map((r) => `**[[${r.path}]]**\n${r.snippet}`)
		.join("\n\n");
}

// ── Claude API call (delegates to shared helper) ─────────────────────

async function callClaude(
	apiKey: string,
	model: string,
	userMessage: string
): Promise<string> {
	const result = await callClaudeSimple({
		apiKey,
		model,
		systemPrompt: FEED_SYSTEM_PROMPT,
		userMessage,
	});
	return result || "Feed 生成失败。";
}

// ── Existing feed check ───────────────────────────────────────────

export interface ExistingFeedInfo {
	file: TFile;
	content: string;
}

export function getTodayFeedPath(feedFolder: string): string {
	const today = new Date().toISOString().slice(0, 10);
	return `${feedFolder}/Feed-${today}.md`;
}

export async function checkExistingFeed(
	app: App,
	feedFolder: string
): Promise<ExistingFeedInfo | null> {
	const filePath = getTodayFeedPath(feedFolder);
	const existing = app.vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile) {
		const content = await app.vault.read(existing);
		return { file: existing, content };
	}
	return null;
}

// ── Main generator ─────────────────────────────────────────────────

export async function generateFeed(
	app: App,
	settings: AIDailyChatSettings,
	onProgress?: (progress: FeedProgress) => void,
	existingContent?: string
): Promise<TFile> {
	const { apiKey, model, feedModel, feedFolder, feedTopics, feedSources, feedMaxArticles, knowledgeFolders } = settings;
	const effectiveModel = feedModel || model;

	if (!apiKey) throw new Error("请先在设置中配置 API Key");

	// Step 1: Fetch RSS
	onProgress?.({ stage: "rss", message: "正在抓取 RSS 源..." });

	const articles = await fetchAllFeeds({
		feeds: feedSources,
		userTopics: feedTopics,
		maxArticles: feedMaxArticles,
		onProgress: (msg) => onProgress?.({ stage: "rss", message: msg }),
	});

	if (articles.length === 0) {
		onProgress?.({ stage: "rss", message: "未抓取到任何文章" });
	}

	// Step 2: Search vault for related notes
	onProgress?.({ stage: "vault", message: "正在搜索笔记库..." });
	const vaultContext = await searchVaultForTopics(app, feedTopics, knowledgeFolders);

	// Step 3: Call Claude to generate feed
	onProgress?.({ stage: "ai", message: "正在让 AI 生成 Feed..." });

	const articlesText = articles
		.map(
			(a) => {
				let text =
					`标题: ${a.title}\n来源: ${a.source}\n类型: ${a.category}\n` +
					`相关度: ${a.relevanceScore}\n链接: ${a.url}`;
				if (a.socialScore > 0 || a.commentCount > 0) {
					text += `\n热度: ${a.socialScore} points, ${a.commentCount} comments`;
				}
				text += `\n摘要: ${a.summary || "无"}`;
				return text;
			}
		)
		.join("\n\n");

	const topicsStr = feedTopics.length > 0
		? `用户关注的主题: ${feedTopics.join(", ")}\n\n`
		: "";

	let deduplicationNote = "";
	if (existingContent) {
		deduplicationNote =
			`## ⚠️ 重要：以下是今天已生成的 Feed 内容，请勿重复报道相同的文章或主题\n\n` +
			`${existingContent}\n\n` +
			`请只关注上面尚未覆盖的新内容。如果所有文章都已在上次 Feed 中报道过，请明确告知"本次无新增内容"。\n\n`;
	}

	const userMessage =
		`${topicsStr}` +
		`${deduplicationNote}` +
		`## 用户笔记库中的相关内容\n\n${vaultContext}\n\n` +
		`## RSS 抓取到的文章（共 ${articles.length} 篇）\n\n${articlesText}`;

	let aiContent: string;
	if (articles.length === 0 && vaultContext === "未找到相关笔记。") {
		aiContent = "今天暂无新的 Feed 内容。请检查 RSS 源配置或网络连接。";
	} else {
		aiContent = await callClaude(apiKey, effectiveModel, userMessage);
	}

	// Step 4: Write to vault
	onProgress?.({ stage: "write", message: "正在写入笔记..." });

	const today = new Date().toISOString().slice(0, 10);
	const topicsYaml = feedTopics.length > 0
		? `topics: [${feedTopics.join(", ")}]\n`
		: "";

	const filePath = `${feedFolder}/Feed-${today}.md`;
	const existingFile = app.vault.getAbstractFileByPath(filePath);

	// Ensure feed folder exists
	const folderExists = app.vault.getAbstractFileByPath(feedFolder);
	if (!folderExists) {
		await app.vault.createFolder(feedFolder);
	}

	let file: TFile;
	if (existingFile instanceof TFile && existingContent) {
		const now = new Date();
		const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
		const appendContent = `\n\n---\n\n# AI Feed 更新 - ${today} ${timeStr}\n\n${aiContent}\n`;
		const updatedContent = existingContent + appendContent;
		await app.vault.modify(existingFile, updatedContent);
		file = existingFile;
	} else if (existingFile instanceof TFile) {
		const noteContent =
			`---\ntype: feed\n${topicsYaml}date: ${today}\n---\n\n` +
			`# AI Feed - ${today}\n\n${aiContent}\n`;
		await app.vault.modify(existingFile, noteContent);
		file = existingFile;
	} else {
		const noteContent =
			`---\ntype: feed\n${topicsYaml}date: ${today}\n---\n\n` +
			`# AI Feed - ${today}\n\n${aiContent}\n`;
		file = await app.vault.create(filePath, noteContent);
	}

	onProgress?.({ stage: "done", message: `Feed 已生成: ${filePath}` });

	return file;
}
