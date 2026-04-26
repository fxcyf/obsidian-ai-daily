import { describe, expect, it, vi } from "vitest";
import {
	timeDecay,
	socialBoost,
	detectBursts,
	scoreRelevance,
	type Article,
} from "./feeds";

// ── Helpers ─────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<Article> = {}): Article {
	return {
		title: "",
		url: "https://example.com",
		source: "TestSource",
		category: "community",
		published: new Date(),
		summary: "",
		relevanceScore: 0,
		socialScore: 0,
		commentCount: 0,
		...overrides,
	};
}

// ── timeDecay ───────────────────────────────────────────────────────

describe("timeDecay", () => {
	it("returns 0.6 for null date", () => {
		expect(timeDecay(null)).toBe(0.6);
	});

	it("returns 1.5 for content < 12 hours old", () => {
		const recent = new Date(Date.now() - 6 * 3600 * 1000);
		expect(timeDecay(recent)).toBe(1.5);
	});

	it("returns 1.3 for content 12-24 hours old", () => {
		const d = new Date(Date.now() - 18 * 3600 * 1000);
		expect(timeDecay(d)).toBe(1.3);
	});

	it("returns 1.0 for content 24-48 hours old", () => {
		const d = new Date(Date.now() - 36 * 3600 * 1000);
		expect(timeDecay(d)).toBe(1.0);
	});

	it("returns 0.7 for content 48-72 hours old", () => {
		const d = new Date(Date.now() - 60 * 3600 * 1000);
		expect(timeDecay(d)).toBe(0.7);
	});

	it("returns higher score for high-engagement weekly content", () => {
		const weekOld = new Date(Date.now() - 120 * 3600 * 1000);
		expect(timeDecay(weekOld, 500)).toBe(0.8);
		expect(timeDecay(weekOld, 200)).toBe(0.6);
		expect(timeDecay(weekOld, 0)).toBe(0.4);
	});

	it("returns low scores for very old content, boosted by engagement", () => {
		const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000);
		expect(timeDecay(oldDate, 500)).toBe(0.6);
		expect(timeDecay(oldDate, 200)).toBe(0.5);
		expect(timeDecay(oldDate, 0)).toBe(0.3);
	});
});

// ── socialBoost ─────────────────────────────────────────────────────

describe("socialBoost", () => {
	it("returns 1.0 for zero engagement", () => {
		expect(socialBoost(makeArticle())).toBe(1.0);
	});

	it("returns 2.5 for very high engagement (500+)", () => {
		expect(socialBoost(makeArticle({ socialScore: 500 }))).toBe(2.5);
	});

	it("returns 2.0 for high engagement (200+)", () => {
		expect(socialBoost(makeArticle({ socialScore: 200 }))).toBe(2.0);
	});

	it("returns 1.6 for medium engagement (100+)", () => {
		expect(socialBoost(makeArticle({ socialScore: 100 }))).toBe(1.6);
	});

	it("counts comments with 2x weight", () => {
		// 10 points + 50 comments * 2 = 110 engagement → 1.6
		expect(socialBoost(makeArticle({ socialScore: 10, commentCount: 50 }))).toBe(1.6);
	});
});

// ── detectBursts ────────────────────────────────────────────────────

describe("detectBursts", () => {
	it("returns empty map when no topic appears across 3+ sources", () => {
		const articles = [
			makeArticle({ title: "LLM advances", source: "SourceA" }),
			makeArticle({ title: "LLM news", source: "SourceB" }),
		];
		expect(detectBursts(articles).size).toBe(0);
	});

	it("detects burst when a keyword appears across 3+ sources", () => {
		const articles = [
			makeArticle({ title: "New LLM breakthrough", source: "SourceA" }),
			makeArticle({ title: "LLM comparison", source: "SourceB" }),
			makeArticle({ title: "LLM in production", source: "SourceC" }),
		];
		const bursts = detectBursts(articles);
		expect(bursts.has("llm")).toBe(true);
		expect(bursts.get("llm")).toBe(1.5);
	});

	it("increases burst score with more sources", () => {
		const articles = [
			makeArticle({ title: "RAG pipeline", source: "A" }),
			makeArticle({ title: "RAG tutorial", source: "B" }),
			makeArticle({ title: "RAG benchmark", source: "C" }),
			makeArticle({ title: "RAG comparison", source: "D" }),
		];
		const bursts = detectBursts(articles);
		expect(bursts.get("rag")).toBe(1.7);
	});
});

// ── scoreRelevance ──────────────────────────────────────────────────

describe("scoreRelevance", () => {
	it("returns 0 for non-AI content with no keyword matches", () => {
		const article = makeArticle({
			title: "Cooking pasta tonight",
			summary: "A simple dinner plan",
			published: new Date(),
		});
		expect(scoreRelevance(article, [], new Map())).toBe(0);
	});

	it("scores AI-related content higher", () => {
		const article = makeArticle({
			title: "New LLM agent framework released",
			summary: "A multi-agent system for RAG",
			published: new Date(),
		});
		const score = scoreRelevance(article, [], new Map());
		expect(score).toBeGreaterThan(5);
	});

	it("boosts score for user-specified topics", () => {
		const article = makeArticle({
			title: "New LLM framework",
			summary: "Supports fine-tuning and RAG",
			published: new Date(),
		});
		const withoutTopics = scoreRelevance(article, [], new Map());
		const withTopics = scoreRelevance(article, ["RAG"], new Map());
		expect(withTopics).toBeGreaterThan(withoutTopics);
	});

	it("applies category weight", () => {
		const base = {
			title: "LLM benchmark results",
			summary: "SOTA performance",
			published: new Date(),
			socialScore: 0,
			commentCount: 0,
		};
		const community = makeArticle({ ...base, category: "community" });
		const news = makeArticle({ ...base, category: "news" });
		const communityScore = scoreRelevance(community, [], new Map());
		const newsScore = scoreRelevance(news, [], new Map());
		// community weight (1.8) > news weight (0.5)
		expect(communityScore).toBeGreaterThan(newsScore);
	});

	it("applies burst topic boost", () => {
		const article = makeArticle({
			title: "LLM advances",
			summary: "New breakthrough",
			published: new Date(),
		});
		const noBurst = scoreRelevance(article, [], new Map());
		const withBurst = scoreRelevance(article, [], new Map([["llm", 2.0]]));
		expect(withBurst).toBeGreaterThan(noBurst);
	});

	it("applies social engagement boost", () => {
		const base = {
			title: "LLM framework comparison",
			summary: "Benchmark results",
			published: new Date(),
		};
		const lowEngagement = makeArticle({ ...base, socialScore: 5 });
		const highEngagement = makeArticle({ ...base, socialScore: 500 });
		const lowScore = scoreRelevance(lowEngagement, [], new Map());
		const highScore = scoreRelevance(highEngagement, [], new Map());
		expect(highScore).toBeGreaterThan(lowScore);
	});
});
