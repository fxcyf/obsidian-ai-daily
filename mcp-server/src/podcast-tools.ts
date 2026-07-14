/**
 * Podcast tools — RSS episode discovery, transcript extraction (RSS content / YouTube captions),
 * and iTunes search. Ported from the Obsidian plugin to run directly in Node.js.
 */

import {
	getTagContent,
	getFirstTagContent,
	getAttr,
	stripHtml,
	extractBlocks,
	extractSelfClosingTags,
} from "./xml-utils.js";

// ── Types ──────────────────────────────────────────────────────────

export interface PodcastEpisode {
	title: string;
	link: string;
	published: Date | null;
	description: string;
	contentEncoded: string;
	duration: number | null;
	audioUrl: string;
	episodeNumber: string;
	podcastName: string;
}

// ── RSS parsing ────────────────────────────────────────────────────

function parseDate(dateStr: string): Date | null {
	if (!dateStr) return null;
	const d = new Date(dateStr);
	return isNaN(d.getTime()) ? null : d;
}

function parseDuration(raw: string): number | null {
	if (!raw) return null;
	const parts = raw.split(":").map(Number);
	if (parts.some(isNaN)) return null;
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 1) return parts[0];
	return null;
}

export function parsePodcastRss(xml: string, podcastName: string): PodcastEpisode[] {
	const episodes: PodcastEpisode[] = [];

	// Get channel title as fallback
	const channelTitle = podcastName || getFirstTagContent(xml, "title") || "Unknown";

	// Extract all <item> blocks
	const items = extractBlocks(xml, "item");

	for (const itemXml of items) {
		const title = getFirstTagContent(itemXml, "title");
		if (!title) continue;

		const link = getFirstTagContent(itemXml, "link");
		const pubDate = parseDate(getFirstTagContent(itemXml, "pubDate"));
		const description = getFirstTagContent(itemXml, "description");
		const contentEncoded = getFirstTagContent(itemXml, "encoded");
		const durationRaw = getFirstTagContent(itemXml, "duration");
		const episodeNum = getFirstTagContent(itemXml, "episode");

		// Extract enclosure URL
		const enclosures = extractSelfClosingTags(itemXml, "enclosure");
		const audioUrl = enclosures.length > 0 ? getAttr(enclosures[0], "url") : "";

		episodes.push({
			title,
			link: link || audioUrl,
			published: pubDate,
			description: stripHtml(description),
			contentEncoded,
			duration: parseDuration(durationRaw),
			audioUrl,
			episodeNumber: episodeNum,
			podcastName: channelTitle,
		});
	}

	return episodes;
}

export async function fetchPodcastRss(
	feedUrl: string,
	podcastName: string
): Promise<PodcastEpisode[]> {
	const resp = await fetch(feedUrl, {
		headers: { "User-Agent": "obsidian-ai-daily/0.1" },
	});
	const text = await resp.text();
	return parsePodcastRss(text, podcastName);
}

// ── YouTube transcript (innertube JSON API) ────────────────────────

const YT_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/;

export function extractYouTubeId(url: string): string | null {
	const m = url.match(YT_ID_RE);
	return m ? m[1] : null;
}

export async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
	try {
		const playerResp = await fetch("https://www.youtube.com/youtubei/v1/player", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				videoId,
				context: {
					client: {
						clientName: "WEB",
						clientVersion: "2.20240101.00.00",
						hl: "en",
					},
				},
			}),
		});

		const data = await playerResp.json() as Record<string, unknown>;
		const captions = data?.captions as Record<string, unknown> | undefined;
		const renderer = captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined;
		const tracks = renderer?.captionTracks as Array<{ languageCode: string; baseUrl: string }> | undefined;
		if (!tracks || tracks.length === 0) return null;

		const enTrack = tracks.find((t) => t.languageCode === "en") ?? tracks[0];
		const captionUrl = enTrack.baseUrl;
		if (!captionUrl) return null;

		const captionResp = await fetch(captionUrl, {
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});
		const captionXml = await captionResp.text();

		// Extract <text> elements from caption XML
		const texts = getTagContent(captionXml, "text");
		const lines = texts
			.map((t) => stripHtml(t))
			.filter(Boolean);

		return lines.join(" ").trim() || null;
	} catch {
		return null;
	}
}

// ── Transcript extraction (combined strategy) ──────────────────────

const TRANSCRIPT_MIN_LENGTH = 2000;
const TRANSCRIPT_MAX_LENGTH = 50_000;

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max) + "\n\n...(truncated)";
}

function extractTextFromHtml(html: string): string {
	const cleaned = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/ {2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return cleaned;
}

export async function extractTranscript(episode: PodcastEpisode): Promise<string> {
	// Priority 1: RSS content:encoded with substantial text
	if (episode.contentEncoded) {
		const text = extractTextFromHtml(episode.contentEncoded);
		if (text.length >= TRANSCRIPT_MIN_LENGTH) {
			return truncate(text, TRANSCRIPT_MAX_LENGTH);
		}
	}

	// Priority 2: YouTube captions
	const ytId = extractYouTubeId(episode.link) || extractYouTubeId(episode.audioUrl);
	if (ytId) {
		const transcript = await fetchYouTubeTranscript(ytId);
		if (transcript && transcript.length >= TRANSCRIPT_MIN_LENGTH) {
			return truncate(transcript, TRANSCRIPT_MAX_LENGTH);
		}
	}

	// Priority 3: Fallback to description
	if (episode.description) {
		return truncate(episode.description, TRANSCRIPT_MAX_LENGTH);
	}

	return "(No transcript available)";
}

// ── iTunes search ──────────────────────────────────────────────────

interface iTunesResult {
	collectionName: string;
	feedUrl: string;
	artistName: string;
	artworkUrl100: string;
	collectionId: number;
}

async function searchITunes(query: string, limit: number = 10): Promise<iTunesResult[]> {
	const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&limit=${limit}`;
	const resp = await fetch(url);
	const data = await resp.json() as { results?: iTunesResult[] };
	return (data.results ?? []).filter((r) => r.feedUrl);
}

// ── Chat tool interface ────────────────────────────────────────────

export class PodcastTools {
	async execute(name: string, input: Record<string, unknown>): Promise<string> {
		switch (name) {
			case "podcast_search":
				return this.podcastSearch(input);
			case "podcast_episodes":
				return this.podcastEpisodes(input);
			case "podcast_transcript":
				return this.podcastTranscript(input);
			default:
				return `Unknown podcast tool: ${name}`;
		}
	}

	private async podcastSearch(input: Record<string, unknown>): Promise<string> {
		const query = input.query as string;
		if (!query) return "Error: query is required";

		try {
			const results = await searchITunes(query, (input.limit as number) || 10);
			if (results.length === 0) return "No podcasts found.";

			return results
				.map(
					(r) =>
						`**${r.collectionName}**\nBy: ${r.artistName}\nFeed: ${r.feedUrl}\nID: ${r.collectionId}`
				)
				.join("\n\n");
		} catch (e) {
			return `Error searching podcasts: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	private async podcastEpisodes(input: Record<string, unknown>): Promise<string> {
		const url = input.url as string;
		if (!url) return "Error: url (RSS feed URL) is required";

		const limit = (input.limit as number) || 5;

		try {
			const episodes = await fetchPodcastRss(url, "");
			const recent = episodes.slice(0, limit);
			if (recent.length === 0) return "No episodes found.";

			return recent
				.map((ep) => {
					const parts = [`**${ep.title}**`];
					if (ep.podcastName) parts.push(`Podcast: ${ep.podcastName}`);
					if (ep.episodeNumber) parts.push(`Episode: ${ep.episodeNumber}`);
					if (ep.published) parts.push(`Date: ${ep.published.toISOString().slice(0, 10)}`);
					if (ep.duration) {
						const mins = Math.floor(ep.duration / 60);
						parts.push(`Duration: ${mins} min`);
					}
					if (ep.link) parts.push(`Link: ${ep.link}`);
					if (ep.audioUrl && ep.audioUrl !== ep.link) parts.push(`Audio: ${ep.audioUrl}`);
					if (ep.description) parts.push(`Description: ${ep.description.slice(0, 300)}`);
					return parts.join("\n");
				})
				.join("\n\n---\n\n");
		} catch (e) {
			return `Error fetching episodes: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	private async podcastTranscript(input: Record<string, unknown>): Promise<string> {
		const url = input.url as string;
		if (!url) return "Error: url is required (RSS feed URL of the podcast)";

		const episodeIndex = (input.episode_index as number) ?? 0;

		try {
			// If user gives a YouTube URL directly, fetch transcript
			const ytId = extractYouTubeId(url);
			if (ytId) {
				const transcript = await fetchYouTubeTranscript(ytId);
				return transcript
					? truncate(transcript, TRANSCRIPT_MAX_LENGTH)
					: "(YouTube transcript not available for this video)";
			}

			// Otherwise treat as RSS feed URL — fetch episodes then extract transcript
			const episodes = await fetchPodcastRss(url, "");
			if (episodes.length === 0) return "No episodes found in this feed.";

			const idx = Math.max(0, Math.min(episodeIndex, episodes.length - 1));
			const episode = episodes[idx];

			const transcript = await extractTranscript(episode);

			const header = [
				`# ${episode.title}`,
				episode.podcastName ? `Podcast: ${episode.podcastName}` : "",
				episode.published ? `Date: ${episode.published.toISOString().slice(0, 10)}` : "",
				episode.duration ? `Duration: ${Math.floor(episode.duration / 60)} min` : "",
				episode.link ? `Link: ${episode.link}` : "",
				"---",
			]
				.filter(Boolean)
				.join("\n");

			return `${header}\n\n${transcript}`;
		} catch (e) {
			return `Error fetching transcript: ${e instanceof Error ? e.message : String(e)}`;
		}
	}
}
