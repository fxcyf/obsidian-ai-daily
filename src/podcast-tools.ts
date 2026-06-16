/**
 * Podcast tools — RSS episode discovery, transcript extraction (RSS content / YouTube captions),
 * and iTunes search. Used both as chat tools and by the feed system.
 */

import { requestUrl } from "obsidian";

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

function getTextContent(el: Element, tag: string, ns?: string): string {
	let child: Element | null;
	if (ns) {
		child = el.getElementsByTagNameNS(ns, tag)[0] ?? null;
	} else {
		child = el.getElementsByTagName(tag)[0] ?? null;
	}
	return child?.textContent?.trim() ?? "";
}

function stripHtml(text: string): string {
	return text.replace(/<[^>]+>/g, "").trim();
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
	const doc = new DOMParser().parseFromString(xml, "text/xml");
	const ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd";
	const CONTENT_NS = "http://purl.org/rss/1.0/modules/content/";
	const episodes: PodcastEpisode[] = [];

	const channelTitle = podcastName || getTextContent(doc.documentElement, "title") || "Unknown";

	for (const item of Array.from(doc.getElementsByTagName("item"))) {
		const title = getTextContent(item, "title");
		const link = getTextContent(item, "link");
		const pubDate = parseDate(getTextContent(item, "pubDate"));
		const description = getTextContent(item, "description");
		const contentEncoded = getTextContent(item, "encoded", CONTENT_NS);
		const durationRaw = getTextContent(item, "duration", ITUNES_NS);
		const episodeNum = getTextContent(item, "episode", ITUNES_NS);

		const enclosure = item.getElementsByTagName("enclosure")[0];
		const audioUrl = enclosure?.getAttribute("url") ?? "";

		if (!title) continue;

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
	const resp = await requestUrl({
		url: feedUrl,
		headers: { "User-Agent": "obsidian-ai-daily/0.1" },
	});
	return parsePodcastRss(resp.text, podcastName);
}

// ── YouTube transcript (innertube JSON API) ────────────────────────

const YT_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/;

export function extractYouTubeId(url: string): string | null {
	const m = url.match(YT_ID_RE);
	return m ? m[1] : null;
}

export async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
	try {
		const playerResp = await requestUrl({
			url: "https://www.youtube.com/youtubei/v1/player",
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

		const data = playerResp.json;
		const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
		if (!tracks || tracks.length === 0) return null;

		const enTrack = tracks.find(
			(t: { languageCode: string }) => t.languageCode === "en"
		) ?? tracks[0];

		const captionUrl = enTrack.baseUrl;
		if (!captionUrl) return null;

		const captionResp = await requestUrl({
			url: captionUrl,
			headers: { "User-Agent": "obsidian-ai-daily/0.1" },
		});

		const captionXml = captionResp.text;
		const doc = new DOMParser().parseFromString(captionXml, "text/xml");
		const texts = Array.from(doc.getElementsByTagName("text"));
		const lines = texts
			.map((t) => (t.textContent ?? "").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
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
	const resp = await requestUrl({ url });
	const data = resp.json;
	return (data.results ?? []).filter((r: iTunesResult) => r.feedUrl);
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
