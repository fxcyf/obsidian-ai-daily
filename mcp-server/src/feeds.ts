/**
 * RSS feed fetching, parsing, and relevance scoring.
 * Supports traditional RSS, HN Algolia API, Reddit JSON, and GitHub Trending.
 * Ported from the Obsidian plugin to run directly in Node.js.
 */

import { fetchPodcastRss } from "./podcast-tools.js";
import {
	getFirstTagContent,
	getAttr,
	stripHtml,
	extractBlocks,
	extractSelfClosingTags,
} from "./xml-utils.js";

// ── Types ──────────────────────────────────────────────────────────

export interface FeedSource {
	name: string;
	url: string;
	category: string;
	/** Source type: "rss" (default), "hn", "reddit", "github-trending", "podcast" */
	type?: "rss" | "hn" | "reddit" | "github-trending" | "podcast";
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
	// Engineering blogs — practical experience & deep dives
	{ name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", category: "engineering" },
	{ name: "Chip Huyen", url: "https://huyenchip.com/feed.xml", category: "engineering" },
	{ name: "Eugene Yan", url: "https://eugeneyan.com/rss/", category: "engineering" },
	{ name: "Lil'Log (Lilian Weng)", url: "https://lilianweng.github.io/index.xml", category: "engineering" },
	{ name: "Jay Alammar", url: "https://jalammar.github.io/feed.xml", category: "engineering" },
	{ name: "Sebastian Raschka", url: "https://sebastianraschka.com/rss_feed.xml", category: "engineering" },
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
	// Podcasts — AI & Tech
	{ name: "Latent Space", url: "https://api.substack.com/feed/podcast/1084089.rss", category: "podcast", type: "podcast" },
	{ name: "Lex Fridman Podcast", url: "https://lexfridman.com/feed/podcast/", category: "podcast", type: "podcast" },
	{ name: "Dwarkesh Podcast", url: "https://api.substack.com/feed/podcast/1092974.rss", category: "podcast", type: "podcast" },
	{ name: "All-In Podcast", url: "https://feeds.megaphone.fm/all-in-with-chamath-jason-sacks-friedberg", category: "podcast", type: "podcast" },
	{ name: "Cognitive Revolution", url: "https://feeds.buzzsprout.com/2126886.rss", category: "podcast", type: "podcast" },
	{ name: "No Priors", url: "https://feeds.transistor.fm/no-priors-ai-machine-learning-technology-and-the-future", category: "podcast", type: "podcast" },
	{ name: "Practical AI", url: "https://changelog.com/practicalai/feed", category: "podcast", type: "podcast" },
	{ name: "TWIML AI", url: "https://feeds.megaphone.fm/MLN2155636147", category: "podcast", type: "podcast" },
	{ name: "Gradient Dissent", url: "https://feeds.soundcloud.com/users/soundcloud:users:417588742/sounds.rss", category: "podcast", type: "podcast" },
	// Podcasts — Business & Knowledge
	{ name: "The Diary of a CEO", url: "https://feeds.megaphone.fm/DIARYOFACEO", category: "podcast", type: "podcast" },
	{ name: "The Knowledge Project", url: "https://theknowledgeproject.libsyn.com/rss", category: "podcast", type: "podcast" },
	{ name: "My First Million", url: "https://feeds.megaphone.fm/HSW2989179395", category: "podcast", type: "podcast" },
	{ name: "Founders Podcast", url: "https://feeds.transistor.fm/founders-podcast", category: "podcast", type: "podcast" },
	{ name: "Acquired", url: "https://feeds.pacific-content.com/acquired", category: "podcast", type: "podcast" },
	{ name: "Invest Like the Best", url: "https://investlikethebest.libsyn.com/rss", category: "podcast", type: "podcast" },
	{ name: "The Tim Ferriss Show", url: "https://rss.art19.com/tim-ferriss-show", category: "podcast", type: "podcast" },
	{ name: "a16z Podcast", url: "https://feeds.simplecast.com/JGE3yC0V", category: "podcast", type: "podcast" },
	// Podcasts — Science & Curiosity
	{ name: "Search Engine", url: "https://feeds.megaphone.fm/searchengine", category: "podcast", type: "podcast" },
	{ name: "Hidden Brain", url: "https://feeds.simplecast.com/kwWc0lhf", category: "podcast", type: "podcast" },
	{ name: "Think Fast Talk Smart", url: "https://feeds.megaphone.fm/thinkfasttalksmart", category: "podcast", type: "podcast" },
	{ name: "Radiolab", url: "https://feeds.simplecast.com/EmVW7VGp", category: "podcast", type: "podcast" },
	{ name: "Freakonomics Radio", url: "https://feeds.simplecast.com/Y8lFbOT4", category: "podcast", type: "podcast" },
	{ name: "Huberman Lab", url: "https://feeds.megaphone.fm/hubermanlab", category: "podcast", type: "podcast" },
	{ name: "Making Sense", url: "https://wakingup.libsyn.com/rss", category: "podcast", type: "podcast" },
	{ name: "Conversations with Tyler", url: "https://feeds.megaphone.fm/conversationswithtyler", category: "podcast", type: "podcast" },
	{ name: "80,000 Hours", url: "https://feeds.feedburner.com/80aboradiostinp", category: "podcast", type: "podcast" },
];

// ── Category weights ───────────────────────────────────────────────

const CATEGORY_WEIGHT: Record<string, number> = {
	research: 1.0,
	engineering: 2.0,
	tools: 1.5,
	community: 1.8,
	podcast: 1.5,
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
		"|production|deploy|scale|infra|pipeline|latency|throughput" +
		"|lesson.learned|postmortem|case.study|best.practice|real.world" +
		"|engineering|system.design|migration|optimization|monitoring" +
	")\\b",
	"gi"
);

const HOT_TOPICS = new Set([
	"agent", "agentic", "llm", "rag", "mcp", "tool.use",
]);

// ── Helpers ────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date | null {
	if (!dateStr) return null;
	const d = new Date(dateStr);
	return isNaN(d.getTime()) ? null : d;
}

// ── Feed fetching (RSS) ───────────────────────────────────────────

export async function fetchRssFeed(feed: FeedSource): Promise<Article[]> {
	const articles: Article[] = [];

	let data: string;
	try {
		const resp = await fetch(feed.url, {
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});
		data = await resp.text();
	} catch {
		return articles;
	}

	// Parse RSS <item> elements
	const items = extractBlocks(data, "item");
	for (const itemXml of items) {
		const title = getFirstTagContent(itemXml, "title");
		const link = getFirstTagContent(itemXml, "link");
		const desc = stripHtml(getFirstTagContent(itemXml, "description"));
		const pubDate = parseDate(getFirstTagContent(itemXml, "pubDate"));
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

	// Parse Atom <entry> elements
	const entries = extractBlocks(data, "entry");
	for (const entryXml of entries) {
		const title = getFirstTagContent(entryXml, "title");
		// Atom links use <link href="..." /> attribute
		const linkTags = extractSelfClosingTags(entryXml, "link");
		// Prefer alternate link, fall back to first link
		let link = "";
		for (const lt of linkTags) {
			const rel = getAttr(lt, "rel");
			const href = getAttr(lt, "href");
			if (rel === "alternate" || !link) {
				link = href;
			}
		}
		// Also try extracting link as a block (some feeds use <link>url</link>)
		if (!link) {
			link = getFirstTagContent(entryXml, "link");
		}
		const summary = stripHtml(
			getFirstTagContent(entryXml, "summary") ||
			getFirstTagContent(entryXml, "content")
		);
		const pubDate = parseDate(
			getFirstTagContent(entryXml, "updated") ||
			getFirstTagContent(entryXml, "published")
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

interface HnHit {
	title?: string;
	url?: string;
	objectID?: string;
	created_at?: string;
	story_text?: string;
	points?: number;
	num_comments?: number;
}

async function fetchHnFeed(feed: FeedSource): Promise<Article[]> {
	const articles: Article[] = [];
	try {
		const resp = await fetch(resolveHnUrl(feed), {
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});
		const data = await resp.json() as { hits?: HnHit[] };
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

interface RedditPost {
	title?: string;
	url?: string;
	permalink?: string;
	stickied?: boolean;
	created_utc?: number;
	selftext?: string;
	ups?: number;
	num_comments?: number;
}

async function fetchRedditFeed(feed: FeedSource): Promise<Article[]> {
	const articles: Article[] = [];
	try {
		const resp = await fetch(feed.url, {
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});
		const data = await resp.json() as { data?: { children?: Array<{ data: RedditPost }> } };
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
		const resp = await fetch(feed.url, {
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});
		const html = await resp.text();

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

// ── Podcast RSS feed ─────────────────────────────────────────────

async function fetchPodcastFeed(feed: FeedSource): Promise<Article[]> {
	try {
		const episodes = await fetchPodcastRss(feed.url, feed.name);
		return episodes.slice(0, 1).map((ep) => {
			const durationStr = ep.duration ? ` (${Math.floor(ep.duration / 60)} min)` : "";
			const epNum = ep.episodeNumber ? ` #${ep.episodeNumber}` : "";
			return {
				title: `\u{1F399}️ ${ep.title}${epNum}${durationStr}`,
				url: ep.link || ep.audioUrl,
				source: feed.name,
				category: feed.category,
				published: ep.published,
				summary: ep.description.slice(0, 500),
				relevanceScore: 0,
				socialScore: 0,
				commentCount: 0,
			};
		});
	} catch (e) {
		console.warn(`[ai-daily] podcast fetch failed: ${feed.name}`, e);
		return [];
	}
}

// ── Unified fetch dispatcher ──────────────────────────────────────

async function fetchFeed(feed: FeedSource): Promise<Article[]> {
	const type = feed.type ?? "rss";
	switch (type) {
		case "hn": return fetchHnFeed(feed);
		case "reddit": return fetchRedditFeed(feed);
		case "github-trending": return fetchGithubTrending(feed);
		case "podcast": return fetchPodcastFeed(feed);
		default: return fetchRssFeed(feed);
	}
}

// ── Time decay ────────────────────────────────────────────────────

export function timeDecay(published: Date | null, engagement: number = 0): number {
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

export function socialBoost(article: Article): number {
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

export function detectBursts(articles: Article[]): Map<string, number> {
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

export function scoreRelevance(
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

	// Podcasts are explicitly subscribed by the user — give a base score so they
	// aren't filtered out when episode titles don't contain AI keywords.
	const podcastBase = article.category === "podcast" ? 2.0 : 0;
	let score = unique.size * 1.0 + titleUnique.size * 2.0 + podcastBase;

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

	onProgress?.(`Fetching ${feeds.length} sources concurrently...`);

	const results = await Promise.allSettled(
		feeds.map((feed) => fetchFeed(feed))
	);

	const allArticles: Article[] = [];
	const failedSources: string[] = [];
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (result.status === "fulfilled") {
			allArticles.push(...result.value);
		} else {
			failedSources.push(feeds[i].name);
			console.warn(`[ai-daily] feed fetch failed: ${feeds[i].name}`, result.reason);
		}
	}

	if (failedSources.length > 0) {
		onProgress?.(`Warning: ${failedSources.length} sources failed: ${failedSources.join(", ")}`);
	}
	onProgress?.(`Fetched ${allArticles.length} articles, scoring and filtering...`);

	// [B] Detect burst topics across all articles before scoring
	const burstTopics = detectBursts(allArticles);
	if (burstTopics.size > 0) {
		const burstNames = [...burstTopics.keys()].slice(0, 5).join(", ");
		onProgress?.(`Hot topics detected: ${burstNames}`);
	}

	// Score
	for (const article of allArticles) {
		article.relevanceScore = scoreRelevance(article, userTopics, burstTopics);
	}

	// Filter by min score
	const filtered = allArticles.filter((a) => a.relevanceScore >= minScore);

	// Deduplicate by URL
	const seen = new Set<string>();
	const uniqueArticles: Article[] = [];
	for (const a of filtered) {
		if (!seen.has(a.url)) {
			seen.add(a.url);
			uniqueArticles.push(a);
		}
	}

	const sortByRelevance = (a: Article, b: Article) => {
		if (b.relevanceScore !== a.relevanceScore) {
			return b.relevanceScore - a.relevanceScore;
		}
		const dateA = a.published?.getTime() ?? 0;
		const dateB = b.published?.getTime() ?? 0;
		return dateB - dateA;
	};

	// Reserve slots for podcasts — one per source for diversity, then fill by score
	const podcasts = uniqueArticles.filter((a) => a.category === "podcast");
	const nonPodcasts = uniqueArticles.filter((a) => a.category !== "podcast");
	nonPodcasts.sort(sortByRelevance);

	// Pick best episode per podcast source first
	const bestPerSource = new Map<string, Article>();
	podcasts.sort(sortByRelevance);
	for (const p of podcasts) {
		if (!bestPerSource.has(p.source)) {
			bestPerSource.set(p.source, p);
		}
	}
	const diversePodcasts = [...bestPerSource.values()];
	diversePodcasts.sort(sortByRelevance);

	const podcastSlots = Math.min(diversePodcasts.length, Math.max(3, Math.ceil(maxArticles * 0.25)));
	const result = [
		...nonPodcasts.slice(0, maxArticles - podcastSlots),
		...diversePodcasts.slice(0, podcastSlots),
	];
	result.sort(sortByRelevance);

	return result.slice(0, maxArticles);
}
