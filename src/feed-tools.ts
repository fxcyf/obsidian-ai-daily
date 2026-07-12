import { fetchAllFeeds, fetchRssFeed, type FeedSource } from "./feeds";

export class FeedTools {
	private feedSources: FeedSource[];

	constructor(feedSources: FeedSource[]) {
		this.feedSources = feedSources;
	}

	async execute(name: string, input: Record<string, unknown>): Promise<string> {
		switch (name) {
			case "fetch_feeds":
				return this.fetchFeeds(input);
			case "fetch_rss":
				return this.fetchRss(input);
			default:
				return `Unknown feed tool: ${name}`;
		}
	}

	private async fetchFeeds(input: Record<string, unknown>): Promise<string> {
		const topicsStr = input.topics as string | undefined;
		const userTopics = topicsStr
			? topicsStr.split(",").map((s) => s.trim()).filter(Boolean)
			: [];
		const maxArticles = (input.max_articles as number) || 20;
		const category = input.category as string | undefined;

		let feeds = this.feedSources;
		if (category) {
			feeds = feeds.filter((f) => f.category === category);
			if (feeds.length === 0) {
				return `Error: no feed sources found for category "${category}". Available: ${[...new Set(this.feedSources.map((f) => f.category))].join(", ")}`;
			}
		}

		try {
			const articles = await fetchAllFeeds({
				feeds,
				userTopics,
				maxArticles,
			});

			if (articles.length === 0) return "No articles found from configured sources.";

			const lines = articles.map((a) => {
				let text =
					`**${a.title}**\nSource: ${a.source} | Category: ${a.category} | Score: ${a.relevanceScore.toFixed(1)}`;
				if (a.published) text += ` | Date: ${a.published.toISOString().slice(0, 10)}`;
				if (a.socialScore > 0 || a.commentCount > 0) {
					text += ` | ${a.socialScore} points, ${a.commentCount} comments`;
				}
				text += `\nURL: ${a.url}`;
				if (a.summary) text += `\nSummary: ${a.summary.slice(0, 200)}`;
				return text;
			});

			return `Found ${articles.length} articles:\n\n${lines.join("\n\n---\n\n")}`;
		} catch (e) {
			return `Error fetching feeds: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	private async fetchRss(input: Record<string, unknown>): Promise<string> {
		const url = input.url as string;
		if (!url) return "Error: url is required";

		const name = (input.name as string) || "Custom RSS";
		const limit = (input.limit as number) || 10;

		const source: FeedSource = { name, url, category: "other" };

		try {
			const articles = await fetchRssFeed(source);
			const sliced = articles.slice(0, limit);

			if (sliced.length === 0) return "No articles found in this RSS feed.";

			const lines = sliced.map((a) => {
				let text = `**${a.title}**`;
				if (a.published) text += ` | Date: ${a.published.toISOString().slice(0, 10)}`;
				text += `\nURL: ${a.url}`;
				if (a.summary) text += `\nSummary: ${a.summary.slice(0, 300)}`;
				return text;
			});

			return `Found ${sliced.length} articles from ${name}:\n\n${lines.join("\n\n---\n\n")}`;
		} catch (e) {
			return `Error fetching RSS: ${e instanceof Error ? e.message : String(e)}`;
		}
	}
}
