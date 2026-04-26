/**
 * RSS feed fetching, parsing, and relevance scoring.
 * Supports traditional RSS, HN Algolia API, Reddit JSON, and GitHub Trending.
 * Uses Obsidian's requestUrl to bypass CORS on mobile.
 */

import { requestUrl } from "obsidian";

// ── Types ──────────────────────────────────────────────────────────

export interface FeedSource {
	name: string;
	url: string;
	category: string;
	/** Source type: "rss" (default), "hn", "reddit", "github-trending" */
	type?: "rss" | "hn" | "reddit" | "github-trending";
}

export interface Article {
	title: string;
	url: string;
	source: string;
	category: string;
	published: Date | null;
	summary: string;
	relevanceScore: number;
	/** Social engagement metrics (points, upvotes, stars, etc.) */
	socialScore: number;
	/** Number of comments/discussions */
	commentCount: number;
}

// ── Default RSS sources ────────────────────────────────────────────

export const DEFAULT_FEEDS: FeedSource[] = [
	// Research (kept but fewer — avoid flooding with long-tail papers)
	{ name: "ArXiv CS.AI", url: "https://rss.arxiv.org/rss/cs.AI", category: "research" },
	{ name: "ArXiv CS.CL (NLP)", url: "https://rss.arxiv.org/rss/cs.CL", category: "research" },
	// Community — with social signals
	{
		name: "Hacker News",
		url: "https://hn.algolia.com/api/v1/search?tags=story&query=AI+LLM+GPT+agent+Claude+machine+learning&hitsPerPage=30&numericFilters=points>20",
		category: "community",
		type: "hn",
	},
	{
		name: "HN Best of Week",
		url: "hn-weekly",
		category: "community",
		type: "hn",
	},
	{
		name: "Reddit r/MachineLearning",
		url: "https://www.reddit.com/r/MachineLearning/hot.json?limit=25",
		category: "community",
		type: "reddit",
	},
	{
		name: "Reddit r/MachineLearning Top/Week",
		url: "https://www.reddit.com/r/MachineLearning/top.json?t=week&limit=15",
		category: "community",
		type: "reddit",
	},
	{
		name: "Reddit r/LocalLLaMA",
		url: "https://www.reddit.com/r/LocalLLaMA/hot.json?limit=25",
		category: "community",
		type: "reddit",
	},
	{
		name: "Reddit r/LocalLLaMA Top/Week",
		url: "https://www.reddit.com/r/LocalLLaMA/top.json?t=week&limit=15",
		category: "community",
		type: "reddit",
	},
	// GitHub Trending
	{
		name: "GitHub Trending",
		url: "https://github.com/trending?since=daily&spoken_language_code=en",
		category: "tools",
		type: "github-trending",
	},
	{
		name: "GitHub Trending Weekly",
		url: "https://github.com/trending?since=weekly&spoken_language_code=en",
		category: "tools",
		type: "github-trending",
	},
	// Tools & blogs
	{ name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", category: "tools" },
	{ name: "The Batch (Andrew Ng)", url: "https://www.deeplearning.ai/the-batch/feed/", category: "newsletter" },
	// Industry
	{ name: "Anthropic Research", url: "https://www.anthropic.com/research/rss.xml", category: "industry" },
	{ name: "OpenAI Blog", url: "https://openai.com/blog/rss.xml", category: "industry" },
];

// ── Category weights ───────────────────────────────────────────────

const CATEGORY_WEIGHT: Record<string, number> = {
	research: 1.5,
	tools: 1.5,
	community: 1.8,
	newsletter: 1.0,
	news: 0.5,
	industry: 0.8,
};

// ── AI keyword pattern ─────────────────────────────────────────────

const AI_KEYWORDS = new RegExp(
	"\\b(" +
		"ai|artificial.intelligence|machine.learning|deep.learning|neural.net" +
		"|llm|large.language.model|gpt|claude|gemini|llama|mistral" +
		"|transformer|attention.mechanism|fine.tun|rlhf|rag" +
		"|agent|agentic|autonomous|multi.agent|tool.use" +
		"|diffusion|generative|gan|vae|stable.diffusion|midjourney|dall-e" +
		"|embedding|vector.database|prompt.engineer" +
		"|openai|anthropic|google.deepmind|meta.ai|hugging.face" +
		"|mlops|model.serving|inference|quantiz|distill" +
		"|computer.vision|nlp|natural.language|speech.recognition" +
		"|reinforcement.learning|reward.model" +
		"|mcp|model.context.protocol" +
	")\\b",
	"gi"
);

const TECH_DEPTH = new RegExp(
	"\\b(" +
		"benchmark|ablation|sota|state.of.the.art|open.source|github" +
		"|architecture|implementation|training|dataset|evaluation" +
		"|framework|library|api|sdk|tutorial|how.to|code" +
	")\\b",
	"gi"
);

const HOT_TOPICS = new Set([
	"agent", "agentic", "llm", "rag", "mcp", "tool.use",
]);

// ── XML parsing helpers ────────────────────────────────────────────

function stripHtml(text: string): string {
	return text.replace(/<[^>]+>/g, "").trim();
}

function parseDate(dateStr: string): Date | null {
	if (!dateStr) return null;
	const d = new Date(dateStr);
	return isNaN(d.getTime()) ? null : d;
}

function parseXml(xml: string): Document {
	return new DOMParser().parseFromString(xml, "text/xml");
}

function getTextContent(el: Element, tag: string, ns?: string): string {
	let child: Element | null;
	if (ns) {
		child = el.getElementsByTagNameNS(ns, tag)[0] ?? null;
	} else {
		child = el.getElementsByTagName(tag)[0] ?? null;
	}
	return child?.textContent?.trim() ?? "";
}

// ── Feed fetching (RSS) ───────────────────────────────────────────

async function fetchRssFeed(feed: FeedSource): Promise<Article[]> {
	const articles: Article[] = [];

	let data: string;
	try {
		const resp = await requestUrl({
			url: feed.url,
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});
		data = resp.text;
	} catch {
		return articles;
	}

	let doc: Document;
	try {
		doc = parseXml(data);
	} catch {
		return articles;
	}

	const ATOM_NS = "http://www.w3.org/2005/Atom";

	for (const item of Array.from(doc.getElementsByTagName("item"))) {
		const title = getTextContent(item, "title");
		const link = getTextContent(item, "link");
		const desc = stripHtml(getTextContent(item, "description"));
		const pubDate = parseDate(getTextContent(item, "pubDate"));
		if (title && link) {
			articles.push({
				title,
				url: link,
				source: feed.name,
				category: feed.category,
				published: pubDate,
				summary: desc.slice(0, 500),
				relevanceScore: 0,
				socialScore: 0,
				commentCount: 0,
			});
		}
	}

	for (const entry of Array.from(doc.getElementsByTagNameNS(ATOM_NS, "entry"))) {
		const title = getTextContent(entry, "title", ATOM_NS);
		const linkEl = entry.getElementsByTagNameNS(ATOM_NS, "link")[0];
		const link = linkEl?.getAttribute("href") ?? "";
		const summary = stripHtml(
			getTextContent(entry, "summary", ATOM_NS) ||
			getTextContent(entry, "content", ATOM_NS)
		);
		const pubDate = parseDate(
			getTextContent(entry, "updated", ATOM_NS) ||
			getTextContent(entry, "published", ATOM_NS)
		);
		if (title && link) {
			articles.push({
				title,
				url: link,
				source: feed.name,
				category: feed.category,
				published: pubDate,
				summary: summary.slice(0, 500),
				relevanceScore: 0,
				socialScore: 0,
				commentCount: 0,
			});
		}
	}

	return articles;
}

// ── Hacker News Algolia API ───────────────────────────────────────

function resolveHnUrl(feed: FeedSource): string {
	if (feed.url === "hn-weekly") {
		const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
		return `https://hn.algolia.com/api/v1/search?tags=story&query=AI+LLM+GPT+agent+Claude+machine+learning&hitsPerPage=20&numericFilters=points>100,created_at_i>${weekAgo}`;
	}
	return feed.url;
}

async function fetchHnFeed(feed: FeedSource): Promise<Article[]> {
	const articles: Article[] = [];
	try {
		const resp = await requestUrl({
			url: resolveHnUrl(feed),
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});
		const data = resp.json;
		for (const hit of data.hits ?? []) {
			const title = hit.title ?? "";
			const url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
			if (!title) continue;
			articles.push({
				title,
				url,
				source: feed.name,
				category: feed.category,
				published: parseDate(hit.created_at ?? ""),
				summary: (hit.story_text ? stripHtml(hit.story_text) : "").slice(0, 500),
				relevanceScore: 0,
				socialScore: hit.points ?? 0,
				commentCount: hit.num_comments ?? 0,
			});
		}
	} catch {
		// HN API unavailable
	}
	return articles;
}

// ── Reddit JSON API ───────────────────────────────────────────────

async function fetchRedditFeed(feed: FeedSource): Promise<Article[]> {
	const articles: Article[] = [];
	try {
		const resp = await requestUrl({
			url: feed.url,
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});
		const data = resp.json;
		for (const child of data?.data?.children ?? []) {
			const post = child.data;
			if (!post || post.stickied) continue;
			const title = post.title ?? "";
			const url = post.url || `https://reddit.com${post.permalink}`;
			if (!title) continue;
			articles.push({
				title,
				url,
				source: feed.name,
				category: feed.category,
				published: post.created_utc ? new Date(post.created_utc * 1000) : null,
				summary: (post.selftext ?? "").slice(0, 500),
				relevanceScore: 0,
				socialScore: post.ups ?? 0,
				commentCount: post.num_comments ?? 0,
			});
		}
	} catch {
		// Reddit API unavailable
	}
	return articles;
}

// ── GitHub Trending (HTML scraping) ───────────────────────────────

async function fetchGithubTrending(feed: FeedSource): Promise<Article[]> {
	const articles: Article[] = [];
	try {
		const resp = await requestUrl({
			url: feed.url,
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});
		const html = resp.text;

		const repoPattern = /<h2[^>]*class="[^"]*lh-condensed[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
		const starsPattern = /(\d[\d,]*)\s*stars\s+today/gi;
		const descPattern = /<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/g;

		const repoMatches = [...html.matchAll(repoPattern)];
		const descMatches = [...html.matchAll(descPattern)];
		const starsMatches = [...html.matchAll(starsPattern)];

		for (let i = 0; i < repoMatches.length; i++) {
			const repoPath = repoMatches[i][1].trim();
			const repoName = stripHtml(repoMatches[i][2]).replace(/\s+/g, "").trim();
			const desc = descMatches[i] ? stripHtml(descMatches[i][1]).trim() : "";
			const starsToday = starsMatches[i]
				? parseInt(starsMatches[i][1].replace(/,/g, ""), 10)
				: 0;

			if (!repoName) continue;
			articles.push({
				title: `${repoName}: ${desc}`.slice(0, 200),
				url: `https://github.com${repoPath}`,
				source: feed.name,
				category: feed.category,
				published: new Date(),
				summary: desc.slice(0, 500),
				relevanceScore: 0,
				socialScore: starsToday,
				commentCount: 0,
			});
		}
	} catch {
		// GitHub Trending unavailable
	}
	return articles;
}

// ── Unified fetch dispatcher ──────────────────────────────────────

async function fetchFeed(feed: FeedSource): Promise<Article[]> {
	const type = feed.type ?? "rss";
	switch (type) {
		case "hn": return fetchHnFeed(feed);
		case "reddit": return fetchRedditFeed(feed);
		case "github-trending": return fetchGithubTrending(feed);
		default: return fetchRssFeed(feed);
	}
}

// ── Time decay ────────────────────────────────────────────────────

function timeDecay(published: Date | null, engagement: number = 0): number {
	if (!published) return 0.6;
	const hoursAgo = (Date.now() - published.getTime()) / (1000 * 60 * 60);
	if (hoursAgo <= 12) return 1.5;
	if (hoursAgo <= 24) return 1.3;
	if (hoursAgo <= 48) return 1.0;
	if (hoursAgo <= 72) return 0.7;
	if (hoursAgo <= 168) {
		if (engagement >= 500) return 0.8;
		if (engagement >= 200) return 0.6;
		return 0.4;
	}
	if (engagement >= 500) return 0.6;
	if (engagement >= 200) return 0.5;
	return 0.3;
}

// ── Social score normalization ────────────────────────────────────

function socialBoost(article: Article): number {
	const { socialScore, commentCount } = article;
	if (socialScore === 0 && commentCount === 0) return 1.0;

	const engagement = socialScore + commentCount * 2;

	if (engagement >= 500) return 2.5;
	if (engagement >= 200) return 2.0;
	if (engagement >= 100) return 1.6;
	if (engagement >= 50) return 1.3;
	if (engagement >= 20) return 1.1;
	return 1.0;
}

// ── Burst detection ───────────────────────────────────────────────

function detectBursts(articles: Article[]): Map<string, number> {
	const topicSourceCount = new Map<string, Set<string>>();

	for (const article of articles) {
		const text = `${article.title} ${article.summary}`.toLowerCase();
		const matches = text.match(AI_KEYWORDS) ?? [];
		const unique = new Set(matches.map((m) => m.toLowerCase()));
		for (const keyword of unique) {
			if (!topicSourceCount.has(keyword)) {
				topicSourceCount.set(keyword, new Set());
			}
			topicSourceCount.get(keyword)!.add(article.source);
		}
	}

	const burstTopics = new Map<string, number>();
	for (const [keyword, sources] of topicSourceCount) {
		if (sources.size >= 3) {
			burstTopics.set(keyword, 1.5 + (sources.size - 3) * 0.2);
		}
	}
	return burstTopics;
}

// ── Relevance scoring ──────────────────────────────────────────────

function scoreRelevance(
	article: Article,
	userTopics: string[],
	burstTopics: Map<string, number>
): number {
	const text = `${article.title} ${article.summary}`.toLowerCase();

	// AI keyword matches
	const matches = text.match(AI_KEYWORDS) ?? [];
	const unique = new Set(matches.map((m) => m.toLowerCase()));
	const titleMatches = article.title.toLowerCase().match(AI_KEYWORDS) ?? [];
	const titleUnique = new Set(titleMatches.map((m) => m.toLowerCase()));

	let score = unique.size * 1.0 + titleUnique.size * 2.0;

	// Hot topic boost
	for (const topic of unique) {
		if (HOT_TOPICS.has(topic)) {
			score *= 1.5;
			break;
		}
	}

	// Technical depth boost
	const depthMatches = text.match(TECH_DEPTH) ?? [];
	const depthUnique = new Set(depthMatches.map((m) => m.toLowerCase()));
	score += depthUnique.size * 0.5;

	// Category weight
	score *= CATEGORY_WEIGHT[article.category] ?? 1.0;

	// User topic boost
	if (userTopics.length > 0) {
		const lowerTopics = userTopics.map((t) => t.toLowerCase());
		for (const topic of lowerTopics) {
			if (text.includes(topic)) {
				score *= 2.0;
				break;
			}
		}
	}

	// [A] Social engagement boost
	score *= socialBoost(article);

	// [B] Time decay — fresher content scores higher, high-engagement content decays slower
	const engagement = article.socialScore + article.commentCount * 2;
	score *= timeDecay(article.published, engagement);

	// [B] Burst detection — topics discussed across multiple sources get boosted
	let maxBurst = 1.0;
	for (const keyword of unique) {
		const burst = burstTopics.get(keyword);
		if (burst && burst > maxBurst) {
			maxBurst = burst;
		}
	}
	score *= maxBurst;

	return Math.round(score * 10) / 10;
}

// ── Public API ─────────────────────────────────────────────────────

export interface FetchOptions {
	feeds?: FeedSource[];
	userTopics?: string[];
	minScore?: number;
	maxArticles?: number;
	onProgress?: (msg: string) => void;
}

export async function fetchAllFeeds(options: FetchOptions = {}): Promise<Article[]> {
	const {
		feeds = DEFAULT_FEEDS,
		userTopics = [],
		minScore = 1.0,
		maxArticles = 20,
		onProgress,
	} = options;

	const allArticles: Article[] = [];

	for (const feed of feeds) {
		onProgress?.(`正在抓取: ${feed.name}...`);
		const articles = await fetchFeed(feed);
		allArticles.push(...articles);
	}

	onProgress?.(`共抓取 ${allArticles.length} 篇文章，正在评分筛选...`);

	// [B] Detect burst topics across all articles before scoring
	const burstTopics = detectBursts(allArticles);
	if (burstTopics.size > 0) {
		const burstNames = [...burstTopics.keys()].slice(0, 5).join(", ");
		onProgress?.(`🔥 检测到热点话题: ${burstNames}`);
	}

	// Score
	for (const article of allArticles) {
		article.relevanceScore = scoreRelevance(article, userTopics, burstTopics);
	}

	// Filter by min score
	const filtered = allArticles.filter((a) => a.relevanceScore >= minScore);

	// Deduplicate by URL
	const seen = new Set<string>();
	const unique: Article[] = [];
	for (const a of filtered) {
		if (!seen.has(a.url)) {
			seen.add(a.url);
			unique.push(a);
		}
	}

	// Sort by relevance, then recency
	unique.sort((a, b) => {
		if (b.relevanceScore !== a.relevanceScore) {
			return b.relevanceScore - a.relevanceScore;
		}
		const dateA = a.published?.getTime() ?? 0;
		const dateB = b.published?.getTime() ?? 0;
		return dateB - dateA;
	});

	return unique.slice(0, maxArticles);
}
