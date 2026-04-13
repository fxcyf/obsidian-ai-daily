/**
 * RSS feed fetching, parsing, and relevance scoring.
 * Ported from ai-daily (Python) to TypeScript for Obsidian plugin use.
 * Uses Obsidian's requestUrl to bypass CORS on mobile.
 */

import { requestUrl } from "obsidian";

// ── Types ──────────────────────────────────────────────────────────

export interface FeedSource {
	name: string;
	url: string;
	category: string;
}

export interface Article {
	title: string;
	url: string;
	source: string;
	category: string;
	published: Date | null;
	summary: string;
	relevanceScore: number;
}

// ── Default RSS sources ────────────────────────────────────────────

export const DEFAULT_FEEDS: FeedSource[] = [
	// Research
	{ name: "ArXiv CS.AI", url: "https://rss.arxiv.org/rss/cs.AI", category: "research" },
	{ name: "ArXiv CS.CL (NLP)", url: "https://rss.arxiv.org/rss/cs.CL", category: "research" },
	{ name: "ArXiv CS.LG (ML)", url: "https://rss.arxiv.org/rss/cs.LG", category: "research" },
	// Community
	{
		name: "Hacker News (Best)",
		url: "https://hnrss.org/best?q=AI+OR+LLM+OR+GPT+OR+agent+OR+machine+learning+OR+Claude+OR+OpenAI+OR+Anthropic",
		category: "community",
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
	research: 2.0,
	tools: 1.5,
	community: 1.2,
	newsletter: 1.0,
	news: 0.5,
	industry: 0.6,
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

/**
 * Minimal XML parser using DOMParser.
 * Works in both desktop (Electron) and mobile (WebView) Obsidian.
 */
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

// ── Feed fetching ──────────────────────────────────────────────────

async function fetchFeed(feed: FeedSource): Promise<Article[]> {
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

	// RSS 2.0 items
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
			});
		}
	}

	// Atom entries
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
			});
		}
	}

	return articles;
}

// ── Relevance scoring ──────────────────────────────────────────────

function scoreRelevance(article: Article, userTopics: string[]): number {
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

	// User topic boost: if article matches any user-defined topic, boost significantly
	if (userTopics.length > 0) {
		const lowerTopics = userTopics.map((t) => t.toLowerCase());
		for (const topic of lowerTopics) {
			if (text.includes(topic)) {
				score *= 2.0;
				break;
			}
		}
	}

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

	// Score
	for (const article of allArticles) {
		article.relevanceScore = scoreRelevance(article, userTopics);
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
