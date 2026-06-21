/**
 * Feed generator — orchestrates RSS fetching, vault search, and Claude
 * to produce a daily feed note in the vault.
 */

import { App, TFile } from "obsidian";
import { fetchAllFeeds, type Article, type FeedSource } from "./feeds";
import type { AIDailyChatSettings } from "./settings";
import { callClaudeSimple } from "./claude";
import { fetchPodcastRss, extractTranscript, type PodcastEpisode } from "./podcast-tools";

// ── Claude prompt for feed generation ──────────────────────────────

const FEED_SYSTEM_PROMPT = `你是一个 AI/ML 领域的资深技术编辑，读者是有经验的开发者和研究者。
你的任务是基于多来源抓取的文章（RSS、Hacker News、Reddit、GitHub Trending、技术博客、播客）和用户笔记库中的相关内容，生成一份有深度的中文技术 Feed。

## 内容筛选原则
- **工程实践优先**：优先呈现工程经验分享、生产环境案例、系统设计、架构演进、踩坑复盘等实战内容
- **优先呈现正在被社区热议的内容**：关注社交热度（points、upvotes、stars today）和评论数，这些是 trending 的关键信号
- 多个来源同时提到同一话题 = 重要趋势，必须重点报道
- 优先选择：工程实践、技术方案、开源工具、架构设计、实战经验、热门讨论
- 论文类内容：只选有实际应用价值或社区高度关注的，纯理论论文降低优先级
- 降低优先级：企业合作新闻、产品发布公告、融资消息、纯学术论文
- 如果一条内容只是"XX公司做了XX"而没有技术细节，可以跳过或合并到简讯中
- **播客内容**：标注 🎙️，突出嘉宾身份、核心讨论要点、时长，播客适合与文章类内容交叉对比

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
	knowledgeFolders: string[],
	excludeFolder?: string
): Promise<string> {
	if (topics.length === 0) return "";

	const results: { path: string; snippet: string }[] = [];

	const files = app.vault.getMarkdownFiles().filter((f) =>
		knowledgeFolders.some((folder) => f.path.startsWith(folder)) &&
		!(excludeFolder && f.path.startsWith(excludeFolder))
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

// ── Cross-day deduplication ───────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s\])>"']+/g;

async function getRecentFeedUrls(
	app: App,
	feedFolder: string,
	days: number = 3
): Promise<Set<string>> {
	const urls = new Set<string>();
	const today = new Date();

	for (let i = 1; i <= days; i++) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const dateStr = d.toISOString().slice(0, 10);
		const filePath = `${feedFolder}/Feed-${dateStr}.md`;
		const file = app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			const content = await app.vault.cachedRead(file);
			for (const match of content.matchAll(URL_PATTERN)) {
				urls.add(match[0]);
			}
		}
	}

	return urls;
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

	// Step 1.5: Cross-day deduplication
	onProgress?.({ stage: "dedup", message: "正在去重（排除近期已报道内容）..." });
	const recentUrls = await getRecentFeedUrls(app, feedFolder);
	const beforeCount = articles.length;
	const dedupedArticles = articles.filter((a) => !recentUrls.has(a.url));
	if (beforeCount > dedupedArticles.length) {
		onProgress?.({
			stage: "dedup",
			message: `已过滤 ${beforeCount - dedupedArticles.length} 篇近期已报道的文章`,
		});
	}

	// Step 2: Search vault for related notes
	onProgress?.({ stage: "vault", message: "正在搜索笔记库..." });
	const vaultContext = await searchVaultForTopics(app, feedTopics, knowledgeFolders, feedFolder);

	// Step 3: Call Claude to generate feed
	onProgress?.({ stage: "ai", message: "正在让 AI 生成 Feed..." });

	const articlesText = dedupedArticles
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
		`## RSS 抓取到的文章（共 ${dedupedArticles.length} 篇）\n\n${articlesText}`;

	let aiContent: string;
	if (dedupedArticles.length === 0 && vaultContext === "未找到相关笔记。") {
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

// ── Podcast Feed ───────────────────────────────────────────────────

const PODCAST_FEED_SYSTEM_PROMPT = `你是一个播客内容分析专家，帮助用户快速了解各播客最新一期的核心内容。
读者是有经验的开发者和终身学习者，关注 AI/技术前沿、商业思维、科学探索。

## 输出格式

按播客逐个整理，每个播客一个区块：

### 🎙️ 播客名称 — 本期标题
- **嘉宾**: （如有）
- **时长**: X 分钟
- **核心观点**:
  1. 第一个要点（2-3 句深入解读）
  2. 第二个要点
  3. ...
- **值得关注的金句/数据**: （如有特别有启发的表述）
- **与其他播客的交叉话题**: （如果多个播客讨论了相似话题，标注关联）
- 🔗 [收听链接](url)

## 最后加一个总结区块

### 📊 本周播客趋势
- 多个播客共同关注的话题
- 值得深入了解的新概念或趋势

## 要求
- 用中文输出
- 如果有 transcript 内容，深入提炼核心观点，不要只是浅层摘要
- 如果只有描述信息，据此整理要点并标注"（基于节目简介）"
- 按信息密度和话题重要性排序，最有价值的放前面
- 纯闲聊/娱乐类内容简要带过即可`;

export function getTodayPodcastFeedPath(feedFolder: string): string {
	const today = new Date().toISOString().slice(0, 10);
	return `${feedFolder}/Podcast-${today}.md`;
}

export async function checkExistingPodcastFeed(
	app: App,
	feedFolder: string
): Promise<ExistingFeedInfo | null> {
	const filePath = getTodayPodcastFeedPath(feedFolder);
	const existing = app.vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile) {
		const content = await app.vault.read(existing);
		return { file: existing, content };
	}
	return null;
}

interface PodcastFeedItem {
	podcastName: string;
	episodeTitle: string;
	published: Date | null;
	duration: number | null;
	link: string;
	description: string;
	transcript: string | null;
}

export async function generatePodcastFeed(
	app: App,
	settings: AIDailyChatSettings,
	onProgress?: (progress: FeedProgress) => void,
	existingContent?: string
): Promise<TFile> {
	const { apiKey, model, feedModel, feedFolder, feedSources } = settings;
	const effectiveModel = feedModel || model;

	if (!apiKey) throw new Error("请先在设置中配置 API Key");

	const podcastSources = feedSources.filter((s) => s.type === "podcast");
	if (podcastSources.length === 0) {
		throw new Error("没有配置播客源，请在 Feed 设置中添加播客订阅");
	}

	// Step 1: Fetch all podcast RSS feeds
	onProgress?.({ stage: "rss", message: `正在抓取 ${podcastSources.length} 个播客源...` });

	const fetchResults = await Promise.allSettled(
		podcastSources.map((source) => fetchPodcastRss(source.url, source.name))
	);

	const items: PodcastFeedItem[] = [];
	const failedSources: string[] = [];

	const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

	for (let i = 0; i < fetchResults.length; i++) {
		const result = fetchResults[i];
		if (result.status === "fulfilled" && result.value.length > 0) {
			const episodes = result.value;
			const recent = episodes.filter((ep) => ep.published && ep.published >= threeDaysAgo);
			const selected = recent.length > 0 ? recent : [episodes[0]];
			for (const ep of selected) {
				items.push({
					podcastName: ep.podcastName || podcastSources[i].name,
					episodeTitle: ep.title,
					published: ep.published,
					duration: ep.duration,
					link: ep.link || ep.audioUrl,
					description: ep.description,
					transcript: null,
				});
			}
		} else {
			failedSources.push(podcastSources[i].name);
		}
	}

	if (failedSources.length > 0) {
		onProgress?.({ stage: "rss", message: `⚠️ ${failedSources.length} 个播客源抓取失败: ${failedSources.join(", ")}` });
	}
	onProgress?.({ stage: "rss", message: `共获取 ${items.length} 个播客最新剧集` });

	if (items.length === 0) {
		throw new Error("未能抓取到任何播客剧集");
	}

	// Step 1.5: Cross-day dedup
	const recentUrls = await getRecentFeedUrls(app, feedFolder);
	const beforeCount = items.length;
	const dedupedItems = items.filter((it) => !recentUrls.has(it.link));
	if (beforeCount > dedupedItems.length) {
		onProgress?.({ stage: "dedup", message: `已过滤 ${beforeCount - dedupedItems.length} 个近期已报道的剧集` });
	}

	// Step 2: Try to extract transcripts for each episode
	onProgress?.({ stage: "transcript", message: "正在提取播客 transcript..." });

	const transcriptResults = await Promise.allSettled(
		dedupedItems.map(async (item) => {
			const episode: PodcastEpisode = {
				title: item.episodeTitle,
				link: item.link,
				published: item.published,
				description: item.description,
				contentEncoded: "",
				duration: item.duration,
				audioUrl: item.link,
				episodeNumber: "",
				podcastName: item.podcastName,
			};
			return extractTranscript(episode);
		})
	);

	for (let i = 0; i < transcriptResults.length; i++) {
		const result = transcriptResults[i];
		if (result.status === "fulfilled" && result.value !== "(No transcript available)") {
			dedupedItems[i].transcript = result.value.slice(0, 8000);
		}
	}

	const withTranscript = dedupedItems.filter((it) => it.transcript).length;
	onProgress?.({ stage: "transcript", message: `${withTranscript}/${dedupedItems.length} 个剧集获取到 transcript` });

	// Step 3: Call Claude to generate podcast feed
	onProgress?.({ stage: "ai", message: "正在让 AI 生成播客 Feed..." });

	const episodesText = dedupedItems
		.map((item) => {
			const durationStr = item.duration ? `${Math.floor(item.duration / 60)} 分钟` : "未知";
			const dateStr = item.published ? item.published.toISOString().slice(0, 10) : "未知";
			let text =
				`播客: ${item.podcastName}\n标题: ${item.episodeTitle}\n` +
				`日期: ${dateStr}\n时长: ${durationStr}\n链接: ${item.link}\n` +
				`描述: ${item.description}`;
			if (item.transcript) {
				text += `\n\nTranscript（节选）:\n${item.transcript}`;
			}
			return text;
		})
		.join("\n\n---\n\n");

	let deduplicationNote = "";
	if (existingContent) {
		deduplicationNote =
			`## ⚠️ 重要：以下是今天已生成的播客 Feed，请勿重复\n\n` +
			`${existingContent}\n\n`;
	}

	const userMessage =
		`${deduplicationNote}` +
		`## 最新播客剧集（共 ${dedupedItems.length} 期）\n\n${episodesText}`;

	let aiContent: string;
	if (dedupedItems.length === 0) {
		aiContent = "今天暂无新的播客内容。";
	} else {
		const result = await callClaudeSimple({
			apiKey,
			model: effectiveModel,
			systemPrompt: PODCAST_FEED_SYSTEM_PROMPT,
			userMessage,
		});
		aiContent = result || "播客 Feed 生成失败。";
	}

	// Step 4: Write to vault
	onProgress?.({ stage: "write", message: "正在写入笔记..." });

	const today = new Date().toISOString().slice(0, 10);
	const filePath = `${feedFolder}/Podcast-${today}.md`;
	const existingFile = app.vault.getAbstractFileByPath(filePath);

	const folderExists = app.vault.getAbstractFileByPath(feedFolder);
	if (!folderExists) {
		await app.vault.createFolder(feedFolder);
	}

	let file: TFile;
	if (existingFile instanceof TFile && existingContent) {
		const now = new Date();
		const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
		const appendContent = `\n\n---\n\n# 播客 Feed 更新 - ${today} ${timeStr}\n\n${aiContent}\n`;
		await app.vault.modify(existingFile, existingContent + appendContent);
		file = existingFile;
	} else if (existingFile instanceof TFile) {
		const noteContent =
			`---\ntype: podcast-feed\ndate: ${today}\n---\n\n` +
			`# 播客 Feed - ${today}\n\n${aiContent}\n`;
		await app.vault.modify(existingFile, noteContent);
		file = existingFile;
	} else {
		const noteContent =
			`---\ntype: podcast-feed\ndate: ${today}\n---\n\n` +
			`# 播客 Feed - ${today}\n\n${aiContent}\n`;
		file = await app.vault.create(filePath, noteContent);
	}

	onProgress?.({ stage: "done", message: `播客 Feed 已生成: ${filePath}` });

	return file;
}
