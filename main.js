var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AIDailyChat
});
module.exports = __toCommonJS(main_exports);
var import_obsidian16 = require("obsidian");

// src/settings.ts
var import_obsidian3 = require("obsidian");

// src/feeds.ts
var import_obsidian2 = require("obsidian");

// src/podcast-tools.ts
var import_obsidian = require("obsidian");
function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}
function getTextContent(el, tag, ns) {
  var _a, _b, _c, _d;
  let child;
  if (ns) {
    child = (_a = el.getElementsByTagNameNS(ns, tag)[0]) != null ? _a : null;
  } else {
    child = (_b = el.getElementsByTagName(tag)[0]) != null ? _b : null;
  }
  return (_d = (_c = child == null ? void 0 : child.textContent) == null ? void 0 : _c.trim()) != null ? _d : "";
}
function stripHtml(text) {
  return text.replace(/<[^>]+>/g, "").trim();
}
function parseDuration(raw) {
  if (!raw) return null;
  const parts = raw.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}
function parsePodcastRss(xml, podcastName) {
  var _a;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd";
  const CONTENT_NS = "http://purl.org/rss/1.0/modules/content/";
  const episodes = [];
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
    const audioUrl = (_a = enclosure == null ? void 0 : enclosure.getAttribute("url")) != null ? _a : "";
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
      podcastName: channelTitle
    });
  }
  return episodes;
}
async function fetchPodcastRss(feedUrl, podcastName) {
  const resp = await (0, import_obsidian.requestUrl)({
    url: feedUrl,
    headers: { "User-Agent": "obsidian-ai-daily/0.1" }
  });
  return parsePodcastRss(resp.text, podcastName);
}
var YT_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/;
function extractYouTubeId(url) {
  const m = url.match(YT_ID_RE);
  return m ? m[1] : null;
}
async function fetchYouTubeTranscript(videoId) {
  var _a, _b, _c;
  try {
    const playerResp = await (0, import_obsidian.requestUrl)({
      url: "https://www.youtube.com/youtubei/v1/player",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240101.00.00",
            hl: "en"
          }
        }
      })
    });
    const data = playerResp.json;
    const tracks = (_b = (_a = data == null ? void 0 : data.captions) == null ? void 0 : _a.playerCaptionsTracklistRenderer) == null ? void 0 : _b.captionTracks;
    if (!tracks || tracks.length === 0) return null;
    const enTrack = (_c = tracks.find(
      (t) => t.languageCode === "en"
    )) != null ? _c : tracks[0];
    const captionUrl = enTrack.baseUrl;
    if (!captionUrl) return null;
    const captionResp = await (0, import_obsidian.requestUrl)({
      url: captionUrl,
      headers: { "User-Agent": "obsidian-ai-daily/0.1" }
    });
    const captionXml = captionResp.text;
    const doc = new DOMParser().parseFromString(captionXml, "text/xml");
    const texts = Array.from(doc.getElementsByTagName("text"));
    const lines = texts.map((t) => {
      var _a2;
      return ((_a2 = t.textContent) != null ? _a2 : "").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    }).filter(Boolean);
    return lines.join(" ").trim() || null;
  } catch (e) {
    return null;
  }
}
var TRANSCRIPT_MIN_LENGTH = 2e3;
var TRANSCRIPT_MAX_LENGTH = 5e4;
function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n...(truncated)";
}
function extractTextFromHtml(html) {
  const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}
async function extractTranscript(episode) {
  if (episode.contentEncoded) {
    const text = extractTextFromHtml(episode.contentEncoded);
    if (text.length >= TRANSCRIPT_MIN_LENGTH) {
      return truncate(text, TRANSCRIPT_MAX_LENGTH);
    }
  }
  const ytId = extractYouTubeId(episode.link) || extractYouTubeId(episode.audioUrl);
  if (ytId) {
    const transcript = await fetchYouTubeTranscript(ytId);
    if (transcript && transcript.length >= TRANSCRIPT_MIN_LENGTH) {
      return truncate(transcript, TRANSCRIPT_MAX_LENGTH);
    }
  }
  if (episode.description) {
    return truncate(episode.description, TRANSCRIPT_MAX_LENGTH);
  }
  return "(No transcript available)";
}
async function searchITunes(query, limit = 10) {
  var _a;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&limit=${limit}`;
  const resp = await (0, import_obsidian.requestUrl)({ url });
  const data = resp.json;
  return ((_a = data.results) != null ? _a : []).filter((r) => r.feedUrl);
}
var PodcastTools = class {
  async execute(name, input) {
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
  async podcastSearch(input) {
    const query = input.query;
    if (!query) return "Error: query is required";
    try {
      const results = await searchITunes(query, input.limit || 10);
      if (results.length === 0) return "No podcasts found.";
      return results.map(
        (r) => `**${r.collectionName}**
By: ${r.artistName}
Feed: ${r.feedUrl}
ID: ${r.collectionId}`
      ).join("\n\n");
    } catch (e) {
      return `Error searching podcasts: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  async podcastEpisodes(input) {
    const url = input.url;
    if (!url) return "Error: url (RSS feed URL) is required";
    const limit = input.limit || 5;
    try {
      const episodes = await fetchPodcastRss(url, "");
      const recent = episodes.slice(0, limit);
      if (recent.length === 0) return "No episodes found.";
      return recent.map((ep) => {
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
      }).join("\n\n---\n\n");
    } catch (e) {
      return `Error fetching episodes: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  async podcastTranscript(input) {
    var _a;
    const url = input.url;
    if (!url) return "Error: url is required (RSS feed URL of the podcast)";
    const episodeIndex = (_a = input.episode_index) != null ? _a : 0;
    try {
      const ytId = extractYouTubeId(url);
      if (ytId) {
        const transcript2 = await fetchYouTubeTranscript(ytId);
        return transcript2 ? truncate(transcript2, TRANSCRIPT_MAX_LENGTH) : "(YouTube transcript not available for this video)";
      }
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
        "---"
      ].filter(Boolean).join("\n");
      return `${header}

${transcript}`;
    } catch (e) {
      return `Error fetching transcript: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
};

// src/feeds.ts
var DEFAULT_FEEDS = [
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
    type: "hn"
  },
  {
    name: "HN Best of Week",
    url: "hn-weekly",
    category: "community",
    type: "hn"
  },
  {
    name: "Reddit r/MachineLearning",
    url: "https://www.reddit.com/r/MachineLearning/hot.json?limit=25",
    category: "community",
    type: "reddit"
  },
  {
    name: "Reddit r/MachineLearning Top/Week",
    url: "https://www.reddit.com/r/MachineLearning/top.json?t=week&limit=15",
    category: "community",
    type: "reddit"
  },
  {
    name: "Reddit r/LocalLLaMA",
    url: "https://www.reddit.com/r/LocalLLaMA/hot.json?limit=25",
    category: "community",
    type: "reddit"
  },
  {
    name: "Reddit r/LocalLLaMA Top/Week",
    url: "https://www.reddit.com/r/LocalLLaMA/top.json?t=week&limit=15",
    category: "community",
    type: "reddit"
  },
  // GitHub Trending
  {
    name: "GitHub Trending",
    url: "https://github.com/trending?since=daily&spoken_language_code=en",
    category: "tools",
    type: "github-trending"
  },
  {
    name: "GitHub Trending Weekly",
    url: "https://github.com/trending?since=weekly&spoken_language_code=en",
    category: "tools",
    type: "github-trending"
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
  { name: "80,000 Hours", url: "https://feeds.feedburner.com/80aboradiostinp", category: "podcast", type: "podcast" }
];
var CATEGORY_WEIGHT = {
  research: 1,
  engineering: 2,
  tools: 1.5,
  community: 1.8,
  podcast: 1.5,
  newsletter: 1,
  news: 0.5,
  industry: 0.8
};
var AI_KEYWORDS = new RegExp(
  "\\b(ai|artificial.intelligence|machine.learning|deep.learning|neural.net|llm|large.language.model|gpt|claude|gemini|llama|mistral|transformer|attention.mechanism|fine.tun|rlhf|rag|agent|agentic|autonomous|multi.agent|tool.use|diffusion|generative|gan|vae|stable.diffusion|midjourney|dall-e|embedding|vector.database|prompt.engineer|openai|anthropic|google.deepmind|meta.ai|hugging.face|mlops|model.serving|inference|quantiz|distill|computer.vision|nlp|natural.language|speech.recognition|reinforcement.learning|reward.model|mcp|model.context.protocol)\\b",
  "gi"
);
var TECH_DEPTH = new RegExp(
  "\\b(benchmark|ablation|sota|state.of.the.art|open.source|github|architecture|implementation|training|dataset|evaluation|framework|library|api|sdk|tutorial|how.to|code|production|deploy|scale|infra|pipeline|latency|throughput|lesson.learned|postmortem|case.study|best.practice|real.world|engineering|system.design|migration|optimization|monitoring)\\b",
  "gi"
);
var HOT_TOPICS = /* @__PURE__ */ new Set([
  "agent",
  "agentic",
  "llm",
  "rag",
  "mcp",
  "tool.use"
]);
function stripHtml2(text) {
  return text.replace(/<[^>]+>/g, "").trim();
}
function parseDate2(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}
function parseXml(xml) {
  return new DOMParser().parseFromString(xml, "text/xml");
}
function getTextContent2(el, tag, ns) {
  var _a, _b, _c, _d;
  let child;
  if (ns) {
    child = (_a = el.getElementsByTagNameNS(ns, tag)[0]) != null ? _a : null;
  } else {
    child = (_b = el.getElementsByTagName(tag)[0]) != null ? _b : null;
  }
  return (_d = (_c = child == null ? void 0 : child.textContent) == null ? void 0 : _c.trim()) != null ? _d : "";
}
async function fetchRssFeed(feed) {
  var _a;
  const articles = [];
  let data;
  try {
    const resp = await (0, import_obsidian2.requestUrl)({
      url: feed.url,
      headers: { "User-Agent": "obsidian-ai-daily/0.1" }
    });
    data = resp.text;
  } catch (e) {
    return articles;
  }
  let doc;
  try {
    doc = parseXml(data);
  } catch (e) {
    return articles;
  }
  const ATOM_NS = "http://www.w3.org/2005/Atom";
  for (const item of Array.from(doc.getElementsByTagName("item"))) {
    const title = getTextContent2(item, "title");
    const link = getTextContent2(item, "link");
    const desc = stripHtml2(getTextContent2(item, "description"));
    const pubDate = parseDate2(getTextContent2(item, "pubDate"));
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
        commentCount: 0
      });
    }
  }
  for (const entry of Array.from(doc.getElementsByTagNameNS(ATOM_NS, "entry"))) {
    const title = getTextContent2(entry, "title", ATOM_NS);
    const linkEl = entry.getElementsByTagNameNS(ATOM_NS, "link")[0];
    const link = (_a = linkEl == null ? void 0 : linkEl.getAttribute("href")) != null ? _a : "";
    const summary = stripHtml2(
      getTextContent2(entry, "summary", ATOM_NS) || getTextContent2(entry, "content", ATOM_NS)
    );
    const pubDate = parseDate2(
      getTextContent2(entry, "updated", ATOM_NS) || getTextContent2(entry, "published", ATOM_NS)
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
        commentCount: 0
      });
    }
  }
  return articles;
}
function resolveHnUrl(feed) {
  if (feed.url === "hn-weekly") {
    const weekAgo = Math.floor(Date.now() / 1e3) - 7 * 86400;
    return `https://hn.algolia.com/api/v1/search?tags=story&query=AI+LLM+GPT+agent+Claude+machine+learning&hitsPerPage=20&numericFilters=points>100,created_at_i>${weekAgo}`;
  }
  return feed.url;
}
async function fetchHnFeed(feed) {
  var _a, _b, _c, _d, _e;
  const articles = [];
  try {
    const resp = await (0, import_obsidian2.requestUrl)({
      url: resolveHnUrl(feed),
      headers: { "User-Agent": "obsidian-ai-daily/0.1" }
    });
    const data = resp.json;
    for (const hit of (_a = data.hits) != null ? _a : []) {
      const title = (_b = hit.title) != null ? _b : "";
      const url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      if (!title) continue;
      articles.push({
        title,
        url,
        source: feed.name,
        category: feed.category,
        published: parseDate2((_c = hit.created_at) != null ? _c : ""),
        summary: (hit.story_text ? stripHtml2(hit.story_text) : "").slice(0, 500),
        relevanceScore: 0,
        socialScore: (_d = hit.points) != null ? _d : 0,
        commentCount: (_e = hit.num_comments) != null ? _e : 0
      });
    }
  } catch (e) {
  }
  return articles;
}
async function fetchRedditFeed(feed) {
  var _a, _b, _c, _d, _e, _f;
  const articles = [];
  try {
    const resp = await (0, import_obsidian2.requestUrl)({
      url: feed.url,
      headers: { "User-Agent": "obsidian-ai-daily/0.1" }
    });
    const data = resp.json;
    for (const child of (_b = (_a = data == null ? void 0 : data.data) == null ? void 0 : _a.children) != null ? _b : []) {
      const post = child.data;
      if (!post || post.stickied) continue;
      const title = (_c = post.title) != null ? _c : "";
      const url = post.url || `https://reddit.com${post.permalink}`;
      if (!title) continue;
      articles.push({
        title,
        url,
        source: feed.name,
        category: feed.category,
        published: post.created_utc ? new Date(post.created_utc * 1e3) : null,
        summary: ((_d = post.selftext) != null ? _d : "").slice(0, 500),
        relevanceScore: 0,
        socialScore: (_e = post.ups) != null ? _e : 0,
        commentCount: (_f = post.num_comments) != null ? _f : 0
      });
    }
  } catch (e) {
  }
  return articles;
}
async function fetchGithubTrending(feed) {
  const articles = [];
  try {
    const resp = await (0, import_obsidian2.requestUrl)({
      url: feed.url,
      headers: { "User-Agent": "obsidian-ai-daily/0.1" }
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
      const repoName = stripHtml2(repoMatches[i][2]).replace(/\s+/g, "").trim();
      const desc = descMatches[i] ? stripHtml2(descMatches[i][1]).trim() : "";
      const starsToday = starsMatches[i] ? parseInt(starsMatches[i][1].replace(/,/g, ""), 10) : 0;
      if (!repoName) continue;
      articles.push({
        title: `${repoName}: ${desc}`.slice(0, 200),
        url: `https://github.com${repoPath}`,
        source: feed.name,
        category: feed.category,
        published: /* @__PURE__ */ new Date(),
        summary: desc.slice(0, 500),
        relevanceScore: 0,
        socialScore: starsToday,
        commentCount: 0
      });
    }
  } catch (e) {
  }
  return articles;
}
async function fetchPodcastFeed(feed) {
  try {
    const episodes = await fetchPodcastRss(feed.url, feed.name);
    return episodes.slice(0, 1).map((ep) => {
      const durationStr = ep.duration ? ` (${Math.floor(ep.duration / 60)} min)` : "";
      const epNum = ep.episodeNumber ? ` #${ep.episodeNumber}` : "";
      return {
        title: `\u{1F399}\uFE0F ${ep.title}${epNum}${durationStr}`,
        url: ep.link || ep.audioUrl,
        source: feed.name,
        category: feed.category,
        published: ep.published,
        summary: ep.description.slice(0, 500),
        relevanceScore: 0,
        socialScore: 0,
        commentCount: 0
      };
    });
  } catch (e) {
    console.warn(`[ai-daily] podcast fetch failed: ${feed.name}`, e);
    return [];
  }
}
async function fetchFeed(feed) {
  var _a;
  const type = (_a = feed.type) != null ? _a : "rss";
  switch (type) {
    case "hn":
      return fetchHnFeed(feed);
    case "reddit":
      return fetchRedditFeed(feed);
    case "github-trending":
      return fetchGithubTrending(feed);
    case "podcast":
      return fetchPodcastFeed(feed);
    default:
      return fetchRssFeed(feed);
  }
}
function timeDecay(published, engagement = 0) {
  if (!published) return 0.6;
  const hoursAgo = (Date.now() - published.getTime()) / (1e3 * 60 * 60);
  if (hoursAgo <= 12) return 1.5;
  if (hoursAgo <= 24) return 1.3;
  if (hoursAgo <= 48) return 1;
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
function socialBoost(article) {
  const { socialScore, commentCount } = article;
  if (socialScore === 0 && commentCount === 0) return 1;
  const engagement = socialScore + commentCount * 2;
  if (engagement >= 500) return 2.5;
  if (engagement >= 200) return 2;
  if (engagement >= 100) return 1.6;
  if (engagement >= 50) return 1.3;
  if (engagement >= 20) return 1.1;
  return 1;
}
function detectBursts(articles) {
  var _a;
  const topicSourceCount = /* @__PURE__ */ new Map();
  for (const article of articles) {
    const text = `${article.title} ${article.summary}`.toLowerCase();
    const matches = (_a = text.match(AI_KEYWORDS)) != null ? _a : [];
    const unique = new Set(matches.map((m) => m.toLowerCase()));
    for (const keyword of unique) {
      if (!topicSourceCount.has(keyword)) {
        topicSourceCount.set(keyword, /* @__PURE__ */ new Set());
      }
      topicSourceCount.get(keyword).add(article.source);
    }
  }
  const burstTopics = /* @__PURE__ */ new Map();
  for (const [keyword, sources] of topicSourceCount) {
    if (sources.size >= 3) {
      burstTopics.set(keyword, 1.5 + (sources.size - 3) * 0.2);
    }
  }
  return burstTopics;
}
function scoreRelevance(article, userTopics, burstTopics) {
  var _a, _b, _c, _d;
  const text = `${article.title} ${article.summary}`.toLowerCase();
  const matches = (_a = text.match(AI_KEYWORDS)) != null ? _a : [];
  const unique = new Set(matches.map((m) => m.toLowerCase()));
  const titleMatches = (_b = article.title.toLowerCase().match(AI_KEYWORDS)) != null ? _b : [];
  const titleUnique = new Set(titleMatches.map((m) => m.toLowerCase()));
  const podcastBase = article.category === "podcast" ? 2 : 0;
  let score = unique.size * 1 + titleUnique.size * 2 + podcastBase;
  for (const topic of unique) {
    if (HOT_TOPICS.has(topic)) {
      score *= 1.5;
      break;
    }
  }
  const depthMatches = (_c = text.match(TECH_DEPTH)) != null ? _c : [];
  const depthUnique = new Set(depthMatches.map((m) => m.toLowerCase()));
  score += depthUnique.size * 0.5;
  score *= (_d = CATEGORY_WEIGHT[article.category]) != null ? _d : 1;
  if (userTopics.length > 0) {
    const lowerTopics = userTopics.map((t) => t.toLowerCase());
    for (const topic of lowerTopics) {
      if (text.includes(topic)) {
        score *= 2;
        break;
      }
    }
  }
  score *= socialBoost(article);
  const engagement = article.socialScore + article.commentCount * 2;
  score *= timeDecay(article.published, engagement);
  let maxBurst = 1;
  for (const keyword of unique) {
    const burst = burstTopics.get(keyword);
    if (burst && burst > maxBurst) {
      maxBurst = burst;
    }
  }
  score *= maxBurst;
  return Math.round(score * 10) / 10;
}
async function fetchAllFeeds(options = {}) {
  const {
    feeds = DEFAULT_FEEDS,
    userTopics = [],
    minScore = 1,
    maxArticles = 20,
    onProgress
  } = options;
  onProgress == null ? void 0 : onProgress(`\u6B63\u5728\u5E76\u53D1\u6293\u53D6 ${feeds.length} \u4E2A\u6E90...`);
  const results = await Promise.allSettled(
    feeds.map((feed) => fetchFeed(feed))
  );
  const allArticles = [];
  const failedSources = [];
  for (let i = 0; i < results.length; i++) {
    const result2 = results[i];
    if (result2.status === "fulfilled") {
      allArticles.push(...result2.value);
    } else {
      failedSources.push(feeds[i].name);
      console.warn(`[ai-daily] feed fetch failed: ${feeds[i].name}`, result2.reason);
    }
  }
  if (failedSources.length > 0) {
    onProgress == null ? void 0 : onProgress(`\u26A0\uFE0F ${failedSources.length} \u4E2A\u6E90\u6293\u53D6\u5931\u8D25: ${failedSources.join(", ")}`);
  }
  onProgress == null ? void 0 : onProgress(`\u5171\u6293\u53D6 ${allArticles.length} \u7BC7\u6587\u7AE0\uFF0C\u6B63\u5728\u8BC4\u5206\u7B5B\u9009...`);
  const burstTopics = detectBursts(allArticles);
  if (burstTopics.size > 0) {
    const burstNames = [...burstTopics.keys()].slice(0, 5).join(", ");
    onProgress == null ? void 0 : onProgress(`\u{1F525} \u68C0\u6D4B\u5230\u70ED\u70B9\u8BDD\u9898: ${burstNames}`);
  }
  for (const article of allArticles) {
    article.relevanceScore = scoreRelevance(article, userTopics, burstTopics);
  }
  const filtered = allArticles.filter((a) => a.relevanceScore >= minScore);
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const a of filtered) {
    if (!seen.has(a.url)) {
      seen.add(a.url);
      unique.push(a);
    }
  }
  const sortByRelevance = (a, b) => {
    var _a, _b, _c, _d;
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    const dateA = (_b = (_a = a.published) == null ? void 0 : _a.getTime()) != null ? _b : 0;
    const dateB = (_d = (_c = b.published) == null ? void 0 : _c.getTime()) != null ? _d : 0;
    return dateB - dateA;
  };
  const podcasts = unique.filter((a) => a.category === "podcast");
  const nonPodcasts = unique.filter((a) => a.category !== "podcast");
  nonPodcasts.sort(sortByRelevance);
  const bestPerSource = /* @__PURE__ */ new Map();
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
    ...diversePodcasts.slice(0, podcastSlots)
  ];
  result.sort(sortByRelevance);
  return result.slice(0, maxArticles);
}

// src/vault-guide.ts
var GUIDE_FOLDER = "_cortex-guide";
function getGuideFolderPath() {
  return GUIDE_FOLDER;
}
function generateGuideFiles(settings) {
  const {
    knowledgeFolders,
    chatHistoryFolder,
    autoTagFolders,
    distillTargetFolder,
    harnessProjectsFolder,
    harnessInboxFile,
    enableAutoTagging,
    enablePodcast,
    enableWeRead
  } = settings;
  const sourceFolder = autoTagFolders[0] || knowledgeFolders[0] || "Raw";
  const wikiFolder = distillTargetFolder || "Wiki";
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const files = [];
  files.push({
    path: `${GUIDE_FOLDER}/README.md`,
    content: `# Cortex Vault \u53C2\u8003\u6A21\u677F

> **\u672C\u6587\u4EF6\u5939\u7531 Cortex \u63D2\u4EF6\u6839\u636E\u5F53\u524D\u8BBE\u7F6E\u81EA\u52A8\u751F\u6210\uFF08${today}\uFF09\u3002**

## \u8FD9\u662F\u4EC0\u4E48\uFF1F

Cortex \u63D2\u4EF6\u4F9D\u8D56 vault \u4E2D\u7684\u7279\u5B9A\u6587\u4EF6\u548C\u683C\u5F0F\u6765\u9A71\u52A8 AI \u529F\u80FD\u3002
\u672C\u6587\u4EF6\u5939\u63D0\u4F9B**\u53C2\u8003\u6A21\u677F**\uFF0C\u5E2E\u52A9\u4F60\uFF08\u6216 AI agent\uFF09\u5FEB\u901F\u642D\u5EFA\u6B63\u786E\u7684\u7ED3\u6784\u3002

**\u91CD\u8981\uFF1A\u8FD9\u4E9B\u6587\u4EF6\u4E0D\u4F1A\u81EA\u52A8\u751F\u6548\u3002** \u4F60\u9700\u8981\u5C06\u5B83\u4EEC\u590D\u5236\u5230\u6B63\u786E\u4F4D\u7F6E\u3002
\u6BCF\u4E2A\u6587\u4EF6\u5185\u90E8\u90FD\u6709\u8BE6\u7EC6\u6CE8\u91CA\u8BF4\u660E\u683C\u5F0F\u8981\u6C42\u548C\u53EF\u81EA\u5B9A\u4E49\u7684\u90E8\u5206\u3002

## \u4FEE\u6539\u8BBE\u7F6E\u540E\u8BF7\u91CD\u65B0\u751F\u6210

\u6240\u6709\u8DEF\u5F84\u90FD\u6765\u81EA**\u751F\u6210\u65F6\u7684\u63D2\u4EF6\u8BBE\u7F6E**\u3002\u5982\u679C\u4F60\u4FEE\u6539\u4E86\u8BBE\u7F6E\u4E2D\u7684\u6587\u4EF6\u5939\u540D\u79F0\uFF0C
\u8BF7\u5230\u8BBE\u7F6E\u9875\u91CD\u65B0\u70B9\u51FB\u300C\u751F\u6210\u6A21\u677F\u300D\u6309\u94AE\uFF0C\u5426\u5219\u6A21\u677F\u4E2D\u7684\u8DEF\u5F84\u4F1A\u4E0E\u5B9E\u9645\u8BBE\u7F6E\u4E0D\u5339\u914D\u3002

## \u5F53\u524D\u8BBE\u7F6E\u6458\u8981

| \u914D\u7F6E\u9879 | \u5F53\u524D\u503C |
|--------|--------|
| \u77E5\u8BC6\u5E93\u6587\u4EF6\u5939 | \`${knowledgeFolders.join("`, `")}\` |
| \u5BF9\u8BDD\u5B58\u6863 | \`${chatHistoryFolder}\` |
| \u81EA\u52A8\u6807\u6CE8\u6587\u4EF6\u5939 | \`${autoTagFolders.join("`, `")}\` |
| \u84B8\u998F\u76EE\u6807 | \`${wikiFolder}\` |
| \u9879\u76EE\u6587\u4EF6\u5939 | \`${harnessProjectsFolder}\` |
| Inbox \u6587\u4EF6 | \`${harnessInboxFile}\` |
| \u81EA\u52A8\u6807\u6CE8 | ${enableAutoTagging ? "\u5F00\u542F" : "\u5173\u95ED"} |
| \u64AD\u5BA2\u5DE5\u5177 | ${enablePodcast ? "\u5F00\u542F" : "\u5173\u95ED"} |
| \u5FAE\u4FE1\u8BFB\u4E66 | ${enableWeRead ? "\u5F00\u542F" : "\u5173\u95ED"} |

## \u6587\u4EF6\u5217\u8868

| \u6A21\u677F\u6587\u4EF6 | \u590D\u5236\u5230 | \u8BF4\u660E |
|----------|--------|------|
| \`CLAUDE.md\` | vault \u6839\u76EE\u5F55 | \u5171\u4EAB agent \u6307\u5357\uFF08Claude Code/Codex \u5747\u4F7F\u7528\uFF0C\u5168\u6587\u53EF\u81EA\u7531\u4FEE\u6539\uFF09 |
| \`AGENTS.md\` | vault \u6839\u76EE\u5F55 | Codex \u81EA\u52A8\u53D1\u73B0\u5165\u53E3\uFF0C\u6307\u5411 \`CLAUDE.md\` |
| \`_INDEX.md\` | \`${harnessProjectsFolder}/_INDEX.md\` | \u9879\u76EE\u7D22\u5F15\uFF08**\u683C\u5F0F\u6709\u4E25\u683C\u8981\u6C42**\uFF0C\u89C1\u6587\u4EF6\u5185\u6CE8\u91CA\uFF09 |
| \`modes.md\` | \`${harnessProjectsFolder}/{\u9879\u76EE\u540D}/modes.md\` | \u6A21\u5F0F\u5B9A\u4E49\uFF08**YAML \u5757\u683C\u5F0F\u6709\u4E25\u683C\u8981\u6C42**\uFF09 |
| \`PROGRESS.md\` | \`${harnessProjectsFolder}/{\u9879\u76EE\u540D}/PROGRESS.md\` | \u9879\u76EE\u8FDB\u5C55\uFF08\u683C\u5F0F\u5F71\u54CD\u72B6\u6001\u680F\u663E\u793A\uFF09 |
| \`inbox.md\` | \`${harnessInboxFile}\` | Inbox \u5F85\u529E\uFF08\u683C\u5F0F\u5F71\u54CD\u5F85\u529E\u8BA1\u6570\uFF09 |
`
  });
  files.push({
    path: `${GUIDE_FOLDER}/CLAUDE.md`,
    content: `# Vault \u89C4\u8303 \u2014 Cortex AI \u77E5\u8BC6\u7BA1\u7406

<!--
  \u4F7F\u7528\u8BF4\u660E\uFF1A
  - \u5C06\u672C\u6587\u4EF6\u590D\u5236\u5230 vault \u6839\u76EE\u5F55\uFF0C\u547D\u540D\u4E3A CLAUDE.md
  - Claude Code agent \u4F1A\u81EA\u52A8\u8BFB\u53D6\u6B64\u6587\u4EF6\uFF1BCodex \u901A\u8FC7 AGENTS.md \u5165\u53E3\u8BFB\u53D6\u540C\u4E00\u4EFD\u89C4\u8303
  - \u672C\u6587\u4EF6\u7684\u5185\u5BB9\u5168\u90E8\u53EF\u4EE5\u81EA\u7531\u4FEE\u6539\uFF0C\u5B83\u662F\u6307\u5BFC AI \u7684 prompt\uFF0C\u4E0D\u662F\u4EE3\u7801\u4F9D\u8D56
  - \u4F46\u8BF7\u6CE8\u610F\uFF1A\u4E0B\u65B9\u63D0\u5230\u7684 frontmatter \u5B57\u6BB5\u540D\u548C\u683C\u5F0F\u662F\u4EE3\u7801\u786C\u4F9D\u8D56\u7684\uFF0C\u4E0D\u53EF\u968F\u610F\u6539\u540D

  \u672C\u6587\u4EF6\u6839\u636E\u5F53\u524D Cortex \u63D2\u4EF6\u8BBE\u7F6E\u751F\u6210\uFF08${today}\uFF09\u3002
-->

## \u6587\u4EF6\u5939\u7ED3\u6784

| \u6587\u4EF6\u5939 | \u7528\u9014 | \u8BF4\u660E |
|--------|------|------|
| \`${sourceFolder}/\` | \u539F\u59CB\u7D20\u6750 | \u6587\u7AE0\u3001\u7B14\u8BB0\u3001\u7F51\u9875\u526A\u85CF\u7B49\u672A\u6574\u7406\u7684\u5185\u5BB9 |
| \`${wikiFolder}/\` | \u77E5\u8BC6\u6761\u76EE | \u6574\u7406\u540E\u7684\u7ED3\u6784\u5316\u77E5\u8BC6 |
| \`Feed/\` | \u8D44\u8BAF Feed | AI \u751F\u6210\u7684\u8D44\u8BAF\uFF0C\u6587\u4EF6\u540D\u683C\u5F0F \`Feed-YYYY-MM-DD.md\` |
| \`${harnessProjectsFolder}/\` | \u9879\u76EE\u914D\u7F6E | Harness \u6A21\u5F0F\u7CFB\u7EDF\u914D\u7F6E\uFF08\u89C1 _INDEX.md \u548C modes.md \u6A21\u677F\uFF09 |
| \`${chatHistoryFolder}/\` | \u5BF9\u8BDD\u5B58\u6863 | \u81EA\u52A8\u7BA1\u7406\uFF0C\u65E0\u9700\u624B\u52A8\u64CD\u4F5C |

## Frontmatter \u89C4\u8303\uFF08\u4EE3\u7801\u5F3A\u4F9D\u8D56\uFF09

<!--
  \u26A0\uFE0F \u91CD\u8981\uFF1A\u4EE5\u4E0B\u5B57\u6BB5\u540D\u662F\u4EE3\u7801\u786C\u7F16\u7801\u7684\uFF0C\u4FEE\u6539\u5B57\u6BB5\u540D\u4F1A\u5BFC\u81F4\u529F\u80FD\u5F02\u5E38\u3002
  \u5B57\u6BB5\u7684\u503C\u53EF\u4EE5\u81EA\u5B9A\u4E49\uFF0C\u4F46\u540D\u79F0\u548C\u7C7B\u578B\u5FC5\u987B\u4E25\u683C\u9075\u5FAA\u3002
-->

Cortex \u7684\u591A\u4E2A\u529F\u80FD\u4F9D\u8D56\u7B14\u8BB0\u5F00\u5934\u7684 YAML frontmatter\u3002\u683C\u5F0F\u8981\u6C42\uFF1A

\`\`\`yaml
---
tags: [\u6807\u7B7E1, \u6807\u7B7E2]              # \u7C7B\u578B\uFF1A\u6570\u7EC4 \u6216 \u9017\u53F7\u5206\u9694\u5B57\u7B26\u4E32
summary: \u4E00\u53E5\u8BDD\u6458\u8981               # \u7C7B\u578B\uFF1A\u5B57\u7B26\u4E32
organized: true                   # \u7C7B\u578B\uFF1A\u5E03\u5C14\u503C\uFF08true/false\uFF09
auto-tagged: true                 # \u7C7B\u578B\uFF1A\u5E03\u5C14\u503C
type: note                        # \u7C7B\u578B\uFF1A\u5B57\u7B26\u4E32
date: ${today}                    # \u7C7B\u578B\uFF1A\u5B57\u7B26\u4E32 YYYY-MM-DD
---
\`\`\`

### \u5404\u5B57\u6BB5\u8BE6\u89E3

| \u5B57\u6BB5 | \u8C01\u4F7F\u7528 | \u8BF4\u660E |
|------|--------|------|
| \`tags\` | \u81EA\u52A8\u6807\u6CE8\u3001\u77E5\u8BC6\u6574\u7406\u3001\u5065\u5EB7\u68C0\u67E5 | **\u6570\u7EC4\u683C\u5F0F**\u5982 \`[ai, rag]\` \u6216**\u9017\u53F7\u5B57\u7B26\u4E32**\u5982 \`ai, rag\`\uFF0C\u4E24\u79CD\u90FD\u652F\u6301\u3002\u5C0F\u5199\uFF0C\u53BB\u6389 \`#\` \u524D\u7F00\u3002\u5065\u5EB7\u68C0\u67E5\u4F1A\u62A5\u544A\u7F3A\u5C11 tags \u7684\u7B14\u8BB0 |
| \`summary\` | \u81EA\u52A8\u6807\u6CE8\u3001\u5065\u5EB7\u68C0\u67E5 | \u4E00\u53E5\u8BDD\u6458\u8981\u3002\u5065\u5EB7\u68C0\u67E5\u4F1A\u62A5\u544A\u7F3A\u5C11 summary \u7684\u7B14\u8BB0 |
| \`organized\` | \u77E5\u8BC6\u6574\u7406 | \u5FC5\u987B\u662F**\u5E03\u5C14\u503C \`true\`**\uFF08\u4E0D\u662F\u5B57\u7B26\u4E32 "true"\uFF09\u3002\u6807\u8BB0\u4E3A true \u7684\u7B14\u8BB0\u4F1A\u88AB\u300C\u6574\u7406\u77E5\u8BC6\u5E93\u300D\u547D\u4EE4\u8DF3\u8FC7 |
| \`auto-tagged\` | \u81EA\u52A8\u6807\u6CE8 | \u5E03\u5C14\u503C\u3002\u5DF2\u6807\u6CE8\u7684\u7B14\u8BB0\u4E0D\u4F1A\u88AB\u91CD\u590D\u6807\u6CE8\u3002\u6B64\u5B57\u6BB5\u7531\u63D2\u4EF6\u81EA\u52A8\u5199\u5165 |
| \`type\` | Feed \u751F\u6210 | Feed \u7B14\u8BB0\u7528 \`feed\`\uFF0C\u64AD\u5BA2 Feed \u7528 \`podcast-feed\` |
| \`date\` | Feed \u751F\u6210 | \`YYYY-MM-DD\` \u683C\u5F0F |

### Frontmatter \u683C\u5F0F\u9650\u5236

\u63D2\u4EF6\u7684 frontmatter \u89E3\u6790\u5668\u662F\u7B80\u5316\u7248 YAML\uFF0C\u6709\u4EE5\u4E0B\u9650\u5236\uFF1A
- **\u4EC5\u652F\u6301\u5355\u884C\u952E\u503C\u5BF9** \u2014 \u5982 \`key: value\`\u3002\u4E0D\u652F\u6301\u591A\u884C\u503C\u3001\u5D4C\u5957\u5BF9\u8C61
- **\u6570\u7EC4** \u2014 \u53EA\u652F\u6301\u5355\u884C\u683C\u5F0F \`[a, b, c]\`\uFF0C\u4E0D\u652F\u6301\u591A\u884C \`-\` \u5217\u8868\u683C\u5F0F
- **\u5E03\u5C14\u503C** \u2014 \`true\` \u548C \`false\` \u4F1A\u81EA\u52A8\u8F6C\u4E3A\u5E03\u5C14\u7C7B\u578B
- **\u6570\u5B57** \u2014 \u7EAF\u6570\u5B57\u5B57\u7B26\u4E32\u4F1A\u81EA\u52A8\u8F6C\u4E3A\u6570\u5B57\u7C7B\u578B

\u4F60\u4E5F\u53EF\u4EE5\u6DFB\u52A0\u81EA\u5B9A\u4E49\u5B57\u6BB5\uFF0C\u63D2\u4EF6\u4F1A\u5FFD\u7565\u4E0D\u8BA4\u8BC6\u7684\u5B57\u6BB5\u3002

## Wiki \u6761\u76EE\u5199\u4F5C\u89C4\u8303

\`${wikiFolder}/\` \u4E2D\u7684\u6761\u76EE\u5EFA\u8BAE\u9075\u5FAA\uFF1A

1. **\u6587\u4EF6\u540D\u5373\u6982\u5FF5\u540D** \u2014 \u5982 \`RAG.md\`\u3001\`Transformer.md\`
2. **\u5F00\u5934\u4E00\u53E5\u8BDD\u5B9A\u4E49** \u2014 \u5FEB\u901F\u8BF4\u660E\u8FD9\u4E2A\u6982\u5FF5\u662F\u4EC0\u4E48
3. **\u4F7F\u7528 [[wiki-link]]** \u2014 \u7528 \`[[\u6761\u76EE\u540D]]\` \u94FE\u63A5\u76F8\u5173\u6982\u5FF5
4. **\u590D\u7528\u5DF2\u6709 tags** \u2014 \u4F18\u5148\u4F7F\u7528 vault \u4E2D\u5DF2\u6709\u7684\u6807\u7B7E
5. **\u5B50\u6587\u4EF6\u5939** \u2014 \u53EF\u7528\u5B50\u6587\u4EF6\u5939\u5F52\u7C7B\uFF0C\u5982 \`${wikiFolder}/AI/\`

## \u53EF\u7528\u5DE5\u5177

### Vault \u64CD\u4F5C
${knowledgeFolders.length === 1 ? `\u8DEF\u5F84\u9ED8\u8BA4\u76F8\u5BF9\u77E5\u8BC6\u5E93\u6839\u76EE\u5F55 \`${knowledgeFolders[0]}/\`\uFF0C\u4F8B\u5982 \`Wiki/topic.md\`\uFF1B\u4E5F\u517C\u5BB9\u5B8C\u6574\u8DEF\u5F84 \`${knowledgeFolders[0]}/Wiki/topic.md\`\u3002
` : "\u8DEF\u5F84\u4F7F\u7528 vault \u76F8\u5BF9\u8DEF\u5F84\uFF1B\u914D\u7F6E\u4E86\u591A\u4E2A\u77E5\u8BC6\u5E93\u6587\u4EF6\u5939\u65F6\u8BF7\u663E\u5F0F\u5305\u542B\u5BF9\u5E94\u6587\u4EF6\u5939\u524D\u7F00\u3002\n"}
| \u5DE5\u5177 | \u529F\u80FD |
|------|------|
| \`read_note\` | \u8BFB\u53D6\u6307\u5B9A\u8DEF\u5F84\u7684\u7B14\u8BB0\u5168\u6587 |
| \`search_vault\` | \u5173\u952E\u8BCD\u641C\u7D22\uFF0C\u652F\u6301\u6309\u6587\u4EF6\u5939\u548C\u6807\u7B7E\u8FC7\u6EE4 |
| \`list_notes\` | \u5217\u51FA\u6587\u4EF6\u5939\u4E2D\u7684\u7B14\u8BB0\uFF08\u6309\u4FEE\u6539\u65F6\u95F4\u6392\u5E8F\uFF09 |
| \`create_note\` | \u521B\u5EFA\u65B0\u7B14\u8BB0\uFF08\u53EF\u542B frontmatter\uFF09 |
| \`edit_note\` | \u7F16\u8F91\u7B14\u8BB0\uFF08\u652F\u6301\u6309 heading \u5B9A\u4F4D\u6BB5\u843D\uFF09 |
| \`append_to_note\` | \u5728\u7B14\u8BB0\u672B\u5C3E\u8FFD\u52A0\u5185\u5BB9 |
| \`rename_note\` | \u91CD\u547D\u540D/\u79FB\u52A8\u7B14\u8BB0 |
| \`delete_note\` | \u5220\u9664\u7B14\u8BB0 |
| \`update_frontmatter\` | \u4FEE\u6539 YAML frontmatter\uFF08set \u548C delete \u64CD\u4F5C\uFF09 |
| \`get_links\` | \u83B7\u53D6\u53CD\u5411\u94FE\u63A5\u548C\u6B63\u5411\u94FE\u63A5 |

### \u8D44\u8BAF\u83B7\u53D6
| \u5DE5\u5177 | \u529F\u80FD |
|------|------|
| \`fetch_feeds\` | \u4ECE\u914D\u7F6E\u7684\u8BA2\u9605\u6E90\u6279\u91CF\u6293\u53D6\uFF0C\u81EA\u52A8\u8BC4\u5206\u6392\u5E8F |
| \`fetch_rss\` | \u6293\u53D6\u4EFB\u610F RSS/Atom feed URL |
| \`web_search\` | \u8054\u7F51\u641C\u7D22 |
| \`web_fetch\` | \u6293\u53D6\u7F51\u9875\u5185\u5BB9 |
${enablePodcast ? "| `podcast_search` | \u641C\u7D22\u64AD\u5BA2\uFF08iTunes API\uFF09 |\n| `podcast_episodes` | \u83B7\u53D6\u64AD\u5BA2\u6700\u65B0\u5267\u96C6 |\n| `podcast_transcript` | \u63D0\u53D6\u64AD\u5BA2\u6587\u5B57\u7A3F |\n" : ""}${enableWeRead ? "| `weread_api` | \u5FAE\u4FE1\u8BFB\u4E66 API |\n" : ""}
## \u56FE\u7247\u5F15\u7528\u683C\u5F0F

AI \u53EF\u4EE5\u8BC6\u522B\u7B14\u8BB0\u4E2D\u7684\u672C\u5730\u56FE\u7247\uFF0C\u652F\u6301\u4E24\u79CD\u683C\u5F0F\uFF1A
- Wikilink: \`![[photo.png]]\` \u6216 \`![[photo.png|alt text]]\`
- Markdown: \`![alt](attachments/photo.png)\`\uFF08\u4EC5\u672C\u5730\u8DEF\u5F84\uFF0CHTTP URL \u4E0D\u5904\u7406\uFF09

\u652F\u6301\u7684\u683C\u5F0F\uFF1Apng, jpg, jpeg, webp, gif\u3002

## Feed \u6587\u4EF6\u547D\u540D\u89C4\u5219

Feed \u529F\u80FD\u751F\u6210\u7684\u6587\u4EF6\u9075\u5FAA\u56FA\u5B9A\u547D\u540D\uFF1A
- \u8D44\u8BAF Feed: \`Feed/Feed-YYYY-MM-DD.md\`
- \u64AD\u5BA2 Feed: \`Feed/Podcast-YYYY-MM-DD.md\`

\u63D2\u4EF6\u901A\u8FC7\u8FD9\u4E2A\u547D\u540D\u89C4\u5219\u6765\u505A\u8DE8\u65E5\u53BB\u91CD\uFF08\u68C0\u67E5\u6700\u8FD1 3 \u5929\u7684 Feed \u5185\u5BB9\u907F\u514D\u91CD\u590D\u63A8\u8350\uFF09\u3002
\u5982\u679C\u4F60\u624B\u52A8\u521B\u5EFA Feed \u7B14\u8BB0\uFF0C\u5EFA\u8BAE\u4E5F\u9075\u5FAA\u8FD9\u4E2A\u547D\u540D\u683C\u5F0F\u3002
`
  });
  files.push({
    path: `${GUIDE_FOLDER}/AGENTS.md`,
    content: `# Cortex Vault \u2014 Codex \u5165\u53E3

\u672C vault \u7684 agent \u89C4\u8303\u5355\u4E00\u6765\u6E90\u662F \`CLAUDE.md\`\u3002

Codex \u5F00\u59CB\u5904\u7406 vault \u4EFB\u52A1\u524D\u5FC5\u987B\u5148\u9605\u8BFB\u6839\u76EE\u5F55 \`CLAUDE.md\`\uFF0C\u5E76\u9075\u5B88\u5176\u4E2D\u7684\u6587\u4EF6\u5939\u7ED3\u6784\u3001frontmatter\u3001Harness/Workspace \u548C\u5DE5\u5177\u4F7F\u7528\u89C4\u8303\u3002

\u7EF4\u62A4\u89C4\u5219\uFF1A
- \u4FEE\u6539 vault \u7EA7 agent \u6307\u4EE4\u65F6\uFF0C\u4F18\u5148\u66F4\u65B0 \`CLAUDE.md\`
- \`AGENTS.md\` \u53EA\u4F5C\u4E3A Codex \u81EA\u52A8\u53D1\u73B0\u5165\u53E3\uFF0C\u4FDD\u6301\u7B80\u77ED
- \u5982\u679C \`CLAUDE.md\` \u7684\u6587\u4EF6\u540D\u3001\u4F4D\u7F6E\u6216\u7EF4\u62A4\u7B56\u7565\u53D8\u5316\uFF0C\u5FC5\u987B\u540C\u6B65\u66F4\u65B0\u672C\u6587\u4EF6
`
  });
  files.push({
    path: `${GUIDE_FOLDER}/_INDEX.md`,
    content: `---
active_project: default
active_work_context: ""
---

<!--
  \u4F7F\u7528\u8BF4\u660E\uFF1A
  - \u5C06\u672C\u6587\u4EF6\u590D\u5236\u5230 ${harnessProjectsFolder}/_INDEX.md
  - \u63D2\u4EF6\u8BFB\u53D6\u6B64\u6587\u4EF6\u6765\u786E\u5B9A\u5F53\u524D\u6D3B\u8DC3\u9879\u76EE\u548C\u52A0\u8F7D\u5BF9\u5E94\u7684\u6A21\u5F0F

  \u26A0\uFE0F \u683C\u5F0F\u8981\u6C42\uFF08\u4EE3\u7801\u5F3A\u4F9D\u8D56\uFF0C\u4E0D\u53EF\u968F\u610F\u4FEE\u6539\u683C\u5F0F\uFF09\uFF1A

  \u3010Frontmatter \u5B57\u6BB5\u3011
  - active_project: \u5F53\u524D\u6D3B\u8DC3\u9879\u76EE\u7684\u6587\u4EF6\u5939\u540D\uFF08\u5FC5\u586B\uFF09
    \u5FC5\u987B\u4E0E ${harnessProjectsFolder}/ \u4E0B\u7684\u67D0\u4E2A\u5B50\u6587\u4EF6\u5939\u540D\u5B8C\u5168\u4E00\u81F4
    \u63D2\u4EF6\u4F1A\u53BB\u8BFB\u53D6 ${harnessProjectsFolder}/{active_project}/modes.md
    \u5207\u6362\u9879\u76EE\u65F6\uFF0C\u63D2\u4EF6\u4F1A\u7528\u6B63\u5219 ^(active_project:\\s*).*$ \u66FF\u6362\u6B64\u884C

  - active_work_context: \u5DE5\u4F5C\u4E0A\u4E0B\u6587\u6807\u8BC6\uFF08\u53EF\u9009\uFF0C\u53EF\u4E3A\u7A7A\u5B57\u7B26\u4E32\uFF09
    \u7528\u4E8E\u66FF\u6362 modes.md \u4E2D files \u8DEF\u5F84\u91CC\u7684 {active_work_context} \u53D8\u91CF
    \u4F8B\u5982\u67D0\u4E2A mode \u7684 files \u5305\u542B "Reports/{active_work_context}/data.md"\uFF0C
    \u800C active_work_context \u8BBE\u4E3A "Q2-2026"\uFF0C\u5219\u5B9E\u9645\u52A0\u8F7D "Reports/Q2-2026/data.md"

  \u3010\u6B63\u6587\u8868\u683C\u3011
  - \u5FC5\u987B\u662F\u7BA1\u9053\u7B26 | \u5206\u9694\u7684 Markdown \u8868\u683C
  - \u5FC5\u987B\u6709\u4E14\u4EC5\u6709 4 \u5217\uFF1A\u9879\u76EE | \u72B6\u6001 | \u6765\u6E90 | \u6700\u8FD1\u66F4\u65B0
  - \u7B2C\u4E00\u884C\u662F\u8868\u5934\uFF0C\u7B2C\u4E8C\u884C\u662F\u5206\u9694\u7EBF\uFF08|---|\uFF09\uFF0C\u4ECE\u7B2C\u4E09\u884C\u5F00\u59CB\u662F\u6570\u636E
  - \u300C\u9879\u76EE\u300D\u5217\u7684\u503C\u5E94\u4E0E ${harnessProjectsFolder}/ \u4E0B\u7684\u6587\u4EF6\u5939\u540D\u4E00\u81F4
  - \u300C\u72B6\u6001\u300D\u5217\uFF1A\u5982\u679C\u503C\u6070\u597D\u662F "active"\uFF0CHarness \u9762\u677F\u4E2D\u4F1A\u663E\u793A\u7EFF\u8272\u5706\u70B9
  - \u300C\u6765\u6E90\u300D\u5217\u548C\u300C\u6700\u8FD1\u66F4\u65B0\u300D\u5217\u53EF\u586B\u4EFB\u610F\u6587\u672C\uFF0C\u63D2\u4EF6\u53EA\u8BFB\u53D6\u4E0D\u89E3\u6790
  - \u53EF\u4EE5\u6DFB\u52A0\u4EFB\u610F\u591A\u884C\u9879\u76EE
-->

# \u9879\u76EE\u7D22\u5F15

| \u9879\u76EE | \u72B6\u6001 | \u6765\u6E90 | \u6700\u8FD1\u66F4\u65B0 |
|------|------|------|----------|
| default | active | \u2014 | ${today} |
`
  });
  files.push({
    path: `${GUIDE_FOLDER}/modes.md`,
    content: `<!--
  \u4F7F\u7528\u8BF4\u660E\uFF1A
  - \u5C06\u672C\u6587\u4EF6\u590D\u5236\u5230 ${harnessProjectsFolder}/{\u9879\u76EE\u540D}/modes.md
    \u4F8B\u5982\uFF1A${harnessProjectsFolder}/default/modes.md
  - \u63D2\u4EF6\u4F1A\u4ECE\u6B64\u6587\u4EF6\u52A0\u8F7D\u6A21\u5F0F\u6309\u94AE\u663E\u793A\u5728 Harness \u9762\u677F\u4E2D
  - \u5207\u6362\u6A21\u5F0F\u65F6\uFF0C\u5BF9\u5E94\u7684 system prompt \u4F1A\u6CE8\u5165\u5230 AI \u5BF9\u8BDD\u4E2D
-->

# \u6A21\u5F0F\u5B9A\u4E49

<!--
  \u26A0\uFE0F YAML modes \u4EE3\u7801\u5757\u683C\u5F0F\u8981\u6C42\uFF08\u4EE3\u7801\u5F3A\u4F9D\u8D56\uFF09\uFF1A

  1. \u4EE3\u7801\u5757\u6807\u8BB0\u5FC5\u987B\u662F \`\`\`yaml modes \u6216 \`\`\`yml modes
     "modes" \u8FD9\u4E2A\u8BCD\u662F\u5FC5\u987B\u7684\uFF01\u6CA1\u6709\u5B83\u63D2\u4EF6\u627E\u4E0D\u5230\u8FD9\u4E2A\u4EE3\u7801\u5757
     \u274C \u9519\u8BEF: \`\`\`yaml       \uFF08\u7F3A\u5C11 modes \u5173\u952E\u8BCD\uFF09
     \u2705 \u6B63\u786E: \`\`\`yaml modes

  2. \u6BCF\u4E2A\u6A21\u5F0F\u6761\u76EE\u5FC5\u987B\u4EE5 "- id:" \u5F00\u5934\uFF08\u884C\u9996\uFF0C\u65E0\u7F29\u8FDB\uFF09
     \u540E\u7EED\u5B57\u6BB5\u5FC5\u987B\u7F29\u8FDB\uFF08\u7A7A\u683C\u7F29\u8FDB\uFF09

  3. \u5B57\u6BB5\u8BF4\u660E\uFF1A
     - id: \u552F\u4E00\u6807\u8BC6\u7B26\uFF08\u5FC5\u586B\uFF09\u2014 \u5FC5\u987B\u4E0E\u4E0B\u65B9 ## \u6807\u9898\u5B8C\u5168\u4E00\u81F4
     - label: \u6309\u94AE\u663E\u793A\u6587\u672C\uFF08\u5FC5\u586B\uFF09\u2014 \u6CA1\u6709 label \u7684\u6A21\u5F0F\u4F1A\u88AB\u5FFD\u7565
     - emoji: \u6309\u94AE\u56FE\u6807\uFF08\u53EF\u9009\uFF0C\u9ED8\u8BA4 \u{1F4CB}\uFF09\u2014 \u652F\u6301\u5F15\u53F7\u5305\u88F9
     - files: \u4E0A\u4E0B\u6587\u6587\u4EF6\u5217\u8868\uFF08\u53EF\u9009\uFF09
       \u5982\u679C\u6709\u6587\u4EF6\uFF1A\u5199\u6210\u591A\u884C\u683C\u5F0F\uFF0C\u6BCF\u884C\u4E00\u4E2A "    - \u8DEF\u5F84"
       \u5982\u679C\u65E0\u6587\u4EF6\uFF1A\u5199\u6210 "files: []" \u6216 "files:" \u540E\u9762\u7A7A\u7740
       \u274C \u4E0D\u652F\u6301: files: [file1.md, file2.md]\uFF08\u5355\u884C\u6570\u7EC4\u683C\u5F0F\uFF09
     - actions: \u5FEB\u6377\u52A8\u4F5C\u6309\u94AE\u5217\u8868\uFF08\u53EF\u9009\uFF09\u2014 \u663E\u793A\u5728 Chat \u5C01\u9762\u4E0A
       \u6BCF\u4E2A action \u5FC5\u987B\u4EE5 "    - label:" \u5F00\u5934
       \u652F\u6301\u5B57\u6BB5\uFF1Alabel\uFF08\u5FC5\u586B\uFF09\u3001prompt\uFF08\u5FC5\u586B\uFF09\u3001icon\uFF08\u53EF\u9009\uFF0CLucide \u56FE\u6807\u540D\uFF09
       \u70B9\u51FB\u6309\u94AE = \u5207\u6362\u5230\u8BE5\u6A21\u5F0F + \u81EA\u52A8\u53D1\u9001 prompt
       \u8DEF\u5F84\u652F\u6301\u4E24\u79CD\u683C\u5F0F\uFF1A
       - vault \u8DEF\u5F84: ${sourceFolder}/some-note.md
       - Wikilink: [[\u7B14\u8BB0\u540D]]
       \u8DEF\u5F84\u4E2D\u53EF\u7528\u53D8\u91CF\uFF1A
       - {active_project} \u2192 \u66FF\u6362\u4E3A _INDEX.md \u4E2D\u7684 active_project \u503C
       - {active_work_context} \u2192 \u66FF\u6362\u4E3A _INDEX.md \u4E2D\u7684 active_work_context \u503C

  4. \u4F60\u53EF\u4EE5\u81EA\u7531\u6DFB\u52A0\u3001\u5220\u9664\u3001\u91CD\u6392\u6A21\u5F0F

  5. actions\uFF08\u53EF\u9009\uFF09\uFF1A\u5B9A\u4E49\u663E\u793A\u5728 Chat \u5C01\u9762\u4E0A\u7684\u5FEB\u6377\u52A8\u4F5C\u6309\u94AE
     \u6BCF\u4E2A action \u9700\u8981 label \u548C prompt \u5B57\u6BB5\uFF0Cicon \u53EF\u9009\uFF08\u4F7F\u7528 Lucide \u56FE\u6807\u540D\uFF09
     \u70B9\u51FB\u6309\u94AE = \u5207\u6362\u5230\u8BE5\u6A21\u5F0F + \u81EA\u52A8\u53D1\u9001\u9884\u8BBE prompt
     \u274C \u9519\u8BEF: actions \u7F29\u8FDB\u4E0D\u5BF9\u6216\u7F3A\u5C11 label/prompt
     \u2705 \u6B63\u786E: \u89C1\u4E0B\u65B9\u793A\u4F8B\u4E2D feed \u6A21\u5F0F\u7684 actions \u5199\u6CD5
-->

\`\`\`yaml modes
- id: chat
  label: \u81EA\u7531\u5BF9\u8BDD
  emoji: "\u{1F4AC}"
  files: []
- id: inbox
  label: \u5904\u7406 Inbox
  emoji: "\u{1F4E5}"
  files:
    - ${harnessInboxFile}
- id: feed
  label: \u751F\u6210 Feed
  emoji: "\u{1F4F0}"
  files: []
  actions:
    - label: \u751F\u6210\u4ECA\u65E5 Feed
      icon: rss
      prompt: "\u6293\u53D6\u4ECA\u65E5\u8D44\u8BAF\u5E76\u751F\u6210 Feed \u65E5\u62A5"
    - label: \u6293\u53D6\u64AD\u5BA2\u66F4\u65B0
      icon: mic
      prompt: "\u68C0\u67E5\u64AD\u5BA2\u8BA2\u9605\u6E90\uFF0C\u751F\u6210\u64AD\u5BA2\u6458\u8981"
- id: organize
  label: \u6574\u7406\u77E5\u8BC6
  emoji: "\u{1F5C2}\uFE0F"
  files: []
  actions:
    - label: \u6574\u7406\u672A\u5F52\u7C7B\u7B14\u8BB0
      icon: sparkles
      prompt: "\u626B\u63CF\u672A\u6574\u7406\u7684\u7B14\u8BB0\u5E76\u5F52\u7C7B\u5230 Wiki"
    - label: \u77E5\u8BC6\u5065\u5EB7\u68C0\u67E5
      icon: heart-pulse
      prompt: "\u8FD0\u884C\u77E5\u8BC6\u5E93\u5065\u5EB7\u68C0\u67E5\uFF0C\u62A5\u544A\u5B64\u5C9B\u548C\u91CD\u590D"
\`\`\`

<!--
  \u26A0\uFE0F \u6A21\u5F0F Prompt \u6BB5\u843D\u683C\u5F0F\u8981\u6C42\uFF08\u4EE3\u7801\u5F3A\u4F9D\u8D56\uFF09\uFF1A

  1. \u6BCF\u4E2A\u6A21\u5F0F\u7684 prompt \u5FC5\u987B\u653E\u5728 ## {id} \u6807\u9898\u4E0B
     \u6807\u9898\u6587\u672C\u5FC5\u987B\u4E0E YAML \u4E2D\u7684 id \u5B8C\u5168\u4E00\u81F4\uFF08\u5927\u5C0F\u5199\u654F\u611F\uFF09
     \u274C \u9519\u8BEF: ## Chat       \uFF08id \u662F "chat"\uFF0C\u5927\u5C0F\u5199\u4E0D\u5339\u914D\uFF09
     \u2705 \u6B63\u786E: ## chat

  2. \u4ECE ## \u6807\u9898\u5230\u4E0B\u4E00\u4E2A ## \u6807\u9898\uFF08\u6216\u6587\u4EF6\u672B\u5C3E\uFF09\u4E4B\u95F4\u7684\u6240\u6709\u5185\u5BB9
     \u90FD\u4F1A\u4F5C\u4E3A\u8BE5\u6A21\u5F0F\u7684 system prompt \u6CE8\u5165\u5230 AI \u5BF9\u8BDD\u4E2D

  3. prompt \u5185\u5BB9\u5B8C\u5168\u81EA\u7531\uFF0C\u4EE5\u4E0B\u53EA\u662F\u793A\u4F8B\u3002\u4F60\u53EF\u4EE5\uFF1A
     - \u5B8C\u5168\u91CD\u5199 prompt
     - \u6DFB\u52A0\u65B0\u7684\u6A21\u5F0F\uFF08\u5728 YAML \u5757\u52A0\u6761\u76EE + \u6DFB\u52A0\u5BF9\u5E94 ## \u6BB5\u843D\uFF09
     - \u5220\u9664\u4E0D\u9700\u8981\u7684\u6A21\u5F0F
     - \u5F15\u7528\u5DE5\u5177\u540D\u79F0\u6765\u6307\u5BFC AI \u4F7F\u7528\u7279\u5B9A\u5DE5\u5177

  4. HTML \u6CE8\u91CA <!-- --> \u4E5F\u4F1A\u88AB\u5305\u542B\u5728 prompt \u4E2D\uFF08\u4F46 AI \u901A\u5E38\u4F1A\u5FFD\u7565\u6CE8\u91CA\u6807\u8BB0\uFF09
     \u5982\u679C\u4E0D\u60F3\u8BA9\u67D0\u4E9B\u8BF4\u660E\u51FA\u73B0\u5728 prompt \u91CC\uFF0C\u8BF7\u5728\u90E8\u7F72\u524D\u5220\u9664\u6CE8\u91CA
-->

## chat

\u4F60\u662F\u4E00\u4E2A\u77E5\u8BC6\u7BA1\u7406\u52A9\u624B\uFF0C\u5E2E\u52A9\u7528\u6237\u63A2\u7D22\u548C\u6574\u7406\u77E5\u8BC6\u5E93\u4E2D\u7684\u5185\u5BB9\u3002

\u53EF\u4EE5\u4F7F\u7528 vault \u5DE5\u5177\u8BFB\u53D6\u3001\u641C\u7D22\u7B14\u8BB0\uFF0C\u8054\u7F51\u641C\u7D22\u83B7\u53D6\u6700\u65B0\u4FE1\u606F\uFF0C\u5E76\u5C06\u6709\u4EF7\u503C\u7684\u5185\u5BB9\u5199\u5165\u77E5\u8BC6\u5E93\u3002

## inbox

\u8BF7\u5E2E\u6211\u5904\u7406 Inbox \u4E2D\u7684\u5F85\u529E\u4E8B\u9879\u3002

\u6D41\u7A0B\uFF1A
1. \u8BFB\u53D6 Inbox \u6587\u4EF6\uFF0C\u67E5\u770B\u6240\u6709 \`- [ ]\` \u5F85\u529E\u9879
2. \u9010\u4E2A\u5904\u7406\uFF1A\u641C\u7D22\u77E5\u8BC6\u5E93\u4E2D\u7684\u76F8\u5173\u5185\u5BB9\uFF0C\u7ED9\u51FA\u5EFA\u8BAE\u6216\u76F4\u63A5\u6267\u884C
3. \u5B8C\u6210\u7684\u9879\u76EE\u6807\u8BB0\u4E3A \`- [x]\`
4. \u9700\u8981\u6DF1\u5165\u7814\u7A76\u7684\u5185\u5BB9\uFF0C\u521B\u5EFA\u7B14\u8BB0\u5230 \`${sourceFolder}/\`

## feed

\u4F60\u662F\u4E00\u4E2A\u4FE1\u606F\u7B56\u5C55\u52A9\u624B\u3002\u8BF7\u5E2E\u6211\u751F\u6210\u4ECA\u5929\u7684\u7CBE\u9009\u8D44\u8BAF Feed\u3002

\u6D41\u7A0B\uFF1A
1. \u4F7F\u7528 fetch_feeds \u5DE5\u5177\u83B7\u53D6\u6700\u65B0\u6587\u7AE0
2. \u7528 search_vault \u68C0\u67E5\u77E5\u8BC6\u5E93\u4E2D\u5DF2\u6709\u7684\u76F8\u5173\u5185\u5BB9\uFF0C\u907F\u514D\u63A8\u8350\u65E7\u95FB
3. \u7B5B\u9009\u6700\u6709\u4EF7\u503C\u7684 10-15 \u7BC7\uFF0C\u6309\u91CD\u8981\u7A0B\u5EA6\u6392\u5E8F
4. \u6BCF\u7BC7\u7ED9\u51FA\uFF1A\u6807\u9898\u3001\u6765\u6E90\u3001\u4E00\u53E5\u8BDD\u6458\u8981\u3001\u4E3A\u4EC0\u4E48\u503C\u5F97\u5173\u6CE8
5. \u6700\u540E\u603B\u7ED3\u4ECA\u5929\u7684\u6574\u4F53\u8D8B\u52BF

\u8F93\u51FA\u8981\u6C42\uFF1A
- frontmatter \u5305\u542B type: feed, date: \u4ECA\u5929\u65E5\u671F
- \u7528 create_note \u4FDD\u5B58\u5230 Feed/Feed-{\u65E5\u671F}.md

## organize

\u8BF7\u5E2E\u6211\u6574\u7406 \`${sourceFolder}/\` \u4E2D\u672A\u6574\u7406\u7684\u7B14\u8BB0\u3002

\u6D41\u7A0B\uFF1A
1. \u7528 list_notes \u67E5\u770B \`${sourceFolder}/\` \u4E2D\u7684\u7B14\u8BB0
2. \u7B5B\u9009\u6CA1\u6709 \`organized: true\` \u6807\u8BB0\u7684\u7B14\u8BB0
3. \u9010\u7BC7\u7528 read_note \u9605\u8BFB\u5185\u5BB9
4. \u7528 search_vault \u5728 \`${wikiFolder}/\` \u4E2D\u641C\u7D22\u76F8\u5173\u6761\u76EE
5. \u6709\u76F8\u5173\u6761\u76EE \u2192 edit_note \u8865\u5145\u65B0\u4FE1\u606F\uFF1B\u6CA1\u6709 \u2192 create_note \u521B\u5EFA\u65B0\u6761\u76EE
6. \u65B0\u6761\u76EE\u5305\u542B frontmatter\uFF08tags\u3001summary\uFF09\u548C [[wiki-link]] \u4EA4\u53C9\u5F15\u7528
7. \u7528 update_frontmatter \u6807\u8BB0\u539F\u7B14\u8BB0 organized: true

\u6BCF\u7BC7\u5904\u7406\u5B8C\u540E\u544A\u8BC9\u6211\u505A\u4E86\u4EC0\u4E48\u3002
`
  });
  files.push({
    path: `${GUIDE_FOLDER}/PROGRESS.md`,
    content: `<!--
  \u4F7F\u7528\u8BF4\u660E\uFF1A
  - \u5C06\u672C\u6587\u4EF6\u590D\u5236\u5230 ${harnessProjectsFolder}/{\u9879\u76EE\u540D}/PROGRESS.md
    \u4F8B\u5982\uFF1A${harnessProjectsFolder}/default/PROGRESS.md
  - \u6B64\u6587\u4EF6\u662F\u53EF\u9009\u7684\uFF0C\u4F46\u5982\u679C\u5B58\u5728\uFF0CHarness \u9762\u677F\u4F1A\u663E\u793A\u9879\u76EE\u8FDB\u5C55\u6458\u8981

  \u26A0\uFE0F \u683C\u5F0F\u8981\u6C42\uFF08\u4EE3\u7801\u5F3A\u4F9D\u8D56\uFF09\uFF1A

  \u63D2\u4EF6\u4ECE\u6587\u4EF6**\u5E95\u90E8\u5F80\u4E0A**\u626B\u63CF\uFF0C\u63D0\u53D6\u4E24\u4E2A\u72B6\u6001\uFF1A

  1. \u6700\u8FD1\u5B8C\u6210\u9879\uFF08lastDone\uFF09:
     \u4ECE\u5E95\u90E8\u5F80\u4E0A\u627E\u7B2C\u4E00\u4E2A "- [x]" \u5F00\u5934\u7684\u884C\uFF0C\u63D0\u53D6\u5176\u540E\u7684\u6587\u672C
     \u4F8B\u5982: "- [x] \u5B8C\u6210\u4E86 API \u5F00\u5173\u529F\u80FD" \u2192 \u663E\u793A "\u5B8C\u6210\u4E86 API \u5F00\u5173\u529F\u80FD"

  2. \u4E0B\u4E00\u6B65\uFF08nextStep\uFF09:
     \u4ECE\u5E95\u90E8\u5F80\u4E0A\u627E\u7B2C\u4E00\u4E2A "- [ ]" \u6216 "- []" \u5F00\u5934\u7684\u884C\uFF0C\u63D0\u53D6\u5176\u540E\u7684\u6587\u672C
     \u4F8B\u5982: "- [ ] \u5B9E\u73B0 Feed \u5DE5\u5177" \u2192 \u663E\u793A "\u5B9E\u73B0 Feed \u5DE5\u5177"

  3. \u515C\u5E95\uFF1A\u5982\u679C\u627E\u4E0D\u5230\u4E0A\u8FF0\u683C\u5F0F\uFF0C\u4F1A\u7528\u6700\u540E\u4E00\u4E2A ## \u6807\u9898\u4F5C\u4E3A lastDone

  \u5EFA\u8BAE\u7528\u6CD5\uFF1A
  - \u6700\u65B0\u7684\u5185\u5BB9\u5199\u5728\u6587\u4EF6\u5E95\u90E8
  - \u7528 "- [x]" \u6807\u8BB0\u5DF2\u5B8C\u6210\u7684\u91CC\u7A0B\u7891
  - \u7528 "- [ ]" \u6807\u8BB0\u5F85\u529E\u4E8B\u9879
  - \u53EF\u4EE5\u7528 ## \u6807\u9898\u6765\u5206\u7EC4\uFF08\u6309\u65E5\u671F\u3001\u6309\u9636\u6BB5\u7B49\uFF09
-->

# \u9879\u76EE\u8FDB\u5C55

## ${today}

- [x] \u521D\u59CB\u5316\u9879\u76EE
- [ ] \u914D\u7F6E\u5DE5\u4F5C\u6A21\u5F0F
`
  });
  files.push({
    path: `${GUIDE_FOLDER}/inbox.md`,
    content: `<!--
  \u4F7F\u7528\u8BF4\u660E\uFF1A
  - \u5C06\u672C\u6587\u4EF6\u590D\u5236\u5230 ${harnessInboxFile}
  - \u5982\u679C\u76EE\u6807\u8DEF\u5F84\u7684\u7236\u6587\u4EF6\u5939\u4E0D\u5B58\u5728\uFF0C\u9700\u8981\u5148\u521B\u5EFA

  \u26A0\uFE0F \u683C\u5F0F\u8981\u6C42\uFF08\u4EE3\u7801\u5F3A\u4F9D\u8D56\uFF09\uFF1A

  \u3010\u5F85\u529E\u8BA1\u6570\u3011
  Harness \u9762\u677F\u4F1A\u7EDF\u8BA1\u6B64\u6587\u4EF6\u4E2D\u6240\u6709 "- [ ]" \u884C\u7684\u6570\u91CF\u4F5C\u4E3A\u5F85\u529E\u8BA1\u6570\u3002
  \u6CE8\u610F\uFF1A
  - \u5FC5\u987B\u662F "- [ ] " \u683C\u5F0F\uFF08\u77ED\u6A2A\u7EBF + \u7A7A\u683C + \u65B9\u62EC\u53F7\u5305\u88F9\u7A7A\u683C + \u7A7A\u683C\uFF09
  - "- [x]" \u4E0D\u8BA1\u5165\uFF08\u5DF2\u5B8C\u6210\uFF09
  - \u5927\u5C0F\u5199\u654F\u611F\uFF0C"- [X]" \u4E5F\u4E0D\u8BA1\u5165

  \u3010AI \u5199\u5165\u683C\u5F0F\u3011
  \u5F53\u7528\u6237\u5728\u5BF9\u8BDD\u4E2D\u70B9\u51FB\u300C\u4FDD\u5B58\u5230 Inbox\u300D\u6309\u94AE\u65F6\uFF0C\u63D2\u4EF6\u4F1A\u5199\u5165\u5982\u4E0B\u683C\u5F0F\uFF1A
    - [ ] [AI \u5BF9\u8BDD] {\u5185\u5BB9\u6458\u8981}
  \u5E76\u4E14\u4F1A\uFF1A
  1. \u67E5\u627E\u6587\u4EF6\u4E2D\u662F\u5426\u6709 "## YYYY-MM-DD" \u683C\u5F0F\u7684\u65E5\u671F\u6807\u9898\uFF08\u5F53\u5929\u65E5\u671F\uFF09
  2. \u5982\u679C\u6709 \u2192 \u5728\u8BE5\u6807\u9898\u540E\u9762\u63D2\u5165\u65B0\u6761\u76EE
  3. \u5982\u679C\u6CA1\u6709 \u2192 \u5728\u7B2C\u4E00\u4E2A "## " \u6807\u9898\u524D\u63D2\u5165\u65B0\u7684\u65E5\u671F\u6807\u9898\u548C\u6761\u76EE
  4. \u5982\u679C\u6587\u4EF6\u4E0D\u5B58\u5728 \u2192 \u521B\u5EFA\u6587\u4EF6\uFF0C\u5185\u5BB9\u4E3A "# Inbox\\n\\n## YYYY-MM-DD\\n\u6761\u76EE"

  \u56E0\u6B64\u5EFA\u8BAE\uFF1A
  - \u6587\u4EF6\u7B2C\u4E00\u884C\u7528 # Inbox \u4F5C\u4E3A\u4E3B\u6807\u9898
  - \u7528 ## YYYY-MM-DD \u683C\u5F0F\u7684\u4E8C\u7EA7\u6807\u9898\u6765\u6309\u65E5\u671F\u5206\u7EC4
  - \u624B\u52A8\u6DFB\u52A0\u7684\u5F85\u529E\u4E5F\u653E\u5728\u5BF9\u5E94\u65E5\u671F\u6807\u9898\u4E0B
-->

# Inbox

## ${today}

- [ ] \u793A\u4F8B\u5F85\u529E\uFF1A\u9605\u8BFB\u6700\u65B0\u7684 AI \u8BBA\u6587
- [ ] \u793A\u4F8B\u5F85\u529E\uFF1A\u6574\u7406\u4E0A\u5468\u7684\u5B66\u4E60\u7B14\u8BB0
`
  });
  return files;
}

// src/model-options.ts
var CLAUDE_CODE_MODELS = [
  ["", "CLI \u9ED8\u8BA4\uFF08\u63A8\u8350\uFF09"],
  ["sonnet", "Sonnet\uFF08\u6700\u65B0\uFF09"],
  ["opus", "Opus\uFF08\u6700\u65B0\uFF09"],
  ["haiku", "Haiku\uFF08\u6700\u65B0\uFF09"],
  ["claude-sonnet-5", "Claude Sonnet 5"],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ["claude-opus-4-8", "Claude Opus 4.8"],
  ["claude-opus-4-6", "Claude Opus 4.6"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"]
];
function getClaudeCodeModelOptions(current) {
  if (!current || CLAUDE_CODE_MODELS.some(([value]) => value === current)) return CLAUDE_CODE_MODELS;
  return [...CLAUDE_CODE_MODELS, [current, `\u5DF2\u6709\u81EA\u5B9A\u4E49\u6A21\u578B\uFF08${current}\uFF09`]];
}

// src/settings.ts
var DEFAULT_PROMPT_TEMPLATES = [
  { name: "\u603B\u7ED3\u8981\u70B9", prompt: "\u603B\u7ED3\u8FD9\u7BC7\u6587\u7AE0\u7684\u8981\u70B9" },
  { name: "\u751F\u6210 Wiki \u6761\u76EE", prompt: "\u63D0\u53D6\u5173\u952E\u6982\u5FF5\uFF0C\u751F\u6210 Wiki \u6761\u76EE" },
  { name: "\u7FFB\u8BD1\u4E3A\u4E2D\u6587", prompt: "\u7FFB\u8BD1\u4E3A\u4E2D\u6587" },
  { name: "\u7FFB\u8BD1\u4E3A\u82F1\u6587", prompt: "\u7FFB\u8BD1\u4E3A\u82F1\u6587" },
  { name: "\u751F\u6210\u95EA\u5361", prompt: "\u6839\u636E\u8FD9\u7BC7\u7B14\u8BB0\u751F\u6210\u590D\u4E60\u95EA\u5361" },
  { name: "\u67E5\u627E\u76F8\u5173\u7B14\u8BB0", prompt: "\u627E\u51FA\u77E5\u8BC6\u5E93\u4E2D\u4E0E\u5F53\u524D\u7B14\u8BB0\u76F8\u5173\u7684\u5185\u5BB9" }
];
var DEFAULT_SETTINGS = {
  apiKey: "",
  enableApi: true,
  knowledgeFolders: ["Raw", "Wiki"],
  model: "claude-haiku-4-5",
  cliBackend: "claude-code",
  claudeCodeModel: "sonnet",
  claudeCodeEffort: "",
  codexModel: "",
  codexReasoningEffort: "",
  codexPermissionMode: "vault-write",
  chatHistoryFolder: ".ai-chat",
  chatHistoryRetentionDays: 30,
  chatStreamMode: "auto",
  chatCompressThresholdEst: 9e4,
  chatContextBudgetTokens: 2e5,
  enableWebSearch: true,
  promptTemplates: DEFAULT_PROMPT_TEMPLATES,
  feedSources: DEFAULT_FEEDS,
  enableLocalImages: true,
  maxImagesPerMessage: 3,
  maxImageBytes: 3145728,
  enableAutoTagging: false,
  autoTagFolders: ["Raw"],
  autoTagPrompt: "",
  distillTargetFolder: "Wiki",
  enablePodcast: true,
  enableWeRead: false,
  wereadApiKey: "",
  harnessProjectsFolder: "KB/Projects",
  harnessInboxFile: "KB/Inbox/ideas.md",
  proxyEnabled: false,
  proxyUrl: "",
  proxyToken: "",
  proxyFallbackToApi: true
};
var SETTINGS_TABS = [
  { id: "general", label: "\u5E38\u89C4" },
  { id: "chat", label: "\u804A\u5929" },
  { id: "knowledge", label: "\u77E5\u8BC6\u5E93" },
  { id: "feeds", label: "\u8BA2\u9605\u4E0E\u670D\u52A1" },
  { id: "advanced", label: "\u9AD8\u7EA7" }
];
var AIDailyChatSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.activeTab = "general";
    this.plugin = plugin;
  }
  switchTab(tabId) {
    this.activeTab = tabId;
    const container = this.containerEl;
    for (const tab of SETTINGS_TABS) {
      const btn = container.querySelector(`.ai-daily-tab-btn[data-tab="${tab.id}"]`);
      const pane = container.querySelector(`.ai-daily-tab-pane[data-tab="${tab.id}"]`);
      if (btn) btn.toggleClass("is-active", tab.id === tabId);
      if (pane) pane.style.display = tab.id === tabId ? "" : "none";
    }
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ai-daily-settings");
    const tabBar = containerEl.createDiv({ cls: "ai-daily-tab-bar" });
    for (const tab of SETTINGS_TABS) {
      const btn = tabBar.createEl("button", {
        text: tab.label,
        cls: `ai-daily-tab-btn${tab.id === this.activeTab ? " is-active" : ""}`
      });
      btn.dataset.tab = tab.id;
      btn.addEventListener("click", () => this.switchTab(tab.id));
    }
    const panes = {};
    for (const tab of SETTINGS_TABS) {
      const pane = containerEl.createDiv({ cls: "ai-daily-tab-pane" });
      pane.dataset.tab = tab.id;
      pane.style.display = tab.id === this.activeTab ? "" : "none";
      panes[tab.id] = pane;
    }
    this.renderGeneralTab(panes["general"]);
    this.renderChatTab(panes["chat"]);
    this.renderKnowledgeTab(panes["knowledge"]);
    this.renderFeedsTab(panes["feeds"]);
    this.renderAdvancedTab(panes["advanced"]);
  }
  renderGeneralTab(el) {
    el.createEl("h3", { text: "Anthropic API" });
    new import_obsidian3.Setting(el).setName("Anthropic API Key").setDesc("\u7528\u4E8E\u8C03\u7528 Claude API").addText((text) => {
      text.setPlaceholder("sk-ant-...").setValue(this.plugin.settings.apiKey).onChange(async (value) => {
        this.plugin.settings.apiKey = value;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "off";
    }).addExtraButton((btn) => {
      btn.setIcon("eye-off").setTooltip("\u663E\u793A/\u9690\u85CF API Key").onClick(() => {
        const setting = btn.extraSettingsEl.closest(".setting-item");
        const input = setting == null ? void 0 : setting.querySelector("input");
        if (!input) return;
        const hidden = input.type === "password";
        input.type = hidden ? "text" : "password";
        btn.setIcon(hidden ? "eye" : "eye-off");
      });
    });
    new import_obsidian3.Setting(el).setName("\u542F\u7528 API \u8C03\u7528").setDesc(
      "\u5173\u95ED\u540E\u6240\u6709\u4F7F\u7528 Anthropic API \u7684\u529F\u80FD\u5C06\u505C\u7528\uFF08\u804A\u5929\u3001\u81EA\u52A8\u6807\u6CE8\u3001Feed \u751F\u6210\u7B49\uFF09\uFF0C\u4EE3\u7406\u6A21\u5F0F\u548C Claude Code \u4E0D\u53D7\u5F71\u54CD"
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableApi).onChange(async (value) => {
        this.plugin.settings.enableApi = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("API \u6A21\u578B").setDesc("\u4EC5\u7528\u4E8E Anthropic API \u529F\u80FD\uFF0C\u4E0D\u5F71\u54CD\u684C\u9762\u7AEF\u6216 Proxy \u7684 CLI Agent").addDropdown(
      (dropdown) => dropdown.addOption("claude-haiku-4-5", "Haiku 4.5 (\u5FEB\u901F/\u4FBF\u5B9C)").addOption("claude-sonnet-4-6", "Sonnet 4.6 (\u5747\u8861)").addOption("claude-sonnet-5", "Sonnet 5 (\u5747\u8861/\u65B0)").addOption("claude-opus-4-6", "Opus 4.6").addOption("claude-opus-4-8", "Opus 4.8 (\u6700\u5F3A)").setValue(this.plugin.settings.model).onChange(async (value) => {
        this.plugin.settings.model = value;
        await this.plugin.saveSettings();
      })
    );
    el.createEl("h3", { text: "Agent \u540E\u7AEF" });
    new import_obsidian3.Setting(el).setName("CLI \u540E\u7AEF").setDesc("\u684C\u9762\u7AEF\u548C\u4EE3\u7406\u6A21\u5F0F\u4F7F\u7528\u7684 Agent CLI \u5DE5\u5177").addDropdown(
      (dropdown) => dropdown.addOption("claude-code", "Claude Code").addOption("codex", "Codex (OpenAI)").setValue(this.plugin.settings.cliBackend).onChange(async (value) => {
        this.plugin.settings.cliBackend = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (this.plugin.settings.cliBackend === "claude-code") {
      new import_obsidian3.Setting(el).setName("Claude Code \u6A21\u578B").setDesc("\u684C\u9762\u7AEF\u548C Proxy \u4F7F\u7528\uFF1B\u7A33\u5B9A\u522B\u540D\u4F1A\u81EA\u52A8\u8DDF\u968F Claude Code \u7684\u6700\u65B0\u6A21\u578B").addDropdown((dropdown) => {
        const current = this.plugin.settings.claudeCodeModel;
        for (const [value, label] of getClaudeCodeModelOptions(current)) dropdown.addOption(value, label);
        return dropdown.setValue(current).onChange(async (value) => {
          this.plugin.settings.claudeCodeModel = value;
          await this.plugin.saveSettings();
        });
      });
      new import_obsidian3.Setting(el).setName("Claude Code \u63A8\u7406\u5F3A\u5EA6").setDesc("\u684C\u9762\u7AEF\u548C Proxy \u4F7F\u7528\uFF1B\u53EF\u7528\u7EA7\u522B\u53D6\u51B3\u4E8E\u6240\u9009\u6A21\u578B").addDropdown(
        (dropdown) => dropdown.addOption("", "CLI \u9ED8\u8BA4\uFF08\u63A8\u8350\uFF09").addOption("low", "Low").addOption("medium", "Medium").addOption("high", "High").addOption("xhigh", "XHigh").addOption("max", "Max").setValue(this.plugin.settings.claudeCodeEffort).onChange(async (value) => {
          this.plugin.settings.claudeCodeEffort = value;
          await this.plugin.saveSettings();
        })
      );
    } else {
      new import_obsidian3.Setting(el).setName("Codex \u6A21\u578B").setDesc("Codex CLI \u4F7F\u7528\u7684\u6A21\u578B").addDropdown(
        (dropdown) => dropdown.addOption("", "\u8D26\u6237\u9ED8\u8BA4\uFF08\u63A8\u8350\uFF09").addOption("gpt-5.6-sol", "GPT-5.6 Sol\uFF08\u6700\u5F3A\uFF09").addOption("gpt-5.6-terra", "GPT-5.6 Terra\uFF08\u5747\u8861\uFF09").addOption("gpt-5.6-luna", "GPT-5.6 Luna\uFF08\u7ECF\u6D4E\uFF09").addOption("gpt-5.3-codex", "GPT-5.3 Codex\uFF08Agent \u7F16\u7801\uFF09").setValue(this.plugin.settings.codexModel).onChange(async (value) => {
          this.plugin.settings.codexModel = value;
          await this.plugin.saveSettings();
        })
      );
      new import_obsidian3.Setting(el).setName("Codex \u63A8\u7406\u5F3A\u5EA6").setDesc("\u684C\u9762\u7AEF\u548C Proxy \u4F7F\u7528\uFF1B\u53EF\u7528\u7EA7\u522B\u53D6\u51B3\u4E8E\u6240\u9009\u6A21\u578B").addDropdown(
        (dropdown) => dropdown.addOption("", "\u8D26\u6237/CLI \u9ED8\u8BA4\uFF08\u63A8\u8350\uFF09").addOption("none", "None").addOption("low", "Low").addOption("medium", "Medium").addOption("high", "High").addOption("xhigh", "XHigh").addOption("max", "Max").setValue(this.plugin.settings.codexReasoningEffort).onChange(async (value) => {
          this.plugin.settings.codexReasoningEffort = value;
          await this.plugin.saveSettings();
        })
      );
      new import_obsidian3.Setting(el).setName("Codex \u6743\u9650").setDesc("\u65E0\u9700\u4EA4\u4E92\u5BA1\u6279\uFF1BShell \u59CB\u7EC8\u53EA\u8BFB\uFF0CVault \u5199\u5165\u4EC5\u901A\u8FC7 MCP \u767D\u540D\u5355").addDropdown(
        (dropdown) => dropdown.addOption("vault-write", "Vault \u53EF\u5199\uFF08\u63A8\u8350\uFF0C\u65E0\u5220\u9664/\u91CD\u547D\u540D\uFF09").addOption("read-only", "\u53EA\u8BFB").setValue(this.plugin.settings.codexPermissionMode).onChange(async (value) => {
          this.plugin.settings.codexPermissionMode = value;
          await this.plugin.saveSettings();
        })
      );
    }
    el.createEl("h3", { text: "\u5BF9\u8BDD\u4E0E\u5386\u53F2" });
    new import_obsidian3.Setting(el).setName("\u5BF9\u8BDD\u5B58\u6863\u76EE\u5F55").setDesc("\u4F1A\u8BDD JSON \u4FDD\u5B58\u5728\u8BE5\u6587\u4EF6\u5939\uFF08\u53EF\u4E0E\u7B14\u8BB0\u4E00\u5E76\u540C\u6B65\uFF09").addText(
      (text) => text.setPlaceholder(".ai-chat").setValue(this.plugin.settings.chatHistoryFolder).onChange(async (value) => {
        this.plugin.settings.chatHistoryFolder = value.trim() || ".ai-chat";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u5386\u53F2\u4FDD\u7559\u5929\u6570").setDesc("\u8D85\u8FC7\u8BE5\u5929\u6570\u672A\u66F4\u65B0\u7684\u4F1A\u8BDD\u6587\u4EF6\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\uFF1B0 \u8868\u793A\u4E0D\u81EA\u52A8\u6E05\u7406").addSlider(
      (slider) => slider.setLimits(0, 365, 1).setValue(this.plugin.settings.chatHistoryRetentionDays).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.chatHistoryRetentionDays = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u6D41\u5F0F\u8F93\u51FA\u6A21\u5F0F").setDesc(
      "auto: \u684C\u9762\u7528\u771F\u6D41(fetch+SSE)\uFF0C\u5931\u8D25\u65F6\u79FB\u52A8\u7AEF\u81EA\u52A8\u964D\u7EA7\u4E3A\u6253\u5B57\u673A\u3002real: \u4EC5\u771F\u6D41(\u8C03\u8BD5\u7528)\u3002typewriter: \u6574\u6BB5\u8FD4\u56DE+\u5BA2\u6237\u7AEF\u6253\u5B57\u673A\u3002off: \u4E00\u6B21\u6027\u6574\u6BB5\u3002"
    ).addDropdown(
      (dd) => dd.addOption("auto", "Auto\uFF08\u63A8\u8350\uFF09").addOption("real", "Real\uFF08\u4EC5\u771F\u6D41\uFF0C\u8C03\u8BD5\uFF09").addOption("typewriter", "Typewriter\uFF08\u4F2A\u6D41\uFF0C\u6700\u517C\u5BB9\uFF09").addOption("off", "Off\uFF08\u65E0\u52A8\u753B\uFF09").setValue(this.plugin.settings.chatStreamMode).onChange(async (value) => {
        this.plugin.settings.chatStreamMode = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u81EA\u52A8\u6458\u8981\u9608\u503C\uFF08\u4F30\u7B97 tokens\uFF09").setDesc(
      "\u5F53\u4F30\u7B97\u4E0A\u4E0B\u6587\u8D85\u8FC7\u8BE5\u503C\u65F6\uFF0C\u81EA\u52A8\u7528\u4E00\u6B21 API \u8C03\u7528\u538B\u7F29\u66F4\u65E9\u7684\u5BF9\u8BDD\uFF1B0 \u5173\u95ED"
    ).addText(
      (text) => text.setPlaceholder("90000").setValue(String(this.plugin.settings.chatCompressThresholdEst)).onChange(async (value) => {
        const n = parseInt(value.replace(/\s/g, ""), 10);
        this.plugin.settings.chatCompressThresholdEst = Number.isFinite(n) ? Math.max(0, n) : 9e4;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u4E0A\u4E0B\u6587\u9884\u7B97\uFF08\u5C55\u793A\u7528\uFF09").setDesc("\u5E95\u90E8\u7528\u91CF\u6761\u7684\u603B\u53C2\u8003\u503C\uFF0C\u4E0E\u6A21\u578B\u5B9E\u9645\u4E0A\u4E0B\u6587\u7A97\u53E3\u5927\u81F4\u5BF9\u5E94").addText(
      (text) => text.setPlaceholder("200000").setValue(String(this.plugin.settings.chatContextBudgetTokens)).onChange(async (value) => {
        const n = parseInt(value.replace(/\s/g, ""), 10);
        this.plugin.settings.chatContextBudgetTokens = Number.isFinite(n) ? Math.max(1e3, n) : 2e5;
        await this.plugin.saveSettings();
      })
    );
  }
  renderChatTab(el) {
    el.createEl("h3", { text: "\u804A\u5929\u529F\u80FD" });
    new import_obsidian3.Setting(el).setName("\u8054\u7F51\u641C\u7D22").setDesc(
      "\u542F\u7528\u540E Claude \u53EF\u4EE5\u641C\u7D22\u4E92\u8054\u7F51\u5E76\u6293\u53D6\u7F51\u9875\u5185\u5BB9\uFF08\u4F7F\u7528 Anthropic \u5185\u7F6E web_search + web_fetch \u5DE5\u5177\uFF09"
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableWebSearch).onChange(async (value) => {
        this.plugin.settings.enableWebSearch = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u542F\u7528\u672C\u5730\u56FE\u7247\u8BC6\u522B").setDesc(
      "\u5F00\u542F\u540E\uFF0C\u7B14\u8BB0\u4E2D\u5F15\u7528\u7684\u672C\u5730\u56FE\u7247\uFF08![[img.png]]\uFF09\u4F1A\u81EA\u52A8\u53D1\u9001\u7ED9 Claude \u8FDB\u884C\u591A\u6A21\u6001\u5BF9\u8BDD"
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableLocalImages).onChange(async (value) => {
        this.plugin.settings.enableLocalImages = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u5355\u6B21\u6700\u5927\u56FE\u7247\u6570").setDesc("\u6BCF\u6761\u6D88\u606F\u6700\u591A\u9644\u5E26\u7684\u56FE\u7247\u6570\u91CF").addSlider(
      (slider) => slider.setLimits(1, 10, 1).setValue(this.plugin.settings.maxImagesPerMessage).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.maxImagesPerMessage = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u5355\u56FE\u6700\u5927\u4F53\u79EF (MB)").setDesc("\u8D85\u8FC7\u8BE5\u4F53\u79EF\u7684\u56FE\u7247\u5C06\u88AB\u8DF3\u8FC7").addSlider(
      (slider) => slider.setLimits(1, 10, 1).setValue(
        Math.round(this.plugin.settings.maxImageBytes / 1048576)
      ).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.maxImageBytes = value * 1048576;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u542F\u7528\u64AD\u5BA2\u5DE5\u5177").setDesc(
      "\u542F\u7528\u540E Claude \u53EF\u4EE5\u641C\u7D22\u64AD\u5BA2\u3001\u83B7\u53D6\u5267\u96C6\u5217\u8868\u3001\u63D0\u53D6\u6587\u5B57\u7A3F\u5E76\u7FFB\u8BD1\u603B\u7ED3"
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enablePodcast).onChange(async (value) => {
        this.plugin.settings.enablePodcast = value;
        await this.plugin.saveSettings();
      })
    );
    this.renderPromptTemplates(el);
  }
  renderKnowledgeTab(el) {
    el.createEl("h3", { text: "\u77E5\u8BC6\u5E93" });
    new import_obsidian3.Setting(el).setName("\u77E5\u8BC6\u5E93\u6587\u4EF6\u5939").setDesc("\u7528\u9017\u53F7\u5206\u9694\u591A\u4E2A\u6587\u4EF6\u5939\u8DEF\u5F84\uFF0C\u5982 Raw,Wiki").addText(
      (text) => text.setPlaceholder("Raw,Wiki").setValue(this.plugin.settings.knowledgeFolders.join(",")).onChange(async (value) => {
        this.plugin.settings.knowledgeFolders = value.split(",").map((s) => s.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u84B8\u998F\u76EE\u6807\u6587\u4EF6\u5939").setDesc("\u5BF9\u8BDD\u84B8\u998F\u548C\u77E5\u8BC6\u6574\u7406\u7684\u8F93\u51FA\u76EE\u6807\u6587\u4EF6\u5939").addText(
      (text) => text.setPlaceholder("Wiki").setValue(this.plugin.settings.distillTargetFolder).onChange(async (value) => {
        this.plugin.settings.distillTargetFolder = value.trim() || "Wiki";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u542F\u7528\u81EA\u52A8\u6807\u6CE8").setDesc(
      "\u65B0\u5EFA\u6216\u4FEE\u6539\u7B14\u8BB0\u65F6\uFF0C\u81EA\u52A8\u8C03\u7528 Claude \u751F\u6210 tags \u548C summary \u5199\u5165 frontmatter"
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableAutoTagging).onChange(async (value) => {
        this.plugin.settings.enableAutoTagging = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("\u81EA\u52A8\u6807\u6CE8\u76D1\u63A7\u6587\u4EF6\u5939").setDesc("\u4EC5\u5BF9\u8FD9\u4E9B\u6587\u4EF6\u5939\u4E2D\u7684\u7B14\u8BB0\u81EA\u52A8\u6807\u6CE8\uFF0C\u7528\u9017\u53F7\u5206\u9694").addText(
      (text) => text.setPlaceholder("Raw").setValue(this.plugin.settings.autoTagFolders.join(",")).onChange(async (value) => {
        this.plugin.settings.autoTagFolders = value.split(",").map((s) => s.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      })
    );
    const autoTagPromptSetting = new import_obsidian3.Setting(el).setName("\u81EA\u5B9A\u4E49\u6807\u6CE8 Prompt").setDesc("\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4 prompt").addTextArea(
      (text) => text.setPlaceholder("\u4F60\u662F\u4E00\u4E2A\u77E5\u8BC6\u5E93\u6807\u6CE8\u52A9\u624B...").setValue(this.plugin.settings.autoTagPrompt).onChange(async (value) => {
        this.plugin.settings.autoTagPrompt = value;
        await this.plugin.saveSettings();
      })
    );
    autoTagPromptSetting.settingEl.addClass("ai-daily-setting-full");
    const autoTagTextarea = autoTagPromptSetting.settingEl.querySelector("textarea");
    if (autoTagTextarea) {
      autoTagTextarea.rows = 3;
    }
    el.createEl("h3", { text: "Harness" });
    new import_obsidian3.Setting(el).setName("\u9879\u76EE\u6587\u4EF6\u5939").setDesc(
      "Harness \u4ECE\u6B64\u6587\u4EF6\u5939\u8BFB\u53D6 _INDEX.md \u548C\u5404\u9879\u76EE\u7684 modes.md"
    ).addText(
      (text) => text.setPlaceholder("KB/Projects").setValue(this.plugin.settings.harnessProjectsFolder).onChange(async (value) => {
        this.plugin.settings.harnessProjectsFolder = value.trim() || "KB/Projects";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("Inbox \u6587\u4EF6").setDesc(
      "Harness \u72B6\u6001\u680F\u4E2D\u663E\u793A\u5F85\u529E\u8BA1\u6570\u7684\u6587\u4EF6\u8DEF\u5F84"
    ).addText(
      (text) => text.setPlaceholder("KB/Inbox/ideas.md").setValue(this.plugin.settings.harnessInboxFile).onChange(async (value) => {
        this.plugin.settings.harnessInboxFile = value.trim() || "KB/Inbox/ideas.md";
        await this.plugin.saveSettings();
      })
    );
  }
  renderFeedsTab(el) {
    el.createEl("h3", { text: "\u5916\u90E8\u670D\u52A1" });
    new import_obsidian3.Setting(el).setName("\u542F\u7528\u5FAE\u4FE1\u8BFB\u4E66").setDesc(
      "\u542F\u7528\u540E Claude \u53EF\u4EE5\u8BBF\u95EE\u4F60\u7684\u5FAE\u4FE1\u8BFB\u4E66\u6570\u636E\uFF08\u4E66\u67B6\u3001\u7B14\u8BB0\u3001\u5212\u7EBF\u3001\u9605\u8BFB\u7EDF\u8BA1\u7B49\uFF09"
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableWeRead).onChange(async (value) => {
        this.plugin.settings.enableWeRead = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("WeRead API Key").setDesc("\u5FAE\u4FE1\u8BFB\u4E66 API Key\uFF0C\u683C\u5F0F wrk-xxxxxxxx\uFF0C\u5728\u5FAE\u4FE1\u8BFB\u4E66\u5B98\u7F51\u83B7\u53D6").addText((text) => {
      text.setPlaceholder("wrk-...").setValue(this.plugin.settings.wereadApiKey).onChange(async (value) => {
        this.plugin.settings.wereadApiKey = value;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "off";
    }).addExtraButton((btn) => {
      btn.setIcon("eye-off").setTooltip("\u663E\u793A/\u9690\u85CF API Key").onClick(() => {
        const setting = btn.extraSettingsEl.closest(".setting-item");
        const input = setting == null ? void 0 : setting.querySelector("input");
        if (!input) return;
        const hidden = input.type === "password";
        input.type = hidden ? "text" : "password";
        btn.setIcon(hidden ? "eye" : "eye-off");
      });
    });
    el.createEl("h3", { text: "Feed \u8BA2\u9605\u6E90" });
    this.renderFeedSourceList(el);
  }
  renderAdvancedTab(el) {
    el.createEl("h3", { text: "\u4EE3\u7406\u6A21\u5F0F\uFF08\u79FB\u52A8\u7AEF\uFF09" });
    new import_obsidian3.Setting(el).setName("\u542F\u7528\u4EE3\u7406\u6A21\u5F0F").setDesc(
      "\u901A\u8FC7\u684C\u9762\u7AEF proxy-server \u53D1\u9001\u8BF7\u6C42\uFF08\u4F7F\u7528 Claude \u8BA2\u9605\u989D\u5EA6\uFF0C\u4E0D\u6D88\u8017 API \u8D39\u7528\uFF09"
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.proxyEnabled).onChange(async (value) => {
        this.plugin.settings.proxyEnabled = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("Proxy URL").setDesc("\u684C\u9762\u7AEF\u4EE3\u7406\u670D\u52A1\u5668\u5730\u5740\uFF0C\u5982 https://claude.yourdomain.com").addText(
      (text) => text.setPlaceholder("https://claude.yourdomain.com").setValue(this.plugin.settings.proxyUrl).onChange(async (value) => {
        this.plugin.settings.proxyUrl = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(el).setName("Proxy Token").setDesc("\u4EE3\u7406\u670D\u52A1\u5668\u8BA4\u8BC1\u4EE4\u724C").addText((text) => {
      text.setPlaceholder("your-auth-token").setValue(this.plugin.settings.proxyToken).onChange(async (value) => {
        this.plugin.settings.proxyToken = value;
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "off";
    }).addExtraButton((btn) => {
      btn.setIcon("eye-off").setTooltip("\u663E\u793A/\u9690\u85CF Token").onClick(() => {
        const setting = btn.extraSettingsEl.closest(".setting-item");
        const input = setting == null ? void 0 : setting.querySelector("input");
        if (!input) return;
        const hidden = input.type === "password";
        input.type = hidden ? "text" : "password";
        btn.setIcon(hidden ? "eye" : "eye-off");
      });
    });
    new import_obsidian3.Setting(el).setName("\u4EE3\u7406\u4E0D\u53EF\u7528\u65F6\u56DE\u9000\u672C\u5730 API").setDesc("\u5F53\u684C\u9762\u7AEF\u4E0D\u53EF\u8FBE\u65F6\uFF0C\u81EA\u52A8\u4F7F\u7528 Anthropic API Key \u8C03\u7528").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.proxyFallbackToApi).onChange(async (value) => {
        this.plugin.settings.proxyFallbackToApi = value;
        await this.plugin.saveSettings();
      })
    );
    el.createEl("h3", { text: "\u5DE5\u5177" });
    new import_obsidian3.Setting(el).setName("\u751F\u6210 Vault \u53C2\u8003\u6A21\u677F").setDesc(
      "\u6839\u636E\u5F53\u524D\u8BBE\u7F6E\u751F\u6210 _cortex-guide/ \u6587\u4EF6\u5939\uFF0C\u5305\u542B\u6587\u4EF6\u5939\u7ED3\u6784\u6A21\u677F\u3001modes \u914D\u7F6E\u793A\u4F8B\u3001CLAUDE.md \u548C AGENTS.md\u3002\u4FEE\u6539\u8BBE\u7F6E\u540E\u53EF\u91CD\u65B0\u751F\u6210\u3002"
    ).addButton(
      (btn) => btn.setButtonText("\u751F\u6210\u6A21\u677F").onClick(async () => {
        await this.generateVaultGuide();
      })
    );
  }
  async generateVaultGuide() {
    const vault = this.plugin.app.vault;
    const guideFolder = getGuideFolderPath();
    const files = generateGuideFiles(this.plugin.settings);
    const existing = vault.getAbstractFileByPath(guideFolder);
    if (existing) {
      await vault.adapter.rmdir(guideFolder, true);
    }
    await vault.createFolder(guideFolder);
    for (const file of files) {
      const dir = file.path.substring(0, file.path.lastIndexOf("/"));
      if (dir && !vault.getAbstractFileByPath(dir)) {
        await vault.createFolder(dir);
      }
      await vault.create(file.path, file.content);
    }
    new import_obsidian3.Notice(`\u5DF2\u751F\u6210\u53C2\u8003\u6A21\u677F: ${guideFolder}/ (${files.length} \u4E2A\u6587\u4EF6)`, 5e3);
  }
  renderPromptTemplates(containerEl) {
    const wrapper = containerEl.createDiv({ cls: "ai-daily-prompt-templates" });
    const desc = new import_obsidian3.Setting(wrapper).setName("Prompt \u6A21\u677F").setDesc("\u5728\u8F93\u5165\u6846\u4E2D\u952E\u5165 / \u53EF\u5FEB\u901F\u9009\u62E9\u6A21\u677F").addButton(
      (btn) => btn.setButtonText("\u6DFB\u52A0\u6A21\u677F").setCta().onClick(async () => {
        this.plugin.settings.promptTemplates.push({
          name: "",
          prompt: ""
        });
        await this.plugin.saveSettings();
        this.display();
      })
    );
    desc.settingEl.addClass("ai-daily-setting-desc-only");
    for (let i = 0; i < this.plugin.settings.promptTemplates.length; i++) {
      const tpl = this.plugin.settings.promptTemplates[i];
      const s = new import_obsidian3.Setting(wrapper).setName(tpl.name || "(\u672A\u547D\u540D)").setDesc(tpl.prompt.slice(0, 60) + (tpl.prompt.length > 60 ? "\u2026" : ""));
      s.addButton(
        (btn) => btn.setIcon("pencil").setTooltip("\u7F16\u8F91").onClick(() => {
          this.openTemplateEditor(wrapper, i);
        })
      );
      s.addButton(
        (btn) => btn.setIcon("trash-2").setTooltip("\u5220\u9664").onClick(async () => {
          this.plugin.settings.promptTemplates.splice(i, 1);
          await this.plugin.saveSettings();
          this.display();
        })
      );
    }
  }
  openTemplateEditor(wrapper, index) {
    const tpl = this.plugin.settings.promptTemplates[index];
    if (!tpl) return;
    wrapper.querySelectorAll(".ai-daily-template-editor").forEach((el) => el.remove());
    const editor = wrapper.createDiv({ cls: "ai-daily-template-editor ai-daily-feed-source-editor" });
    const nameField = editor.createDiv({ cls: "ai-daily-feed-editor-field" });
    nameField.createEl("label", { text: "\u540D\u79F0" });
    const nameInput = nameField.createEl("input", {
      type: "text",
      placeholder: "\u6A21\u677F\u540D\u79F0",
      value: tpl.name
    });
    const promptField = editor.createDiv({ cls: "ai-daily-feed-editor-field" });
    promptField.createEl("label", { text: "Prompt" });
    const promptInput = promptField.createEl("textarea", {
      placeholder: "\u8F93\u5165 prompt \u5185\u5BB9\u2026"
    });
    promptInput.value = tpl.prompt;
    promptInput.rows = 3;
    promptInput.style.width = "100%";
    promptInput.style.resize = "vertical";
    const btnRow = editor.createDiv({ cls: "ai-daily-feed-editor-btns" });
    const saveBtn = btnRow.createEl("button", { text: "\u4FDD\u5B58", cls: "mod-cta" });
    const cancelBtn = btnRow.createEl("button", { text: "\u53D6\u6D88" });
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const prompt = promptInput.value.trim();
      if (!name || !prompt) {
        saveBtn.textContent = "\u8BF7\u586B\u5199\u540D\u79F0\u548C\u5185\u5BB9";
        setTimeout(() => {
          saveBtn.textContent = "\u4FDD\u5B58";
        }, 1500);
        return;
      }
      tpl.name = name;
      tpl.prompt = prompt;
      await this.plugin.saveSettings();
      this.display();
    });
    cancelBtn.addEventListener("click", () => {
      if (!tpl.name && !tpl.prompt) {
        this.plugin.settings.promptTemplates.splice(index, 1);
      }
      this.display();
    });
  }
  renderFeedSourceList(containerEl) {
    const wrapper = containerEl.createDiv({ cls: "ai-daily-feed-sources" });
    const header = new import_obsidian3.Setting(wrapper).setName(`\u8BA2\u9605\u6E90 (${this.plugin.settings.feedSources.length})`).setDesc("\u7BA1\u7406 RSS\u3001Hacker News\u3001Reddit\u3001GitHub Trending \u7B49\u5185\u5BB9\u6E90").addButton(
      (btn) => btn.setButtonText("\u6DFB\u52A0").setCta().onClick(() => {
        this.plugin.settings.feedSources.push({
          name: "",
          url: "",
          category: "community"
        });
        this.refreshSourceList(wrapper, header.settingEl);
      })
    );
    this.refreshSourceList(wrapper, header.settingEl);
  }
  refreshSourceList(wrapper, headerEl) {
    var _a, _b, _c, _d;
    wrapper.querySelectorAll(".ai-daily-feed-source-item").forEach((el) => el.remove());
    const sources = this.plugin.settings.feedSources;
    const headerSetting = headerEl.querySelector(".setting-item-name");
    if (headerSetting) {
      headerSetting.textContent = `\u8BA2\u9605\u6E90 (${sources.length})`;
    }
    const TYPE_LABELS = {
      rss: "RSS",
      hn: "HN",
      reddit: "Reddit",
      "github-trending": "GitHub",
      podcast: "Podcast"
    };
    const CAT_LABELS = {
      research: "\u7814\u7A76",
      engineering: "\u5DE5\u7A0B",
      community: "\u793E\u533A",
      tools: "\u5DE5\u5177",
      podcast: "\u64AD\u5BA2",
      newsletter: "\u5468\u520A",
      industry: "\u884C\u4E1A",
      news: "\u65B0\u95FB",
      other: "\u5176\u4ED6"
    };
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const row = wrapper.createDiv({ cls: "ai-daily-feed-source-item" });
      const info = row.createDiv({ cls: "ai-daily-feed-source-info" });
      const nameEl = info.createDiv({ cls: "ai-daily-feed-source-name" });
      nameEl.textContent = source.name || "(\u672A\u547D\u540D)";
      const badges = info.createDiv({ cls: "ai-daily-feed-source-badges" });
      const typeBadge = badges.createEl("span", {
        cls: `ai-daily-feed-badge ai-daily-feed-badge-type`,
        text: (_b = TYPE_LABELS[(_a = source.type) != null ? _a : "rss"]) != null ? _b : "RSS"
      });
      typeBadge.dataset.type = (_c = source.type) != null ? _c : "rss";
      badges.createEl("span", {
        cls: "ai-daily-feed-badge ai-daily-feed-badge-cat",
        text: (_d = CAT_LABELS[source.category]) != null ? _d : source.category
      });
      const urlEl = info.createDiv({ cls: "ai-daily-feed-source-url" });
      urlEl.textContent = source.url || "\u2014";
      const actions = row.createDiv({ cls: "ai-daily-feed-source-actions" });
      const editBtn = actions.createEl("button", {
        cls: "ai-daily-feed-source-btn",
        attr: { "aria-label": "\u7F16\u8F91" }
      });
      editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
      editBtn.addEventListener("click", () => {
        this.openSourceEditor(i, wrapper, headerEl);
      });
      const delBtn = actions.createEl("button", {
        cls: "ai-daily-feed-source-btn ai-daily-feed-source-btn-del",
        attr: { "aria-label": "\u5220\u9664" }
      });
      delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
      delBtn.addEventListener("click", async () => {
        sources.splice(i, 1);
        await this.plugin.saveSettings();
        this.refreshSourceList(wrapper, headerEl);
      });
      if (!source.name && !source.url) {
        setTimeout(() => this.openSourceEditor(i, wrapper, headerEl), 50);
      }
    }
  }
  openSourceEditor(index, wrapper, headerEl) {
    var _a, _b;
    const source = this.plugin.settings.feedSources[index];
    if (!source) return;
    const items = wrapper.querySelectorAll(".ai-daily-feed-source-item");
    const row = items[index];
    if (!row) return;
    wrapper.querySelectorAll(".ai-daily-feed-source-editor").forEach((el) => el.remove());
    const editor = document.createElement("div");
    editor.className = "ai-daily-feed-source-editor";
    row.after(editor);
    const fields = [
      { label: "\u540D\u79F0", key: "name", placeholder: "ArXiv CS.AI" },
      { label: "URL", key: "url", placeholder: "https://rss.arxiv.org/rss/cs.AI" }
    ];
    for (const field of fields) {
      const fieldRow = editor.createDiv({ cls: "ai-daily-feed-editor-field" });
      fieldRow.createEl("label", { text: field.label });
      const input = fieldRow.createEl("input", {
        type: "text",
        placeholder: field.placeholder,
        value: (_a = source[field.key]) != null ? _a : ""
      });
      input.addEventListener("input", () => {
        source[field.key] = input.value.trim();
      });
    }
    const selectRow = editor.createDiv({ cls: "ai-daily-feed-editor-selects" });
    const catGroup = selectRow.createDiv({ cls: "ai-daily-feed-editor-field" });
    catGroup.createEl("label", { text: "\u5206\u7C7B" });
    const catSelect = catGroup.createEl("select");
    for (const [val, label] of [
      ["research", "\u7814\u7A76"],
      ["engineering", "\u5DE5\u7A0B"],
      ["community", "\u793E\u533A"],
      ["tools", "\u5DE5\u5177"],
      ["podcast", "\u64AD\u5BA2"],
      ["newsletter", "\u5468\u520A"],
      ["industry", "\u884C\u4E1A"],
      ["news", "\u65B0\u95FB"]
    ]) {
      const opt = catSelect.createEl("option", { value: val, text: label });
      if (source.category === val) opt.selected = true;
    }
    catSelect.addEventListener("change", () => {
      source.category = catSelect.value;
    });
    const typeGroup = selectRow.createDiv({ cls: "ai-daily-feed-editor-field" });
    typeGroup.createEl("label", { text: "\u7C7B\u578B" });
    const typeSelect = typeGroup.createEl("select");
    for (const [val, label] of [
      ["rss", "RSS"],
      ["hn", "Hacker News"],
      ["reddit", "Reddit"],
      ["github-trending", "GitHub Trending"],
      ["podcast", "Podcast"]
    ]) {
      const opt = typeSelect.createEl("option", { value: val, text: label });
      if (((_b = source.type) != null ? _b : "rss") === val) opt.selected = true;
    }
    typeSelect.addEventListener("change", () => {
      if (typeSelect.value === "rss") {
        delete source.type;
      } else {
        source.type = typeSelect.value;
      }
    });
    const btnRow = editor.createDiv({ cls: "ai-daily-feed-editor-btns" });
    const saveBtn = btnRow.createEl("button", { text: "\u4FDD\u5B58", cls: "mod-cta" });
    const cancelBtn = btnRow.createEl("button", { text: "\u53D6\u6D88" });
    saveBtn.addEventListener("click", async () => {
      if (!source.name || !source.url) {
        saveBtn.textContent = "\u8BF7\u586B\u5199\u540D\u79F0\u548C URL";
        setTimeout(() => {
          saveBtn.textContent = "\u4FDD\u5B58";
        }, 1500);
        return;
      }
      await this.plugin.saveSettings();
      editor.remove();
      this.refreshSourceList(wrapper, headerEl);
    });
    cancelBtn.addEventListener("click", () => {
      if (!source.name && !source.url) {
        this.plugin.settings.feedSources.splice(index, 1);
      }
      editor.remove();
      this.refreshSourceList(wrapper, headerEl);
    });
  }
};

// src/chat-view.ts
var import_obsidian13 = require("obsidian");

// src/claude.ts
var import_obsidian4 = require("obsidian");

// src/anthropic-sse.ts
var SseParser = class {
  constructor() {
    this.buffer = "";
  }
  push(chunk) {
    this.buffer += chunk;
    const events = [];
    while (true) {
      const boundary = findEventBoundary(this.buffer);
      if (!boundary) break;
      const raw = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary.sepLen);
      const ev = parseSingleEvent(raw);
      if (ev !== null) events.push(ev);
    }
    return events;
  }
  /** 返回内部残留缓冲（一般用于诊断流非正常结束）。 */
  residual() {
    return this.buffer;
  }
};
function findEventBoundary(buf) {
  const lf = buf.indexOf("\n\n");
  const crlf = buf.indexOf("\r\n\r\n");
  if (lf < 0 && crlf < 0) return null;
  if (crlf < 0) return { index: lf, sepLen: 2 };
  if (lf < 0) return { index: crlf, sepLen: 4 };
  return crlf <= lf ? { index: crlf, sepLen: 4 } : { index: lf, sepLen: 2 };
}
function parseSingleEvent(raw) {
  if (!raw.trim()) return null;
  let event;
  const dataLines = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0 && !event) return null;
  return { event, data: dataLines.join("\n") };
}
var AnthropicStreamAssembler = class {
  constructor(callbacks = {}) {
    this.parser = new SseParser();
    this.blocks = [];
    this.toolJsonBuffers = /* @__PURE__ */ new Map();
    this.stopReason = "";
    this.usage = { input_tokens: 0, output_tokens: 0 };
    this.gotMessageStop = false;
    this.callbacks = callbacks;
  }
  push(chunk) {
    var _a;
    for (const ev of this.parser.push(chunk)) {
      if (!ev.data || ev.data === "[DONE]") continue;
      let payload;
      try {
        payload = JSON.parse(ev.data);
      } catch (e) {
        throw new Error(
          `anthropic-sse: SSE data is not valid JSON (event=${(_a = ev.event) != null ? _a : "?"}): ${ev.data.slice(
            0,
            200
          )}`
        );
      }
      this.handleEvent(payload);
    }
  }
  finalize() {
    if (!this.gotMessageStop) {
      const residual = this.parser.residual();
      throw new Error(
        `anthropic-sse: stream ended before message_stop (residual=${residual.length}b)`
      );
    }
    const content = this.blocks.filter(
      (b) => b !== void 0
    );
    return {
      content,
      stop_reason: this.stopReason || "end_turn",
      usage: this.usage
    };
  }
  handleEvent(p) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
    switch (p.type) {
      case "message_start": {
        const u = (_a = p.message) == null ? void 0 : _a.usage;
        if (u) {
          this.usage = {
            input_tokens: (_b = u.input_tokens) != null ? _b : this.usage.input_tokens,
            output_tokens: (_c = u.output_tokens) != null ? _c : this.usage.output_tokens,
            cache_creation_input_tokens: u.cache_creation_input_tokens,
            cache_read_input_tokens: u.cache_read_input_tokens
          };
        }
        return;
      }
      case "content_block_start": {
        if (p.index === void 0 || !p.content_block) return;
        const block = { ...p.content_block };
        if (block.type === "tool_use" || block.type === "server_tool_use") {
          block.input = {};
          this.toolJsonBuffers.set(p.index, "");
        }
        this.blocks[p.index] = block;
        return;
      }
      case "content_block_delta": {
        if (p.index === void 0 || !p.delta) return;
        const block = this.blocks[p.index];
        if (p.delta.type === "text_delta") {
          const text = (_d = p.delta.text) != null ? _d : "";
          if (block && block.type === "text") {
            block.text = ((_e = block.text) != null ? _e : "") + text;
          }
          if (text) (_g = (_f = this.callbacks).onTextDelta) == null ? void 0 : _g.call(_f, text);
        } else if (p.delta.type === "input_json_delta") {
          const partial = (_h = p.delta.partial_json) != null ? _h : "";
          const buf = ((_i = this.toolJsonBuffers.get(p.index)) != null ? _i : "") + partial;
          this.toolJsonBuffers.set(p.index, buf);
          if (partial) {
            (_k = (_j = this.callbacks).onToolInputDelta) == null ? void 0 : _k.call(_j, p.index, partial);
          }
        }
        return;
      }
      case "content_block_stop": {
        if (p.index === void 0) return;
        const block = this.blocks[p.index];
        if (block && (block.type === "tool_use" || block.type === "server_tool_use")) {
          const raw = (_l = this.toolJsonBuffers.get(p.index)) != null ? _l : "";
          this.toolJsonBuffers.delete(p.index);
          if (raw.trim() === "") {
            block.input = {};
          } else {
            try {
              block.input = JSON.parse(raw);
            } catch (e) {
              throw new Error(
                `anthropic-sse: tool_use input JSON parse failed at block ${p.index}: ${raw.slice(
                  0,
                  500
                )}`
              );
            }
          }
        }
        return;
      }
      case "message_delta": {
        if ((_m = p.delta) == null ? void 0 : _m.stop_reason) {
          this.stopReason = p.delta.stop_reason;
        }
        if (p.usage) {
          this.usage = {
            input_tokens: (_n = p.usage.input_tokens) != null ? _n : this.usage.input_tokens,
            output_tokens: (_o = p.usage.output_tokens) != null ? _o : this.usage.output_tokens
          };
        }
        return;
      }
      case "message_stop":
        this.gotMessageStop = true;
        return;
      case "ping":
        return;
      case "error":
        throw new Error(
          `anthropic-sse: error event: ${JSON.stringify(p).slice(0, 500)}`
        );
    }
  }
};

// src/tool-definitions.ts
var TOOL_DEFS = [
  {
    name: "read_note",
    description: "\u8BFB\u53D6 vault \u4E2D\u6307\u5B9A\u8DEF\u5F84\u7684\u7B14\u8BB0\u5168\u6587\u3002\u53EF\u7528\u4E8E\u8BFB\u53D6\u65E5\u62A5\u3001\u91C7\u96C6\u7684\u6587\u7AE0\uFF08Raw/\uFF09\u3001\u6574\u7406\u7684\u77E5\u8BC6\u6761\u76EE\uFF08Wiki/\uFF09\u7B49\u3002",
    parameters: {
      path: { type: "string", description: "\u7B14\u8BB0\u8DEF\u5F84\uFF0C\u5982 Raw/some-article.md \u6216 Wiki/concept.md", required: true }
    }
  },
  {
    name: "search_vault",
    description: "\u5728 vault \u4E2D\u641C\u7D22\u7B14\u8BB0\u3002\u652F\u6301\u5173\u952E\u8BCD\u5168\u6587\u641C\u7D22\uFF0C\u53EF\u6309\u6587\u4EF6\u5939\u548C\u6807\u7B7E\u8FC7\u6EE4\u3002\u7528\u4E8E\u5728\u77E5\u8BC6\u5E93\u4E2D\u67E5\u627E\u76F8\u5173\u5185\u5BB9\u3002",
    parameters: {
      query: { type: "string", description: "\u641C\u7D22\u5173\u952E\u8BCD", required: true },
      folder: { type: "string", description: "\u9650\u5B9A\u641C\u7D22\u7684\u6587\u4EF6\u5939\u8DEF\u5F84\uFF0C\u5982 Raw\u3001Wiki\uFF08\u53EF\u9009\uFF09" },
      tag: { type: "string", description: "\u6309\u6807\u7B7E\u8FC7\u6EE4\uFF0C\u5982 ai\u3001rag\uFF08\u5339\u914D frontmatter \u4E2D\u7684 tags\uFF09" }
    }
  },
  {
    name: "append_to_note",
    description: "\u5C06\u5185\u5BB9\u8FFD\u52A0\u5230\u6307\u5B9A\u7B14\u8BB0\u672B\u5C3E\u3002\u7528\u4E8E\u5C06\u5BF9\u8BDD\u4E2D\u7684\u6D1E\u5BDF\u3001\u603B\u7ED3\u5199\u56DE\u7B14\u8BB0\u3002",
    parameters: {
      path: { type: "string", description: "\u7B14\u8BB0\u8DEF\u5F84", required: true },
      content: { type: "string", description: "\u8981\u8FFD\u52A0\u7684 Markdown \u5185\u5BB9", required: true }
    }
  },
  {
    name: "list_notes",
    description: "\u5217\u51FA\u6307\u5B9A\u6587\u4EF6\u5939\u4E2D\u7684\u7B14\u8BB0\uFF0C\u6309\u4FEE\u6539\u65F6\u95F4\u6392\u5E8F\u3002\u4E0D\u6307\u5B9A\u6587\u4EF6\u5939\u5219\u5217\u51FA\u6240\u6709\u77E5\u8BC6\u5E93\u6587\u4EF6\u5939\u7684\u7B14\u8BB0\u3002",
    parameters: {
      folder: { type: "string", description: "\u6587\u4EF6\u5939\u8DEF\u5F84\uFF0C\u5982 Raw\u3001Wiki\uFF08\u53EF\u9009\uFF09" },
      limit: { type: "number", description: "\u8FD4\u56DE\u6700\u8FD1\u51E0\u7BC7\uFF08\u9ED8\u8BA4 20\uFF09" }
    }
  },
  {
    name: "create_note",
    description: "\u521B\u5EFA\u4E00\u7BC7\u65B0\u7B14\u8BB0\u3002\u652F\u6301\u4F20\u5165 frontmatter \u5BF9\u8C61\uFF0C\u81EA\u52A8\u751F\u6210 YAML \u5934\u3002\u4F1A\u81EA\u52A8\u521B\u5EFA\u4E2D\u95F4\u76EE\u5F55\u3002\u8DEF\u5F84\u5DF2\u5B58\u5728\u5219\u62A5\u9519\u3002",
    parameters: {
      path: { type: "string", description: "\u7B14\u8BB0\u8DEF\u5F84\uFF0C\u5982 Wiki/concept.md", required: true },
      content: { type: "string", description: "\u7B14\u8BB0\u6B63\u6587\u5185\u5BB9\uFF08Markdown\uFF09", required: true },
      frontmatter: { type: "object", description: "\u53EF\u9009\u7684 frontmatter \u5BF9\u8C61\uFF0C\u5982 {tags: ['ai'], summary: '...'}" }
    }
  },
  {
    name: "edit_note",
    description: "\u7F16\u8F91\u7B14\u8BB0\u4E2D\u7684\u6307\u5B9A\u90E8\u5206\u3002\u652F\u6301\u4E09\u79CD\u5B9A\u4F4D\u6A21\u5F0F\uFF1Asearch_replace\uFF08\u6309\u539F\u6587\u5339\u914D\u66FF\u6362\uFF0C\u6700\u7CBE\u786E\uFF09\u3001heading\uFF08\u66FF\u6362\u6574\u4E2A\u6807\u9898 section\uFF09\u3001line_range\uFF08\u6309\u884C\u53F7\u8303\u56F4\u66FF\u6362\uFF09\u3002",
    parameters: {
      path: { type: "string", description: "\u7B14\u8BB0\u8DEF\u5F84", required: true },
      mode: { type: "string", description: "\u5B9A\u4F4D\u6A21\u5F0F", enum: ["heading", "line_range", "search_replace"], required: true },
      target: { type: "string", description: "search_replace/heading \u6A21\u5F0F\u4F20\u5B57\u7B26\u4E32\uFF0Cline_range \u6A21\u5F0F\u4F20 {start, end} \u884C\u53F7\u5BF9\u8C61\uFF08\u4ECE 1 \u5F00\u59CB\uFF09", required: true },
      replacement: { type: "string", description: "\u66FF\u6362\u540E\u7684\u65B0\u5185\u5BB9", required: true }
    }
  },
  {
    name: "rename_note",
    description: "\u91CD\u547D\u540D\u6216\u79FB\u52A8\u7B14\u8BB0\u5230\u65B0\u8DEF\u5F84\u3002Obsidian \u4F1A\u81EA\u52A8\u66F4\u65B0\u6240\u6709\u53CD\u5411\u94FE\u63A5\u5F15\u7528\u3002\u76EE\u6807\u8DEF\u5F84\u4E0D\u80FD\u5DF2\u5B58\u5728\u3002",
    parameters: {
      path: { type: "string", description: "\u5F53\u524D\u7B14\u8BB0\u8DEF\u5F84", required: true },
      new_path: { type: "string", description: "\u65B0\u8DEF\u5F84\uFF0C\u5982 Wiki/new-name.md", required: true }
    }
  },
  {
    name: "delete_note",
    description: "\u5220\u9664\u7B14\u8BB0\uFF08\u4E24\u6B65\u786E\u8BA4\uFF09\u3002\u7B2C\u4E00\u6B21\u8C03\u7528\u8FD4\u56DE\u7B14\u8BB0\u9884\u89C8\u548C\u786E\u8BA4\u63D0\u793A\uFF0C\u9700\u8981\u5E26 confirmed: true \u518D\u6B21\u8C03\u7528\u624D\u4F1A\u6267\u884C\u5220\u9664\u3002\u6587\u4EF6\u4F1A\u88AB\u79FB\u5230\u7CFB\u7EDF\u56DE\u6536\u7AD9\u3002",
    parameters: {
      path: { type: "string", description: "\u7B14\u8BB0\u8DEF\u5F84", required: true },
      confirmed: { type: "boolean", description: "\u8BBE\u4E3A true \u786E\u8BA4\u5220\u9664" }
    }
  },
  {
    name: "get_links",
    description: "\u83B7\u53D6\u7B14\u8BB0\u7684\u53CC\u5411\u94FE\u63A5\u5173\u7CFB\u3002\u8FD4\u56DE outlinks\uFF08\u8BE5\u7B14\u8BB0\u94FE\u63A5\u5230\u7684\uFF09\u548C backlinks\uFF08\u94FE\u63A5\u5230\u8BE5\u7B14\u8BB0\u7684\uFF09\u3002\u7528\u4E8E\u7406\u89E3\u7B14\u8BB0\u95F4\u7684\u5173\u7CFB\u548C\u77E5\u8BC6\u56FE\u8C31\u7ED3\u6784\u3002",
    parameters: {
      path: { type: "string", description: "\u7B14\u8BB0\u8DEF\u5F84\uFF0C\u5982 Wiki/concept.md", required: true }
    }
  },
  {
    name: "update_frontmatter",
    description: "\u4FEE\u6539\u7B14\u8BB0\u7684 YAML frontmatter\u3002\u652F\u6301\u8BBE\u7F6E\uFF08set\uFF09\u548C\u5220\u9664\uFF08delete\uFF09\u5B57\u6BB5\u3002\u6CA1\u6709 frontmatter \u5219\u81EA\u52A8\u521B\u5EFA\u3002",
    parameters: {
      path: { type: "string", description: "\u7B14\u8BB0\u8DEF\u5F84", required: true },
      set: { type: "object", description: "\u8981\u8BBE\u7F6E/\u8986\u76D6\u7684\u5B57\u6BB5\uFF0C\u5982 {tags: ['ai', 'rag'], summary: '...'}" },
      delete: { type: "array", description: "\u8981\u5220\u9664\u7684\u5B57\u6BB5\u540D\u5217\u8868\uFF0C\u5982 ['draft', 'temp']", items: { type: "string" } }
    }
  },
  {
    name: "read_image",
    description: "\u8BFB\u53D6 vault \u4E2D\u7684\u56FE\u7247\u6587\u4EF6\u5E76\u8FD4\u56DE\u56FE\u7247\u5185\u5BB9\uFF08\u81EA\u52A8\u538B\u7F29\uFF09\u3002\u5F53\u7B14\u8BB0\u4E2D\u5305\u542B\u56FE\u7247\u5F15\u7528\uFF08\u5982 ![[photo.png]]\uFF09\u65F6\u4F7F\u7528\u3002\u652F\u6301 png/jpg/jpeg/webp/gif \u683C\u5F0F\u3002\u6BCF\u8F6E\u5BF9\u8BDD\u6700\u591A\u8BFB\u53D6 5 \u5F20\u56FE\u7247\u3002",
    parameters: {
      path: { type: "string", description: "\u56FE\u7247\u5728 vault \u4E2D\u7684\u76F8\u5BF9\u8DEF\u5F84\uFF0C\u5982 attachments/photo.png", required: true }
    }
  }
];
var PODCAST_TOOL_DEFS = [
  {
    name: "podcast_search",
    description: "\u641C\u7D22\u64AD\u5BA2\u8282\u76EE\u3002\u901A\u8FC7 iTunes API \u641C\u7D22\uFF0C\u8FD4\u56DE\u64AD\u5BA2\u540D\u79F0\u3001\u4F5C\u8005\u548C RSS feed URL\u3002",
    parameters: {
      query: { type: "string", description: "\u641C\u7D22\u5173\u952E\u8BCD\uFF0C\u5982 'AI agents' \u6216 'Lex Fridman'", required: true },
      limit: { type: "number", description: "\u8FD4\u56DE\u7ED3\u679C\u6570\u91CF\uFF0C\u9ED8\u8BA4 10" }
    }
  },
  {
    name: "podcast_episodes",
    description: "\u83B7\u53D6\u64AD\u5BA2\u6700\u65B0\u5267\u96C6\u5217\u8868\u3002\u8F93\u5165 RSS feed URL\uFF0C\u8FD4\u56DE\u6700\u8FD1\u51E0\u671F\u7684\u6807\u9898\u3001\u65E5\u671F\u3001\u65F6\u957F\u548C\u94FE\u63A5\u3002",
    parameters: {
      url: { type: "string", description: "\u64AD\u5BA2 RSS feed URL", required: true },
      limit: { type: "number", description: "\u8FD4\u56DE\u5267\u96C6\u6570\u91CF\uFF0C\u9ED8\u8BA4 5" }
    }
  },
  {
    name: "podcast_transcript",
    description: "\u83B7\u53D6\u64AD\u5BA2\u67D0\u4E00\u671F\u7684\u6587\u5B57\u7A3F/transcript\u3002\u652F\u6301 RSS feed URL\uFF08\u9ED8\u8BA4\u6700\u65B0\u4E00\u671F\uFF09\u6216\u76F4\u63A5\u4F20\u5165 YouTube \u89C6\u9891\u94FE\u63A5\u3002\u4F18\u5148\u4ECE RSS \u5185\u5BB9\u63D0\u53D6\uFF0C\u5176\u6B21\u5C1D\u8BD5 YouTube \u5B57\u5E55\u3002",
    parameters: {
      url: { type: "string", description: "\u64AD\u5BA2 RSS feed URL \u6216 YouTube \u89C6\u9891\u94FE\u63A5", required: true },
      episode_index: { type: "number", description: "\u5267\u96C6\u7D22\u5F15\uFF080 = \u6700\u65B0\u4E00\u671F\uFF09\uFF0C\u4EC5\u5728 url \u4E3A RSS feed \u65F6\u6709\u6548" }
    }
  }
];
var WEB_FETCH_TOOL_DEF = {
  name: "web_fetch",
  description: "\u6293\u53D6\u6307\u5B9A URL \u7684\u7F51\u9875\u5185\u5BB9\uFF0C\u8FD4\u56DE\u7EAF\u6587\u672C\u3002\u7528\u4E8E\u9605\u8BFB\u641C\u7D22\u7ED3\u679C\u4E2D\u7684\u5177\u4F53\u9875\u9762\u3001\u6587\u7AE0\u6216\u6587\u6863\u3002",
  parameters: {
    url: { type: "string", description: "\u8981\u6293\u53D6\u7684\u5B8C\u6574 URL", required: true }
  }
};
var WEREAD_TOOL_DEF = {
  name: "weread_api",
  description: "\u8C03\u7528\u5FAE\u4FE1\u8BFB\u4E66 API\u3002\u641C\u7D22\u4E66\u7C4D\u3001\u83B7\u53D6\u4E66\u67B6\u3001\u67E5\u770B\u7B14\u8BB0\u5212\u7EBF\u3001\u4E66\u8BC4\u3001\u9605\u8BFB\u7EDF\u8BA1\u3001\u63A8\u8350\u7B49\u3002\u901A\u8FC7 api_name \u6307\u5B9A\u63A5\u53E3\uFF0C\u5176\u4F59\u53C2\u6570\u5E73\u94FA\u4F20\u5165\u3002",
  parameters: {
    api_name: { type: "string", description: "API \u8DEF\u5F84\uFF0C\u5982 /store/search, /shelf/sync, /user/notebooks, /book/bookmarklist, /readdata/detail \u7B49", required: true }
  }
};
var FEED_TOOL_DEFS = [
  {
    name: "fetch_feeds",
    description: "\u4ECE\u914D\u7F6E\u7684\u8BA2\u9605\u6E90\uFF08RSS/HN/Reddit/GitHub Trending/Podcast\uFF09\u6279\u91CF\u6293\u53D6\u6700\u65B0\u6587\u7AE0\uFF0C\u81EA\u52A8\u8BC4\u5206\u6392\u5E8F\u53BB\u91CD\u3002\u8FD4\u56DE\u7ED3\u6784\u5316\u6587\u7AE0\u5217\u8868\u3002",
    parameters: {
      topics: { type: "string", description: "\u5173\u6CE8\u4E3B\u9898\uFF08\u9017\u53F7\u5206\u9694\uFF09\uFF0C\u7528\u4E8E\u76F8\u5173\u6027\u8BC4\u5206\u3002\u5982 'RAG,Agent,\u591A\u6A21\u6001'" },
      max_articles: { type: "number", description: "\u8FD4\u56DE\u6700\u5927\u6587\u7AE0\u6570\uFF08\u9ED8\u8BA4 20\uFF09" },
      category: { type: "string", description: "\u6309\u5206\u7C7B\u7B5B\u9009\uFF1Aresearch/engineering/community/tools/podcast/newsletter/industry" }
    }
  },
  {
    name: "fetch_rss",
    description: "\u6293\u53D6\u6307\u5B9A URL \u7684 RSS/Atom feed\uFF0C\u8FD4\u56DE\u6587\u7AE0\u5217\u8868\u3002\u53EF\u7528\u4E8E\u6293\u53D6\u4EFB\u610F RSS \u6E90\uFF08\u4E0D\u9650\u4E8E\u914D\u7F6E\u7684\u8BA2\u9605\u6E90\uFF09\u3002",
    parameters: {
      url: { type: "string", description: "RSS/Atom feed URL", required: true },
      name: { type: "string", description: "\u6E90\u540D\u79F0\uFF08\u7528\u4E8E\u663E\u793A\uFF09" },
      limit: { type: "number", description: "\u8FD4\u56DE\u6700\u5927\u6761\u76EE\u6570\uFF08\u9ED8\u8BA4 10\uFF09" }
    }
  }
];
function toAnthropicTool(def) {
  const properties = {};
  const required = [];
  for (const [key, param] of Object.entries(def.parameters)) {
    const { required: isReq, ...rest } = param;
    properties[key] = rest;
    if (isReq) required.push(key);
  }
  return {
    name: def.name,
    description: def.description,
    input_schema: {
      type: "object",
      properties,
      required,
      ...def.name === "weread_api" ? { additionalProperties: true } : {}
    }
  };
}
function toClaudeCodeDescription(def) {
  const params = Object.entries(def.parameters).map(([k, v]) => `${k}: ${v.description}`).join("\uFF0C");
  return `- ${def.name}: ${def.description.split("\u3002")[0]}\uFF08${params}\uFF09`;
}
function toolSummaryForPrompt() {
  return TOOL_DEFS.map((d) => toClaudeCodeDescription(d)).join("\n");
}

// src/claude.ts
var STREAM_CHUNK_SIZE = 6;
var STREAM_CHUNK_DELAY_MS = 22;
var API_URL = "https://api.anthropic.com/v1/messages";
var ANTHROPIC_VERSION = "2023-06-01";
var MAX_TOKENS = 4096;
var COMPRESS_MAX_OUTPUT_TOKENS = 2048;
var COMPRESS_BLOB_MAX_CHARS = 12e4;
var RETRY_MAX = 3;
var RETRY_BASE_MS = 15e3;
var REQUEST_TIMEOUT_MS = 18e4;
function isRetryableStatus(status) {
  return status === 429 || status === 529;
}
async function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(
      (_, reject) => setTimeout(() => reject(new Error(`\u8BF7\u6C42\u8D85\u65F6\uFF08${Math.round(ms / 1e3)}s\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5`)), ms)
    )
  ]);
}
function retryDelayMs(attempt, status, retryAfterHeader) {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (!Number.isNaN(secs) && secs > 0) return secs * 1e3;
  }
  const delay = RETRY_BASE_MS * Math.pow(2, attempt);
  console.warn(`[ai-daily] API ${status}, retrying in ${delay / 1e3}s (attempt ${attempt + 1}/${RETRY_MAX})`);
  return delay;
}
async function emitTypewriterText(text, onTextDelta) {
  let pos = 0;
  while (pos < text.length) {
    const chunk = text.slice(pos, pos + STREAM_CHUNK_SIZE);
    onTextDelta(chunk);
    pos += STREAM_CHUNK_SIZE;
    if (pos < text.length) {
      await new Promise((r) => setTimeout(r, STREAM_CHUNK_DELAY_MS));
    }
  }
}
var TextDeltaTypewriter = class {
  constructor(onTextDelta) {
    this.onTextDelta = onTextDelta;
    this.queue = Promise.resolve();
  }
  enqueue(text) {
    if (!text) return;
    this.queue = this.queue.then(
      () => emitTypewriterText(text, this.onTextDelta)
    );
  }
  async flush() {
    await this.queue;
  }
};
var WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5
};
var WEB_FETCH_TOOL = toAnthropicTool(WEB_FETCH_TOOL_DEF);
var WEREAD_TOOL = toAnthropicTool(WEREAD_TOOL_DEF);
var PODCAST_TOOLS = PODCAST_TOOL_DEFS.map(toAnthropicTool);
var FEED_TOOLS = FEED_TOOL_DEFS.map(toAnthropicTool);
var VAULT_TOOLS = TOOL_DEFS.map(toAnthropicTool);
function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
function messageContentToString(content) {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}
function estimateMessagesTokens(messages, systemPrompt) {
  let n = estimateTextTokens(systemPrompt);
  for (const m of messages) {
    n += estimateTextTokens(messageContentToString(m.content)) + 4;
  }
  return n;
}
async function callClaudeSimple(options) {
  var _a;
  const { apiKey, model, systemPrompt, userMessage, maxTokens = MAX_TOKENS } = options;
  const bodyObj = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: userMessage }],
    stream: true
  };
  if (systemPrompt) {
    bodyObj.system = [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];
  }
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(bodyObj)
    });
    if (isRetryableStatus(res.status) && attempt < RETRY_MAX) {
      await sleepMs(retryDelayMs(attempt, res.status, (_a = res.headers.get("retry-after")) != null ? _a : void 0));
      continue;
    }
    break;
  }
  if (!res.ok) {
    let errText = "";
    try {
      errText = await res.text();
    } catch (e) {
    }
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 500)}`);
  }
  if (!res.body) {
    throw new Error("Claude API: response has no body (no ReadableStream)");
  }
  const assembler = new AnthropicStreamAssembler({});
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) assembler.push(text);
    }
    const tail = decoder.decode();
    if (tail) assembler.push(tail);
  } finally {
    try {
      reader.releaseLock();
    } catch (e) {
    }
  }
  const response = assembler.finalize();
  for (const block of response.content) {
    if (block.type === "text") return block.text;
  }
  return "";
}
function buildToolsArray(enableWebSearch, enableWeRead = false, enablePodcast = false, enableFeeds = false) {
  const tools = [...VAULT_TOOLS];
  if (enableWebSearch) {
    tools.push(WEB_SEARCH_TOOL, WEB_FETCH_TOOL);
  }
  if (enableWeRead) {
    tools.push(WEREAD_TOOL);
  }
  if (enablePodcast) {
    tools.push(...PODCAST_TOOLS);
  }
  if (enableFeeds) {
    tools.push(...FEED_TOOLS);
  }
  if (tools.length > 0) {
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } };
  }
  return tools;
}
var ClaudeClient = class {
  constructor(apiKey, model, systemPrompt, options) {
    this.messages = [];
    this.abortController = null;
    this.proxySessionIds = {};
    this.proxyTaskIds = {};
    var _a, _b, _c, _d, _e, _f, _g, _h;
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.streamMode = (_a = options == null ? void 0 : options.streamMode) != null ? _a : "auto";
    this.enableWebSearch = (_b = options == null ? void 0 : options.enableWebSearch) != null ? _b : false;
    this.enableWeRead = (_c = options == null ? void 0 : options.enableWeRead) != null ? _c : false;
    this.enablePodcast = (_d = options == null ? void 0 : options.enablePodcast) != null ? _d : false;
    this.enableFeeds = (_e = options == null ? void 0 : options.enableFeeds) != null ? _e : false;
    this.compressThresholdEst = (_f = options == null ? void 0 : options.compressThresholdEst) != null ? _f : 9e4;
    this.compressKeepMessages = Math.max(
      2,
      (_g = options == null ? void 0 : options.compressKeepMessages) != null ? _g : 8
    );
    this.onCompress = options == null ? void 0 : options.onCompress;
    this.onStreamFallback = options == null ? void 0 : options.onStreamFallback;
    const rawUrl = (_h = options == null ? void 0 : options.proxyUrl) == null ? void 0 : _h.trim();
    this.proxyUrl = rawUrl && !/^https?:\/\//i.test(rawUrl) ? `https://${rawUrl}` : rawUrl;
    this.proxyToken = options == null ? void 0 : options.proxyToken;
  }
  getProxySessionId(backend) {
    return this.proxySessionIds[backend];
  }
  setProxySessionId(backend, id) {
    this.proxySessionIds[backend] = id;
  }
  clearProxySessionId(backend) {
    if (backend) {
      delete this.proxySessionIds[backend];
      delete this.proxyTaskIds[backend];
    } else {
      this.proxySessionIds = {};
      this.proxyTaskIds = {};
    }
  }
  getProxyTaskId(backend) {
    return this.proxyTaskIds[backend];
  }
  setProxyTaskId(backend, id) {
    this.proxyTaskIds[backend] = id;
  }
  isProxyMode() {
    return !!(this.proxyUrl && this.proxyToken);
  }
  getModel() {
    return this.model;
  }
  getMessagesSnapshot() {
    return this.messages.map(
      (m) => typeof m.content === "string" ? { role: m.role, content: m.content } : {
        role: m.role,
        content: JSON.parse(
          JSON.stringify(m.content)
        )
      }
    );
  }
  setHistoryFromStrings(turns) {
    this.messages = turns.map((t) => ({
      role: t.role,
      content: t.content
    }));
  }
  estimateContextTokens() {
    return estimateMessagesTokens(this.messages, this.systemPrompt);
  }
  abort() {
    var _a;
    (_a = this.abortController) == null ? void 0 : _a.abort();
    this.abortController = null;
  }
  async chat(userMessage, executeTool, onAssistantDelta, images, onToolCall) {
    var _a, _b;
    if (images && images.length > 0) {
      const content = images.map((img) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
          data: img.base64
        }
      }));
      content.push({ type: "text", text: userMessage });
      this.messages.push({
        role: "user",
        content
      });
    } else {
      this.messages.push({ role: "user", content: userMessage });
    }
    await this.maybeCompressHistory();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const collectedText = [];
    let priorAssistantText = "";
    try {
      while (true) {
        if (signal.aborted) break;
        let roundStream = "";
        const onDelta = onAssistantDelta ? (d) => {
          roundStream += d;
          onAssistantDelta(d, priorAssistantText + roundStream);
        } : void 0;
        this.stripImageData();
        const response = await this.callApi(onDelta, signal);
        const u = response.usage;
        if (u.cache_read_input_tokens || u.cache_creation_input_tokens) {
          console.log(`[ai-daily] cache: read=${(_a = u.cache_read_input_tokens) != null ? _a : 0} created=${(_b = u.cache_creation_input_tokens) != null ? _b : 0} input=${u.input_tokens}`);
        }
        let roundText = "";
        for (const block of response.content) {
          if (block.type === "text") {
            collectedText.push(block.text);
            roundText += block.text;
          }
        }
        priorAssistantText += roundText;
        if (response.stop_reason === "end_turn") {
          this.messages.push({
            role: "assistant",
            content: response.content
          });
          break;
        }
        const toolUses = response.content.filter(
          (b) => b.type === "tool_use"
        );
        if (toolUses.length === 0) {
          this.messages.push({
            role: "assistant",
            content: response.content
          });
          break;
        }
        this.messages.push({
          role: "assistant",
          content: response.content
        });
        const results = [];
        for (const tool of toolUses) {
          if (signal.aborted) break;
          onToolCall == null ? void 0 : onToolCall(tool.name, tool.input, "start");
          try {
            const result = await executeTool(tool.name, tool.input);
            onToolCall == null ? void 0 : onToolCall(tool.name, tool.input, "done");
            results.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: result
            });
          } catch (e) {
            onToolCall == null ? void 0 : onToolCall(tool.name, tool.input, "error");
            results.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: `Error: ${e instanceof Error ? e.message : String(e)}`,
              is_error: true
            });
          }
        }
        this.messages.push({ role: "user", content: results });
      }
    } catch (e) {
      if (signal.aborted) {
        if (collectedText.length > 0) {
          this.messages.push({ role: "assistant", content: collectedText.join("") });
        }
        return collectedText.join("");
      }
      throw e;
    } finally {
      this.abortController = null;
    }
    return collectedText.join("");
  }
  async proxyChat(userMessage, onAssistantDelta, onToolCall, seedHistory, proxyBackend, proxyModel, codexPermissionMode, reasoningEffort, onStatus, images) {
    var _a;
    if (!this.proxyUrl || !this.proxyToken) {
      throw new Error("Proxy mode not configured");
    }
    this.messages.push({ role: "user", content: userMessage });
    const backend = proxyBackend != null ? proxyBackend : "claude-code";
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    try {
      const body = { message: userMessage };
      if (proxyBackend) {
        body.backend = proxyBackend;
      }
      if (proxyModel) {
        body.model = proxyModel;
      }
      if (proxyBackend === "codex" && codexPermissionMode) {
        body.codexPermissionMode = codexPermissionMode;
      }
      if (reasoningEffort) {
        body.reasoningEffort = reasoningEffort;
      }
      if (images == null ? void 0 : images.length) {
        body.images = images;
      }
      if (this.proxySessionIds[backend]) {
        body.sessionId = this.proxySessionIds[backend];
      } else {
        body.systemPrompt = this.systemPrompt;
        if (seedHistory == null ? void 0 : seedHistory.length) {
          body.history = seedHistory;
        }
      }
      const PROXY_RETRY_MAX = 2;
      let resp = null;
      let lastError = null;
      for (let attempt = 0; attempt <= PROXY_RETRY_MAX; attempt++) {
        if (signal.aborted) break;
        try {
          resp = await fetch(`${this.proxyUrl}/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.proxyToken}`
            },
            body: JSON.stringify(body),
            signal
          });
          if (resp.ok) break;
          const errText = await resp.text();
          lastError = new Error(`Proxy error ${resp.status}: ${errText}`);
          if (resp.status >= 400 && resp.status < 500) throw lastError;
        } catch (e) {
          if (signal.aborted) throw e;
          lastError = e instanceof Error ? e : new Error(String(e));
          if (e instanceof Error && e.name === "AbortError") throw e;
        }
        if (attempt < PROXY_RETRY_MAX) {
          const delay = 3e3 * (attempt + 1);
          console.warn(`[ai-daily] proxy retry ${attempt + 1}/${PROXY_RETRY_MAX} in ${delay / 1e3}s`);
          await sleepMs(delay);
        }
      }
      if (!(resp == null ? void 0 : resp.ok)) {
        throw lastError || new Error("Proxy request failed");
      }
      const reader = (_a = resp.body) == null ? void 0 : _a.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let receivedDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          let event;
          try {
            event = JSON.parse(jsonStr);
          } catch (e) {
            continue;
          }
          if (event.type === "task_id" && event.taskId) {
            this.proxyTaskIds[backend] = event.taskId;
          } else if (event.type === "text" && event.content) {
            accumulated += event.content;
            onAssistantDelta == null ? void 0 : onAssistantDelta(event.content, accumulated);
          } else if (event.type === "tool_use" && event.name) {
            if (event.status) {
              onToolCall == null ? void 0 : onToolCall(event.name, event.input || {}, event.status);
            } else {
              onToolCall == null ? void 0 : onToolCall(event.name, event.input || {}, "start");
              onToolCall == null ? void 0 : onToolCall(event.name, event.input || {}, "done");
            }
          } else if (event.type === "status" && event.message) {
            onStatus == null ? void 0 : onStatus(event.message);
          } else if (event.type === "done") {
            receivedDone = true;
            if (event.sessionId) {
              this.proxySessionIds[backend] = event.sessionId;
            }
            if (event.result) {
              accumulated = event.result;
            }
          } else if (event.type === "error") {
            throw new Error(`Proxy: ${event.message || "unknown error"}`);
          }
        }
      }
      if (!receivedDone && this.proxyTaskIds[backend] && this.proxyUrl) {
        try {
          const recovered = await this.recoverFromTask(backend, signal);
          if (recovered !== null) {
            accumulated = recovered;
          }
        } catch (e) {
          console.warn("[ai-daily] SSE truncation recovery failed, using partial content");
        }
      }
      this.messages.push({ role: "assistant", content: accumulated });
      return accumulated;
    } catch (e) {
      if (signal.aborted) {
        return "";
      }
      throw e;
    } finally {
      this.abortController = null;
    }
  }
  async recoverFromTask(backend, signal) {
    const taskId = this.proxyTaskIds[backend];
    if (!taskId || !this.proxyUrl) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5e3);
    try {
      const resp = await fetch(`${this.proxyUrl}/task/${taskId}`, {
        headers: { Authorization: `Bearer ${this.proxyToken}` },
        signal: signal != null ? signal : controller.signal
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.sessionId) this.proxySessionIds[backend] = data.sessionId;
      if (data.status === "done" && data.result) return data.result;
      return null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  clearHistory() {
    this.messages = [];
  }
  rewindLastTurn() {
    if (this.messages.length < 2) return false;
    while (this.messages.length > 0) {
      const last = this.messages[this.messages.length - 1];
      const isToolResult = last.role === "user" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
      const isAssistant = last.role === "assistant";
      if (!isToolResult && !isAssistant) break;
      this.messages.pop();
    }
    if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === "user") {
      this.messages.pop();
    }
    return true;
  }
  stripImageData() {
    const lastIdx = this.messages.length - 1;
    for (let mi = 0; mi < this.messages.length; mi++) {
      if (mi === lastIdx) continue;
      const msg = this.messages[mi];
      if (typeof msg.content === "string" || !Array.isArray(msg.content)) continue;
      for (let i = msg.content.length - 1; i >= 0; i--) {
        const block = msg.content[i];
        if (block.type === "image") {
          msg.content.splice(i, 1, {
            type: "text",
            text: "[\u56FE\u7247\u5DF2\u53D1\u9001\uFF0C\u5DF2\u4ECE\u4E0A\u4E0B\u6587\u4E2D\u79FB\u9664\u4EE5\u8282\u7701\u7A7A\u95F4]"
          });
        } else if (block.type === "tool_result") {
          const inner = block.content;
          if (Array.isArray(inner)) {
            block.content = inner.filter((b) => b.type !== "image");
            if (block.content.length === 0) {
              block.content = "[\u56FE\u7247\u5DF2\u53D1\u9001\uFF0C\u5DF2\u4ECE\u4E0A\u4E0B\u6587\u4E2D\u79FB\u9664\u4EE5\u8282\u7701\u7A7A\u95F4]";
            }
          }
        }
      }
    }
  }
  async maybeCompressHistory() {
    var _a, _b;
    const threshold = this.compressThresholdEst;
    if (threshold <= 0) return;
    if (this.messages.length <= this.compressKeepMessages) return;
    const est = estimateMessagesTokens(this.messages, this.systemPrompt);
    if (est < threshold) return;
    const toCompress = this.messages.slice(
      0,
      this.messages.length - this.compressKeepMessages
    );
    const kept = this.messages.slice(-this.compressKeepMessages);
    let blob = "";
    for (const m of toCompress) {
      const prefix = m.role === "user" ? "\u7528\u6237" : "\u52A9\u624B";
      blob += `${prefix}: ${messageContentToString(m.content)}

`;
    }
    let summary;
    try {
      summary = await callClaudeSimple({
        apiKey: this.apiKey,
        model: "claude-haiku-4-5",
        systemPrompt: "",
        userMessage: "\u8BF7\u5C06\u4EE5\u4E0B\u5BF9\u8BDD\u538B\u7F29\u4E3A\u7B80\u6D01\u7684\u4E2D\u6587\u6458\u8981\uFF0C\u4FDD\u7559\u5173\u952E\u4E8B\u5B9E\u3001\u51B3\u5B9A\u4E0E\u5F85\u529E\uFF0C\u7701\u7565\u5BD2\u6684\u3002\u4E0D\u8D85\u8FC7 900 \u5B57\u3002\n\n" + blob.slice(0, COMPRESS_BLOB_MAX_CHARS),
        maxTokens: COMPRESS_MAX_OUTPUT_TOKENS
      });
    } catch (e) {
      (_a = this.onCompress) == null ? void 0 : _a.call(
        this,
        `\u6458\u8981\u5931\u8D25\uFF0C\u5DF2\u622A\u65AD\u6700\u65E9 ${toCompress.length} \u6761\u6D88\u606F: ${e instanceof Error ? e.message : String(e)}`
      );
      this.messages = kept;
      return;
    }
    this.messages = [
      {
        role: "user",
        content: "[\u6B64\u524D\u5BF9\u8BDD\u6458\u8981\uFF0C\u4E3A\u8282\u7701\u4E0A\u4E0B\u6587\u7531\u7CFB\u7EDF\u81EA\u52A8\u751F\u6210]\n\n" + summary
      },
      ...kept
    ];
    (_b = this.onCompress) == null ? void 0 : _b.call(
      this,
      `\u4E0A\u4E0B\u6587\u8F83\u957F\uFF0C\u5DF2\u5C06\u6B64\u524D ${toCompress.length} \u6761\u6D88\u606F\u538B\u7F29\u4E3A\u6458\u8981\u3002`
    );
  }
  // ── Streaming dispatch ──────────────────────────────────────────
  async callApi(onTextDelta, signal) {
    var _a;
    if (this.streamMode === "off") {
      return this.callApiNonStreaming(signal);
    }
    if (this.streamMode === "auto" || this.streamMode === "real") {
      try {
        return await this.callApiRealStream(onTextDelta, signal);
      } catch (e) {
        if (signal == null ? void 0 : signal.aborted) throw e;
        if (this.streamMode === "real") {
          throw e;
        }
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          "[ai-daily] real stream failed, falling back to typewriter:",
          msg
        );
        (_a = this.onStreamFallback) == null ? void 0 : _a.call(this, msg);
      }
    }
    return this.callApiTypewriter(onTextDelta, signal);
  }
  async callApiRealStream(onTextDelta, signal) {
    var _a;
    const body = { ...this.buildRequestBody(), stream: true };
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify(body),
        signal
      });
      if (isRetryableStatus(res.status) && attempt < RETRY_MAX) {
        await sleepMs(retryDelayMs(attempt, res.status, (_a = res.headers.get("retry-after")) != null ? _a : void 0));
        continue;
      }
      break;
    }
    if (!res.ok) {
      let errText = "";
      try {
        errText = await res.text();
      } catch (e) {
      }
      throw new Error(
        `Claude API stream HTTP ${res.status}: ${errText.slice(0, 500)}`
      );
    }
    if (!res.body) {
      throw new Error(
        "Claude API stream: response has no body (no ReadableStream)"
      );
    }
    const visualTypewriter = onTextDelta ? new TextDeltaTypewriter(onTextDelta) : null;
    const assembler = new AnthropicStreamAssembler({
      onTextDelta: visualTypewriter ? (delta) => visualTypewriter.enqueue(delta) : void 0
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text) assembler.push(text);
      }
      const tail = decoder.decode();
      if (tail) assembler.push(tail);
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
      }
    }
    const response = assembler.finalize();
    await (visualTypewriter == null ? void 0 : visualTypewriter.flush());
    return response;
  }
  buildRequestBody() {
    const messages = this.messages.map((m) => ({ ...m }));
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "user") continue;
      if (typeof m.content === "string") {
        m.content = [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }];
      } else if (Array.isArray(m.content) && m.content.length > 0) {
        const last = { ...m.content[m.content.length - 1], cache_control: { type: "ephemeral" } };
        m.content = [...m.content.slice(0, -1), last];
      }
      break;
    }
    return {
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: this.systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: buildToolsArray(this.enableWebSearch, this.enableWeRead, this.enablePodcast, this.enableFeeds),
      messages
    };
  }
  async callApiNonStreaming(signal) {
    var _a;
    const body = this.buildRequestBody();
    for (let attempt = 0; ; attempt++) {
      if (signal == null ? void 0 : signal.aborted) throw new DOMException("Aborted", "AbortError");
      const resp = await withTimeout((0, import_obsidian4.requestUrl)({
        url: API_URL,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION
        },
        body: JSON.stringify(body)
      }), REQUEST_TIMEOUT_MS);
      if (isRetryableStatus(resp.status) && attempt < RETRY_MAX) {
        await sleepMs(retryDelayMs(attempt, resp.status, (_a = resp.headers) == null ? void 0 : _a["retry-after"]));
        continue;
      }
      if (resp.status >= 400) {
        throw new Error(`Claude API error ${resp.status}: ${resp.text}`);
      }
      const json = resp.json;
      if (!json || !Array.isArray(json.content)) {
        throw new Error("Claude API: unexpected response format");
      }
      return json;
    }
  }
  async callApiTypewriter(onTextDelta, signal) {
    const response = await this.callApiNonStreaming(signal);
    if (onTextDelta) {
      const fullText = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (fullText) await emitTypewriterText(fullText, onTextDelta);
    }
    return response;
  }
};

// src/vault-tools.ts
var import_obsidian5 = require("obsidian");
var MAX_SEARCH_RESULTS = 10;
var KNOWLEDGE_CONTEXT_TRUNCATE = 2e3;
var MAX_UNDO_HISTORY = 20;
var VaultTools = class {
  constructor(app, knowledgeFolders = []) {
    this.undoHistory = [];
    this.undoIdCounter = 0;
    this.app = app;
    this.knowledgeFolders = knowledgeFolders;
  }
  pushUndo(toolName, path, description, undoFn) {
    this.undoHistory.push({
      id: this.undoIdCounter++,
      toolName,
      path,
      description,
      timestamp: Date.now(),
      undo: undoFn
    });
    if (this.undoHistory.length > MAX_UNDO_HISTORY) {
      this.undoHistory.shift();
    }
  }
  getUndoHistory() {
    return [...this.undoHistory];
  }
  async undoLast() {
    const entry = this.undoHistory.pop();
    if (!entry) return null;
    return entry.undo();
  }
  async undoById(id) {
    const idx = this.undoHistory.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const entry = this.undoHistory.splice(idx, 1)[0];
    return entry.undo();
  }
  clearUndoHistory() {
    this.undoHistory = [];
  }
  async execute(name, input) {
    switch (name) {
      case "read_note": {
        const path = typeof input.path === "string" ? input.path : "";
        if (!path) return "Error: path is required";
        if (containsTraversal(path)) return "Error: invalid path";
        return this.readNote(path);
      }
      case "search_vault": {
        const query = typeof input.query === "string" ? input.query : "";
        if (!query) return "Error: query is required";
        const folder = typeof input.folder === "string" ? input.folder : void 0;
        const tag = typeof input.tag === "string" ? input.tag : void 0;
        return this.searchVault(query, folder, tag);
      }
      case "append_to_note": {
        const path = typeof input.path === "string" ? input.path : "";
        const content = typeof input.content === "string" ? input.content : "";
        if (!path || !content) return "Error: path and content are required";
        if (containsTraversal(path)) return "Error: invalid path";
        return this.appendToNote(path, content);
      }
      case "list_notes": {
        const folder = typeof input.folder === "string" ? input.folder : void 0;
        const limit = typeof input.limit === "number" ? input.limit : 20;
        return this.listNotes(folder, limit);
      }
      case "create_note": {
        const path = typeof input.path === "string" ? input.path : "";
        const content = typeof input.content === "string" ? input.content : "";
        if (!path) return "Error: path is required";
        if (containsTraversal(path)) return "Error: invalid path";
        const frontmatter = typeof input.frontmatter === "object" && input.frontmatter !== null ? input.frontmatter : void 0;
        return this.createNote(path, content, frontmatter);
      }
      case "edit_note": {
        const path = typeof input.path === "string" ? input.path : "";
        const mode = typeof input.mode === "string" ? input.mode : "";
        const replacement = typeof input.replacement === "string" ? input.replacement : "";
        if (!path || !mode) return "Error: path and mode are required";
        if (containsTraversal(path)) return "Error: invalid path";
        return this.editNote(path, mode, input.target, replacement);
      }
      case "rename_note": {
        const path = typeof input.path === "string" ? input.path : "";
        const newPath = typeof input.new_path === "string" ? input.new_path : "";
        if (!path || !newPath) return "Error: path and new_path are required";
        if (containsTraversal(path) || containsTraversal(newPath)) return "Error: invalid path";
        return this.renameNote(path, newPath);
      }
      case "delete_note": {
        const path = typeof input.path === "string" ? input.path : "";
        const confirmed = input.confirmed === true;
        if (!path) return "Error: path is required";
        if (containsTraversal(path)) return "Error: invalid path";
        return this.deleteNote(path, confirmed);
      }
      case "get_links": {
        const path = typeof input.path === "string" ? input.path : "";
        if (!path) return "Error: path is required";
        if (containsTraversal(path)) return "Error: invalid path";
        return this.getLinks(path);
      }
      case "update_frontmatter": {
        const path = typeof input.path === "string" ? input.path : "";
        if (!path) return "Error: path is required";
        if (containsTraversal(path)) return "Error: invalid path";
        const set = typeof input.set === "object" && input.set !== null ? input.set : void 0;
        const del = Array.isArray(input.delete) ? input.delete.filter((s) => typeof s === "string") : void 0;
        if (!set && !del) return "Error: at least one of set or delete is required";
        return this.updateFrontmatter(path, set, del);
      }
      default:
        return `Unknown tool: ${name}`;
    }
  }
  async readNote(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) {
      return `File not found: ${path}`;
    }
    return this.app.vault.cachedRead(file);
  }
  getTagsFromCache(file) {
    var _a;
    const cache = this.app.metadataCache.getFileCache(file);
    if (!((_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a.tags)) return [];
    const raw = cache.frontmatter.tags;
    if (Array.isArray(raw)) {
      return raw.map((t) => String(t).toLowerCase().replace(/^#/, ""));
    }
    if (typeof raw === "string") {
      return raw.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean);
    }
    return [];
  }
  async searchVault(query, folder, tag) {
    const lowerQuery = query.toLowerCase();
    const lowerTag = tag == null ? void 0 : tag.toLowerCase().replace(/^#/, "");
    const results = [];
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (folder && !file.path.startsWith(folder)) continue;
      if (lowerTag) {
        const tags = this.getTagsFromCache(file);
        if (!tags.includes(lowerTag)) continue;
      }
      const content = await this.app.vault.cachedRead(file);
      const lowerContent = content.toLowerCase();
      const idx = lowerContent.indexOf(lowerQuery);
      if (idx !== -1) {
        const start = Math.max(0, idx - 50);
        const end = Math.min(content.length, idx + query.length + 100);
        const snippet = content.slice(start, end).replace(/\n/g, " ");
        results.push({ path: file.path, snippet: `...${snippet}...` });
      }
      if (results.length >= MAX_SEARCH_RESULTS) break;
    }
    if (results.length === 0) return `No results for "${query}"${tag ? ` with tag #${lowerTag}` : ""}`;
    return results.map((r) => `**${r.path}**
${r.snippet}`).join("\n\n");
  }
  async appendToNote(path, content) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) {
      return `File not found: ${path}`;
    }
    const originalContent = await this.app.vault.cachedRead(file);
    await this.app.vault.append(file, "\n\n" + content);
    this.pushUndo("append_to_note", path, `\u8FFD\u52A0\u5185\u5BB9\u5230 ${path}`, async () => {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof import_obsidian5.TFile)) return `\u64A4\u9500\u5931\u8D25: \u6587\u4EF6\u4E0D\u5B58\u5728 ${path}`;
      await this.app.vault.modify(f, originalContent);
      return `\u5DF2\u64A4\u9500\u8FFD\u52A0: ${path}`;
    });
    return `Content appended to ${path}`;
  }
  async listNotes(folder, limit = 20) {
    const foldersToList = folder ? [folder] : [...this.knowledgeFolders];
    const allFiles = this.app.vault.getMarkdownFiles().filter(
      (f) => foldersToList.some((dir) => f.path.startsWith(dir + "/") || f.path.startsWith(dir))
    );
    if (allFiles.length === 0) {
      return folder ? `Folder not found or empty: ${folder}` : "No notes found in configured folders.";
    }
    const sorted = allFiles.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, limit);
    return sorted.map((f) => f.path).join("\n");
  }
  async createNote(path, content, frontmatter) {
    const normalized = (0, import_obsidian5.normalizePath)(path);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing) {
      return `Error: file already exists: ${normalized}`;
    }
    let body = content;
    if (frontmatter && Object.keys(frontmatter).length > 0) {
      body = serializeFrontmatter(frontmatter) + content;
    }
    const dir = normalized.substring(0, normalized.lastIndexOf("/"));
    if (dir) {
      await this.ensureFolder(dir);
    }
    await this.app.vault.create(normalized, body);
    this.pushUndo("create_note", normalized, `\u521B\u5EFA\u7B14\u8BB0 ${normalized}`, async () => {
      const f = this.app.vault.getAbstractFileByPath(normalized);
      if (!(f instanceof import_obsidian5.TFile)) return `\u64A4\u9500\u5931\u8D25: \u6587\u4EF6\u4E0D\u5B58\u5728 ${normalized}`;
      await this.app.vault.trash(f, true);
      return `\u5DF2\u64A4\u9500\u521B\u5EFA (\u79FB\u5165\u56DE\u6536\u7AD9): ${normalized}`;
    });
    return `Created: ${normalized}`;
  }
  async editNote(path, mode, target, replacement) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) {
      return `File not found: ${path}`;
    }
    const content = await this.app.vault.cachedRead(file);
    const recordUndo = (desc) => {
      const originalContent = content;
      this.pushUndo("edit_note", path, desc, async () => {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof import_obsidian5.TFile)) return `\u64A4\u9500\u5931\u8D25: \u6587\u4EF6\u4E0D\u5B58\u5728 ${path}`;
        await this.app.vault.modify(f, originalContent);
        return `\u5DF2\u64A4\u9500\u7F16\u8F91: ${path}`;
      });
    };
    switch (mode) {
      case "search_replace": {
        const search = typeof target === "string" ? target : "";
        if (!search) return "Error: target string is required for search_replace mode";
        const idx = content.indexOf(search);
        if (idx === -1) return `Error: target text not found in ${path}`;
        const newContent = content.substring(0, idx) + replacement + content.substring(idx + search.length);
        await this.app.vault.modify(file, newContent);
        recordUndo(`\u66FF\u6362\u6587\u672C in ${path}`);
        return `Replaced text in ${path}`;
      }
      case "heading": {
        const heading = typeof target === "string" ? target : "";
        if (!heading) return "Error: target heading is required for heading mode";
        const { start, end } = findHeadingRange(content, heading);
        if (start === -1) return `Error: heading "${heading}" not found in ${path}`;
        const newContent = content.substring(0, start) + replacement + content.substring(end);
        await this.app.vault.modify(file, newContent);
        recordUndo(`\u66FF\u6362\u6807\u9898\u6BB5 "${heading}" in ${path}`);
        return `Replaced heading section "${heading}" in ${path}`;
      }
      case "line_range": {
        if (typeof target !== "object" || target === null) {
          return "Error: target must be {start, end} for line_range mode";
        }
        const t = target;
        const startLine = typeof t.start === "number" ? t.start : -1;
        const endLine = typeof t.end === "number" ? t.end : -1;
        if (startLine < 1 || endLine < startLine) {
          return "Error: invalid line range (start >= 1, end >= start)";
        }
        const lines = content.split("\n");
        if (startLine > lines.length) {
          return `Error: start line ${startLine} exceeds file length (${lines.length} lines)`;
        }
        const before = lines.slice(0, startLine - 1);
        const after = lines.slice(Math.min(endLine, lines.length));
        const newContent = [...before, replacement, ...after].join("\n");
        await this.app.vault.modify(file, newContent);
        recordUndo(`\u66FF\u6362\u884C ${startLine}-${endLine} in ${path}`);
        return `Replaced lines ${startLine}-${endLine} in ${path}`;
      }
      default:
        return `Error: unknown edit mode "${mode}". Use heading, line_range, or search_replace`;
    }
  }
  async renameNote(path, newPath) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) {
      return `File not found: ${path}`;
    }
    const normalizedNew = (0, import_obsidian5.normalizePath)(newPath);
    const existingTarget = this.app.vault.getAbstractFileByPath(normalizedNew);
    if (existingTarget) {
      return `Error: target path already exists: ${normalizedNew}`;
    }
    const dir = normalizedNew.substring(0, normalizedNew.lastIndexOf("/"));
    if (dir) {
      await this.ensureFolder(dir);
    }
    await this.app.fileManager.renameFile(file, normalizedNew);
    this.pushUndo("rename_note", normalizedNew, `\u91CD\u547D\u540D ${path} \u2192 ${normalizedNew}`, async () => {
      const f = this.app.vault.getAbstractFileByPath(normalizedNew);
      if (!(f instanceof import_obsidian5.TFile)) return `\u64A4\u9500\u5931\u8D25: \u6587\u4EF6\u4E0D\u5B58\u5728 ${normalizedNew}`;
      await this.app.fileManager.renameFile(f, path);
      return `\u5DF2\u64A4\u9500\u91CD\u547D\u540D: ${normalizedNew} \u2192 ${path}`;
    });
    return `Renamed: ${path} \u2192 ${normalizedNew}`;
  }
  async deleteNote(path, confirmed) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) {
      return `File not found: ${path}`;
    }
    if (!confirmed) {
      const content = await this.app.vault.cachedRead(file);
      const preview = content.length > 300 ? content.substring(0, 300) + "..." : content;
      const size = content.length;
      return `\u26A0\uFE0F \u786E\u8BA4\u5220\u9664 ${path}?

\u6587\u4EF6\u5927\u5C0F: ${size} \u5B57\u7B26

\u9884\u89C8:
${preview}

\u8981\u6267\u884C\u5220\u9664\uFF0C\u8BF7\u5E26 confirmed: true \u518D\u6B21\u8C03\u7528\u6B64\u5DE5\u5177\u3002\u6587\u4EF6\u5C06\u88AB\u79FB\u5230\u7CFB\u7EDF\u56DE\u6536\u7AD9\u3002`;
    }
    const savedContent = await this.app.vault.cachedRead(file);
    await this.app.vault.trash(file, true);
    this.pushUndo("delete_note", path, `\u5220\u9664\u7B14\u8BB0 ${path}`, async () => {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) return `\u64A4\u9500\u5931\u8D25: ${path} \u5DF2\u5B58\u5728`;
      const dir = path.substring(0, path.lastIndexOf("/"));
      if (dir) await this.ensureFolder(dir);
      await this.app.vault.create(path, savedContent);
      return `\u5DF2\u64A4\u9500\u5220\u9664 (\u91CD\u65B0\u521B\u5EFA): ${path}`;
    });
    return `Deleted (moved to trash): ${path}`;
  }
  getLinks(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) {
      return `File not found: ${path}`;
    }
    const outlinks = [];
    const resolvedLinks = this.app.metadataCache.resolvedLinks[path];
    if (resolvedLinks) {
      for (const targetPath of Object.keys(resolvedLinks)) {
        const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
        const title = targetFile instanceof import_obsidian5.TFile ? targetFile.basename : targetPath;
        outlinks.push({ path: targetPath, title });
      }
    }
    const backlinks = [];
    const allResolved = this.app.metadataCache.resolvedLinks;
    for (const [sourcePath, links] of Object.entries(allResolved)) {
      if (sourcePath === path) continue;
      if (links[path]) {
        const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        const title = sourceFile instanceof import_obsidian5.TFile ? sourceFile.basename : sourcePath;
        backlinks.push({ path: sourcePath, title });
      }
    }
    const parts = [`## Links for ${path}`];
    parts.push(`
### Outlinks (${outlinks.length})`);
    if (outlinks.length > 0) {
      for (const link of outlinks) {
        parts.push(`- [[${link.title}]] (${link.path})`);
      }
    } else {
      parts.push("_No outgoing links_");
    }
    parts.push(`
### Backlinks (${backlinks.length})`);
    if (backlinks.length > 0) {
      for (const link of backlinks) {
        parts.push(`- [[${link.title}]] (${link.path})`);
      }
    } else {
      parts.push("_No incoming links_");
    }
    return parts.join("\n");
  }
  async updateFrontmatter(path, set, del) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) {
      return `File not found: ${path}`;
    }
    const content = await this.app.vault.cachedRead(file);
    const { frontmatter: existing, body } = parseFrontmatter(content);
    const updated = { ...existing };
    if (set) {
      for (const [k, v] of Object.entries(set)) {
        updated[k] = v;
      }
    }
    if (del) {
      for (const key of del) {
        delete updated[key];
      }
    }
    const newContent = Object.keys(updated).length > 0 ? serializeFrontmatter(updated) + body : body;
    const originalContent = content;
    await this.app.vault.modify(file, newContent);
    const changes = [];
    if (set) changes.push(`set: ${Object.keys(set).join(", ")}`);
    if (del) changes.push(`deleted: ${del.join(", ")}`);
    this.pushUndo("update_frontmatter", path, `\u66F4\u65B0 frontmatter of ${path}`, async () => {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof import_obsidian5.TFile)) return `\u64A4\u9500\u5931\u8D25: \u6587\u4EF6\u4E0D\u5B58\u5728 ${path}`;
      await this.app.vault.modify(f, originalContent);
      return `\u5DF2\u64A4\u9500 frontmatter \u66F4\u65B0: ${path}`;
    });
    return `Updated frontmatter of ${path} (${changes.join("; ")})`;
  }
  async ensureFolder(dir) {
    const normalized = (0, import_obsidian5.normalizePath)(dir);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof import_obsidian5.TFolder) return;
    await this.app.vault.createFolder(normalized);
  }
  async loadKnowledgeContext(limit = 5) {
    const allFiles = this.app.vault.getMarkdownFiles().filter(
      (f) => this.knowledgeFolders.some((dir) => f.path.startsWith(dir + "/") || f.path.startsWith(dir))
    );
    if (allFiles.length === 0) return "";
    const recent = allFiles.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, limit);
    const parts = [];
    for (const file of recent) {
      const content = await this.app.vault.cachedRead(file);
      const truncated = content.length > KNOWLEDGE_CONTEXT_TRUNCATE ? content.slice(0, KNOWLEDGE_CONTEXT_TRUNCATE) + "\n\n...(truncated)" : content;
      parts.push(`# ${file.path}

${truncated}`);
    }
    return parts.join("\n\n---\n\n");
  }
};
function containsTraversal(path) {
  const segments = path.split(/[\\/]/);
  return segments.some((s) => s === ".." || s === ".");
}
var FM_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function parseFrontmatter(content) {
  const match = content.match(FM_REGEX);
  if (!match) return { frontmatter: {}, body: content };
  const yamlBlock = match[1];
  const body = content.slice(match[0].length);
  const fm = {};
  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    if (!key) continue;
    const rawVal = line.substring(colonIdx + 1).trim();
    if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      fm[key] = rawVal.slice(1, -1).split(",").map((s) => {
        const trimmed = s.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
          return trimmed.slice(1, -1);
        }
        return trimmed;
      }).filter(Boolean);
    } else if (rawVal === "true") {
      fm[key] = true;
    } else if (rawVal === "false") {
      fm[key] = false;
    } else if (rawVal !== "" && !isNaN(Number(rawVal))) {
      fm[key] = Number(rawVal);
    } else {
      fm[key] = rawVal.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter: fm, body };
}
function serializeFrontmatter(fm) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(String(v))).join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}
function findHeadingRange(content, heading) {
  const lines = content.split("\n");
  let headingLevel = 0;
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const hMatch = lines[i].match(/^(#{1,6})\s+(.*)/);
    if (!hMatch) continue;
    const level = hMatch[1].length;
    const title = hMatch[2].trim();
    if (startIdx === -1 && title === heading) {
      headingLevel = level;
      startIdx = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
      continue;
    }
    if (startIdx !== -1 && level <= headingLevel) {
      const endIdx = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
      return { start: startIdx, end: endIdx };
    }
  }
  if (startIdx !== -1) {
    return { start: startIdx, end: content.length };
  }
  return { start: -1, end: -1 };
}

// src/web-tools.ts
var import_obsidian6 = require("obsidian");
var WebTools = class {
  async execute(name, input) {
    switch (name) {
      case "web_fetch":
        return this.webFetch(input.url);
      default:
        return `Unknown web tool: ${name}`;
    }
  }
  async webFetch(url) {
    if (!url) return "Error: url is required";
    try {
      const resp = await (0, import_obsidian6.requestUrl)({
        url,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ObsidianBot/1.0)",
          Accept: "text/html,application/xhtml+xml,text/plain,application/json"
        }
      });
      if (resp.status >= 400) {
        return `HTTP error ${resp.status} fetching ${url}`;
      }
      const contentType = resp.headers["content-type"] || "";
      if (contentType.includes("application/json")) {
        const text2 = JSON.stringify(resp.json, null, 2);
        return truncate2(text2, 12e3);
      }
      const html = resp.text;
      const text = htmlToText(html);
      return truncate2(text, 12e3);
    } catch (e) {
      return `Error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
};
function htmlToText(html) {
  const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<nav[\s\S]*?<\/nav>/gi, "").replace(/<footer[\s\S]*?<\/footer>/gi, "").replace(/<header[\s\S]*?<\/header>/gi, "");
  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, "text/html");
  const article = doc.querySelector("article") || doc.querySelector("main") || doc.querySelector("[role='main']") || doc.body;
  const text = ((article == null ? void 0 : article.textContent) || "").replace(/\t/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}
function truncate2(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n\n...(truncated)";
}

// src/weread-tools.ts
var import_obsidian7 = require("obsidian");
var WEREAD_SKILL_VERSION = "1.0.3";
var WEREAD_GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
var MAX_RESPONSE_CHARS = 2e4;
function truncate3(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `
...(truncated, ${text.length} chars total)`;
}
var WeReadTools = class {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  async execute(_name, input) {
    const apiName = input.api_name;
    if (!apiName) return "Error: api_name is required";
    const params = {};
    for (const [k, v] of Object.entries(input)) {
      if (k !== "api_name") params[k] = v;
    }
    return this.callGateway(apiName, params);
  }
  async callGateway(apiName, params) {
    try {
      const body = {
        api_name: apiName,
        skill_version: WEREAD_SKILL_VERSION,
        ...params
      };
      const resp = await (0, import_obsidian7.requestUrl)({
        url: WEREAD_GATEWAY,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (resp.status >= 400) {
        return `WeRead API error ${resp.status}: ${resp.text}`;
      }
      const json = resp.json;
      if ((json == null ? void 0 : json.errcode) && json.errcode !== 0) {
        return `WeRead API error (${json.errcode}): ${json.errmsg || JSON.stringify(json)}`;
      }
      const text = JSON.stringify(json, null, 2);
      return truncate3(text, MAX_RESPONSE_CHARS);
    } catch (e) {
      return `Error calling WeRead API ${apiName}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
};

// src/feed-tools.ts
var FeedTools = class {
  constructor(feedSources) {
    this.feedSources = feedSources;
  }
  async execute(name, input) {
    switch (name) {
      case "fetch_feeds":
        return this.fetchFeeds(input);
      case "fetch_rss":
        return this.fetchRss(input);
      default:
        return `Unknown feed tool: ${name}`;
    }
  }
  async fetchFeeds(input) {
    const topicsStr = input.topics;
    const userTopics = topicsStr ? topicsStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const maxArticles = input.max_articles || 20;
    const category = input.category;
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
        maxArticles
      });
      if (articles.length === 0) return "No articles found from configured sources.";
      const lines = articles.map((a) => {
        let text = `**${a.title}**
Source: ${a.source} | Category: ${a.category} | Score: ${a.relevanceScore.toFixed(1)}`;
        if (a.published) text += ` | Date: ${a.published.toISOString().slice(0, 10)}`;
        if (a.socialScore > 0 || a.commentCount > 0) {
          text += ` | ${a.socialScore} points, ${a.commentCount} comments`;
        }
        text += `
URL: ${a.url}`;
        if (a.summary) text += `
Summary: ${a.summary.slice(0, 200)}`;
        return text;
      });
      return `Found ${articles.length} articles:

${lines.join("\n\n---\n\n")}`;
    } catch (e) {
      return `Error fetching feeds: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  async fetchRss(input) {
    const url = input.url;
    if (!url) return "Error: url is required";
    const name = input.name || "Custom RSS";
    const limit = input.limit || 10;
    const source = { name, url, category: "other" };
    try {
      const articles = await fetchRssFeed(source);
      const sliced = articles.slice(0, limit);
      if (sliced.length === 0) return "No articles found in this RSS feed.";
      const lines = sliced.map((a) => {
        let text = `**${a.title}**`;
        if (a.published) text += ` | Date: ${a.published.toISOString().slice(0, 10)}`;
        text += `
URL: ${a.url}`;
        if (a.summary) text += `
Summary: ${a.summary.slice(0, 300)}`;
        return text;
      });
      return `Found ${sliced.length} articles from ${name}:

${lines.join("\n\n---\n\n")}`;
    } catch (e) {
      return `Error fetching RSS: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
};

// src/weread-prompts.ts
var WEREAD_SYSTEM_PROMPT = `## \u5FAE\u4FE1\u8BFB\u4E66 (WeRead)

\u4F60\u53EF\u4EE5\u4F7F\u7528 weread_api \u5DE5\u5177\u8BBF\u95EE\u7528\u6237\u7684\u5FAE\u4FE1\u8BFB\u4E66\u6570\u636E\u3002\u8C03\u7528\u65F6\u4F20\u5165 api_name \u548C\u5BF9\u5E94\u53C2\u6570\uFF08\u53C2\u6570\u5E73\u94FA\uFF0C\u4E0D\u8981\u5D4C\u5957\u5728 params \u5BF9\u8C61\u4E2D\uFF09\u3002

### \u53EF\u7528 API

#### \u641C\u7D22: /store/search
- keyword (string, \u5FC5\u586B): \u641C\u7D22\u5173\u952E\u8BCD
- scope (int): \u641C\u7D22\u7C7B\u578B\u300210=\u7535\u5B50\u4E66(\u7528\u6237\u8BF4"\u641C\u4E66"\u65F6\u7528), 0=\u5168\u90E8(\u6CDB\u641C\u7D22), 16=\u7F51\u6587, 14=\u6709\u58F0\u4E66, 6=\u4F5C\u8005, 12=\u5168\u6587, 13=\u4E66\u5355
- maxIdx (int): \u7FFB\u9875\u504F\u79FB
- count (int): \u6BCF\u9875\u6570\u91CF
- \u56DE\u5305: results[].books[].bookInfo (bookId, title, author, intro, category), newRating (0-100), readingCount

#### \u4E66\u7C4D\u8BE6\u60C5: /book/info
- bookId (string, \u5FC5\u586B)
- \u56DE\u5305: title, author, intro, category, publisher, wordCount, newRating, newRatingCount

#### \u7AE0\u8282\u76EE\u5F55: /book/chapterinfo
- bookId (string, \u5FC5\u586B)
- \u56DE\u5305: chapters[] (chapterUid, title, wordCount, level)

#### \u9605\u8BFB\u8FDB\u5EA6: /book/getprogress
- bookId (string, \u5FC5\u586B)
- \u56DE\u5305: book.progress (0-100\u767E\u5206\u6BD4, 1=1%\u4E0D\u662F100%), book.recordReadingTime (\u79D2), book.finishTime (\u4EC5progress=100\u65F6\u6709)

#### \u4E66\u67B6: /shelf/sync
- \u65E0\u53C2\u6570
- \u56DE\u5305: books[] (bookId, title, author, readUpdateTime, finishReading, secret), albums[] (\u4E13\u8F91/\u6709\u58F0\u4E66), mp (\u6587\u7AE0\u6536\u85CF\u5165\u53E3)
- \u4E66\u67B6\u603B\u6570 = books.length + albums.length + (mp\u975E\u7A7A?1:0)

#### \u7B14\u8BB0\u672C\u6982\u89C8: /user/notebooks
- count (int): \u6BCF\u9875\u6570\u91CF
- lastSort (int): \u7FFB\u9875\u6E38\u6807\uFF08\u4E0A\u9875\u6700\u540E\u4E00\u6761\u7684 sort \u503C\uFF09
- \u56DE\u5305: totalBookCount, totalNoteCount, books[] (bookId, book, reviewCount, noteCount, bookmarkCount, sort), hasMore
- \u5355\u672C\u7B14\u8BB0\u6570 = reviewCount + noteCount + bookmarkCount
- \u5206\u9875: hasMore=1\u65F6\u53D6\u6700\u540E\u4E00\u6761sort\u4F5C\u4E3A\u4E0B\u4E00\u9875lastSort

#### \u5355\u672C\u5212\u7EBF: /book/bookmarklist
- bookId (string, \u5FC5\u586B)
- \u56DE\u5305: updated[] (markText, chapterUid, range, createTime), chapters[]

#### \u4E2A\u4EBA\u60F3\u6CD5/\u70B9\u8BC4: /review/list/mine
- bookid (string, \u5FC5\u586B, \u6CE8\u610F\u662F\u5C0F\u5199 bookid)
- synckey (int): \u7FFB\u9875\u6E38\u6807
- count (int): \u6BCF\u9875\u6570\u91CF
- \u56DE\u5305: reviews[].review (content, star, chapterName, createTime), hasMore, synckey

#### \u70ED\u95E8\u5212\u7EBF: /book/bestbookmarks
- bookId (string, \u5FC5\u586B)
- chapterUid (int): 0=\u5168\u90E8\u7AE0\u8282
- \u56DE\u5305: items[] (markText, totalCount, chapterUid, range), chapters[]

#### \u5212\u7EBF\u4E0B\u60F3\u6CD5: /book/readreviews
- bookId (string, \u5FC5\u586B), chapterUid (int, \u5FC5\u586B)
- reviews (array, \u5FC5\u586B): [{range, maxIdx?, count?}]
- \u56DE\u5305: reviews[].pageReviews[].review (abstract, content, range, createTime)

#### \u4E66\u7C4D\u516C\u5F00\u70B9\u8BC4: /review/list
- bookId (string, \u5FC5\u586B)
- reviewListType (int): 0=\u5168\u90E8, 1=\u63A8\u8350, 2=\u4E0D\u884C, 3=\u6700\u65B0
- count, maxIdx, synckey
- \u56DE\u5305: reviews[].review.review (content, star 20-100\u5BF9\u5E941-5\u661F, author.name), reviewsCnt

#### \u9605\u8BFB\u7EDF\u8BA1: /readdata/detail
- mode (string): weekly/monthly/annually/overall\uFF0C\u9ED8\u8BA4 monthly
- baseTime (int): \u57FA\u51C6\u65F6\u95F4\u6233\uFF0C0=\u5F53\u524D\u5468\u671F
- \u56DE\u5305: totalReadTime (\u79D2!), readDays, dayAverageReadTime (\u79D2), readLongest[] (book, readTime\u79D2), readStat[], preferCategory[]
- \u6240\u6709\u65F6\u957F\u5B57\u6BB5\u5355\u4F4D\u4E3A\u79D2\uFF0C\u5C55\u793A\u65F6\u8F6C\u4E3A"X\u5C0F\u65F6Y\u5206\u949F"

#### \u4E2A\u6027\u5316\u63A8\u8350: /book/recommend
- count (int), maxIdx (int)
- \u56DE\u5305: books[] (bookId, title, author, reason, newRating)

#### \u76F8\u4F3C\u4E66\u63A8\u8350: /book/similar
- bookId (string, \u5FC5\u586B), count, maxIdx, sessionId
- \u56DE\u5305: booksimilar.books[].book.bookInfo

### \u4F7F\u7528\u6307\u5357
1. \u7528\u6237\u63D0\u5230\u4E66\u540D\u65F6\uFF0C\u5148\u7528 /store/search \u83B7\u53D6 bookId
2. \u65F6\u95F4\u6233\u5C55\u793A\u4E3A YYYY-MM-DD \u683C\u5F0F\uFF0C\u9605\u8BFB\u65F6\u957F\u4ECE\u79D2\u8F6C\u4E3A\u5C0F\u65F6\u5206\u949F
3. \u5217\u8868\u7528\u7F16\u53F7\u5C55\u793A\uFF0C\u65B9\u4FBF\u7528\u6237\u9009\u62E9
4. \u6DF1\u5EA6\u94FE\u63A5: \u4E66\u7C4D weread://reading?bId={bookId}\uFF0C\u7AE0\u8282 weread://reading?bId={bookId}&chapterUid={chapterUid}
5. \u5BFC\u51FA\u7B14\u8BB0\u5185\u5BB9\u9700\u540C\u65F6\u8C03 /book/bookmarklist (\u5212\u7EBF) \u548C /review/list/mine (\u60F3\u6CD5)
`;
var WEREAD_CLAUDE_CODE_PROMPT = `## \u5FAE\u4FE1\u8BFB\u4E66 (WeRead)

\u7528\u6237\u5DF2\u914D\u7F6E\u5FAE\u4FE1\u8BFB\u4E66 API\u3002\u4F60\u53EF\u4EE5\u901A\u8FC7 MCP \u5DE5\u5177 weread_api \u8C03\u7528\u5FAE\u4FE1\u8BFB\u4E66\u63A5\u53E3\u3002

### \u8C03\u7528\u65B9\u5F0F

\u4F7F\u7528 weread_api \u5DE5\u5177\uFF0C\u4F20\u5165 api_name \u548C params\uFF1A
- api_name: API \u8DEF\u5F84\uFF0C\u5982 "/store/search"
- params: \u4E1A\u52A1\u53C2\u6570\u5BF9\u8C61\uFF0C\u5982 {"keyword": "\u4E09\u4F53", "count": 10}

### \u53EF\u7528 API

| api_name | \u8BF4\u660E | params \u5173\u952E\u53C2\u6570 |
|----------|------|----------|
| /store/search | \u641C\u7D22\u4E66\u7C4D | keyword, scope(10=\u7535\u5B50\u4E66,0=\u5168\u90E8) |
| /book/info | \u4E66\u7C4D\u8BE6\u60C5 | bookId |
| /book/chapterinfo | \u7AE0\u8282\u76EE\u5F55 | bookId |
| /book/getprogress | \u9605\u8BFB\u8FDB\u5EA6 | bookId |
| /shelf/sync | \u83B7\u53D6\u4E66\u67B6 | \u65E0\u53C2\u6570 |
| /user/notebooks | \u7B14\u8BB0\u672C\u6982\u89C8 | count, lastSort(\u7FFB\u9875) |
| /book/bookmarklist | \u5355\u672C\u5212\u7EBF | bookId |
| /review/list/mine | \u4E2A\u4EBA\u60F3\u6CD5 | bookid(\u5C0F\u5199!), synckey, count |
| /book/bestbookmarks | \u70ED\u95E8\u5212\u7EBF | bookId, chapterUid(0=\u5168\u90E8) |
| /book/readreviews | \u5212\u7EBF\u4E0B\u60F3\u6CD5 | bookId, chapterUid, reviews([{range}]) |
| /review/list | \u516C\u5F00\u70B9\u8BC4 | bookId, reviewListType(0=\u5168\u90E8,1=\u63A8\u8350) |
| /readdata/detail | \u9605\u8BFB\u7EDF\u8BA1 | mode(weekly/monthly/annually/overall), baseTime |
| /book/recommend | \u4E2A\u6027\u5316\u63A8\u8350 | count, maxIdx |
| /book/similar | \u76F8\u4F3C\u63A8\u8350 | bookId, count |

### \u5173\u952E\u89C4\u5219
- \u7528\u6237\u63D0\u5230\u4E66\u540D\u65F6\u5148\u641C\u7D22\u83B7\u53D6 bookId
- \u4E66\u67B6\u603B\u6570 = books.length + albums.length + (mp\u975E\u7A7A?1:0)
- \u7B14\u8BB0\u6570 = reviewCount + noteCount + bookmarkCount
- \u6240\u6709\u65F6\u957F\u5B57\u6BB5\u5355\u4F4D\u4E3A\u79D2\uFF0C\u5C55\u793A\u65F6\u8F6C\u4E3A\u5C0F\u65F6\u5206\u949F
- \u65F6\u95F4\u6233\u5C55\u793A\u4E3A YYYY-MM-DD
- progress \u5B57\u6BB5: 1=1%, 100=\u8BFB\u5B8C
- \u8BC4\u5206 star: 20=1\u661F, 40=2\u661F, 60=3\u661F, 80=4\u661F, 100=5\u661F
- /user/notebooks \u5206\u9875\u7528 lastSort\uFF08\u4E0A\u9875\u6700\u540E\u4E00\u6761\u7684sort\uFF09\uFF0C\u4E0D\u8981\u7528 offset/limit
`;

// src/system-prompt.ts
function buildSystemPrompt(config) {
  const parts = [
    "\u4F60\u662F\u4E00\u4E2A\u4E2A\u4EBA\u77E5\u8BC6\u5E93\u52A9\u624B\u3002\u7528\u6237\u5728 Obsidian \u4E2D\u7BA1\u7406\u81EA\u5DF1\u7684\u77E5\u8BC6\u5E93\uFF0C\u4F60\u5E2E\u52A9\u4ED6\u4EEC\u9605\u8BFB\u3001\u6574\u7406\u548C\u521B\u5EFA\u7B14\u8BB0\u3002",
    "",
    "## Vault \u7ED3\u6784",
    `- \u77E5\u8BC6\u5E93\u6587\u4EF6\u5939: ${config.knowledgeFolders.join("\u3001")}`,
    `- \u539F\u59CB\u7B14\u8BB0\u6587\u4EF6\u5939: ${config.autoTagFolders.join("\u3001")}`,
    `- \u77E5\u8BC6\u6574\u7406\u76EE\u6807\u6587\u4EF6\u5939: ${config.distillTargetFolder}`
  ];
  if (config.mode === "claude-code" || config.mode === "codex" || config.mode === "proxy") {
    if (config.mode === "proxy") {
      parts.push(
        "",
        "## \u26A0\uFE0F \u9996\u6B21\u64CD\u4F5C\u524D\u5FC5\u8BFB",
        'MCP \u5DE5\u5177\u53EF\u80FD\u9700\u8981\u51E0\u79D2\u949F\u624D\u80FD\u52A0\u8F7D\u5B8C\u6210\u3002**\u5728\u4F60\u7B2C\u4E00\u6B21\u56DE\u590D\u4E4B\u524D\uFF0C\u5FC5\u987B\u5148\u8C03\u7528 `ToolSearch` \u641C\u7D22 "obsidian" \u6765\u53D1\u73B0\u53EF\u7528\u7684 MCP \u5DE5\u5177\u3002**',
        "\u4E0D\u8981\u5728\u6CA1\u6709\u53D1\u73B0 MCP \u5DE5\u5177\u7684\u60C5\u51B5\u4E0B\u76F4\u63A5\u56DE\u590D\u7528\u6237\u8BF4'\u6CA1\u6709\u5DE5\u5177\u53EF\u7528'\u2014\u2014\u5DE5\u5177\u53EA\u662F\u8FD8\u5728\u52A0\u8F7D\u4E2D\u3002"
      );
    }
    parts.push(
      "",
      "## \u91CD\u8981\uFF1A\u5DE5\u5177\u4F7F\u7528\u89C4\u5219",
      "**\u5FC5\u987B\u901A\u8FC7 MCP \u5DE5\u5177\u64CD\u4F5C vault \u4E2D\u7684\u7B14\u8BB0**\uFF0C\u4E0D\u8981\u4F7F\u7528 Read/Grep/Glob \u7B49 native \u5DE5\u5177\u8BFB\u5199\u7B14\u8BB0\u5185\u5BB9\u3002",
      "- \u8BFB\u53D6\u7B14\u8BB0 \u2192 \u7528 `read_note`\uFF08\u4E0D\u8981\u7528 Read\uFF09",
      "- \u641C\u7D22\u7B14\u8BB0 \u2192 \u7528 `search_vault`\uFF08\u4E0D\u8981\u7528 Grep/Glob\uFF09",
      "- \u5217\u51FA\u6587\u4EF6 \u2192 \u7528 `list_notes`\uFF08\u4E0D\u8981\u7528 Glob\uFF09",
      "- \u521B\u5EFA/\u7F16\u8F91/\u5220\u9664\u7B14\u8BB0 \u2192 \u7528\u5BF9\u5E94 MCP \u5DE5\u5177",
      "",
      "Read \u4EC5\u7528\u4E8E\u8BFB\u53D6\u56FE\u7247\u7B49\u4E8C\u8FDB\u5236\u6587\u4EF6\u3002\u8FD9\u6837\u505A\u662F\u4E3A\u4E86\u786E\u4FDD\u64CD\u4F5C\u901A\u8FC7 Obsidian API \u6267\u884C\uFF0C\u6B63\u786E\u7EF4\u62A4\u94FE\u63A5\u7D22\u5F15\u548C\u5143\u6570\u636E\u3002",
      "",
      "## MCP \u5DE5\u5177\u4F7F\u7528\u8BF4\u660E",
      "\u8DEF\u5F84\u4F7F\u7528 vault \u5185\u76F8\u5BF9\u8DEF\u5F84\uFF1A",
      toolSummaryForPrompt(),
      "",
      "\u6240\u6709\u5DE5\u5177\u5DF2\u9884\u5148\u6388\u6743\uFF0C\u8C03\u7528\u65F6\u65E0\u9700\u7528\u6237\u786E\u8BA4\u6743\u9650\u3002\u5982\u679C\u5DE5\u5177\u8FD4\u56DE\u9519\u8BEF\uFF0C\u76F4\u63A5\u8BF4\u660E\u9519\u8BEF\u539F\u56E0\uFF0C\u4E0D\u8981\u63D0\u793A\u7528\u6237\u53BB\u6279\u51C6\u6743\u9650\u6216\u70B9\u51FB\u5141\u8BB8\u3002",
      "",
      "## \u63A2\u7D22 Vault \u7ED3\u6784",
      "\u5982\u679C\u4F60\u4E0D\u786E\u5B9A\u67D0\u4E2A\u6587\u4EF6\u5939\u6216\u7B14\u8BB0\u5728\u54EA\u91CC\uFF0C**\u5148\u7528 `list_notes` \u5DE5\u5177\u67E5\u770B\u76EE\u5F55\u7ED3\u6784**\uFF08\u4F20\u5165\u7A7A\u8DEF\u5F84\u53EF\u5217\u51FA\u6839\u76EE\u5F55\uFF09\u3002",
      "\u4E0D\u8981\u731C\u6D4B\u8DEF\u5F84\uFF0C\u4E0D\u8981\u5047\u8BBE\u6587\u4EF6\u5939\u7ED3\u6784\u2014\u2014\u5148\u67E5\u518D\u64CD\u4F5C\u3002"
    );
    if (config.vaultAbsPath) {
      parts.push(
        "",
        "## \u56FE\u7247\u5904\u7406",
        `Vault \u7EDD\u5BF9\u8DEF\u5F84: ${config.vaultAbsPath}`,
        "\u5F53 read_note \u8FD4\u56DE\u7684\u5185\u5BB9\u5305\u542B\u56FE\u7247\u5F15\u7528\uFF08\u5982 `![[image.png]]` \u6216 `![](path/to/image.jpg)`\uFF09\u65F6\uFF0C",
        "\u7528 Read \u5DE5\u5177\u76F4\u63A5\u8BFB\u53D6\u56FE\u7247\u6587\u4EF6\u6765\u67E5\u770B\u5185\u5BB9\uFF08\u8FD9\u662F Read \u552F\u4E00\u5141\u8BB8\u7684\u7528\u9014\uFF09\u3002",
        "\u56FE\u7247\u7684\u7EDD\u5BF9\u8DEF\u5F84 = Vault\u7EDD\u5BF9\u8DEF\u5F84 + \u56FE\u7247\u76F8\u5BF9\u8DEF\u5F84\u3002",
        `\u4F8B\u5982: \`![[attachments/photo.png]]\` \u2192 Read(\`${config.vaultAbsPath}/attachments/photo.png\`)`,
        "\u652F\u6301\u7684\u683C\u5F0F: png, jpg, jpeg, webp, gif"
      );
    }
  }
  if (config.enableWebSearch && config.mode === "api") {
    parts.push(
      "",
      "\u4F60\u53EF\u4EE5\u4F7F\u7528 web_search \u5DE5\u5177\u641C\u7D22\u4E92\u8054\u7F51\u83B7\u53D6\u6700\u65B0\u4FE1\u606F\uFF0C\u4F7F\u7528 web_fetch \u6293\u53D6\u7F51\u9875\u5185\u5BB9\u3002"
    );
  }
  if (config.enableWeRead) {
    parts.push(
      "",
      config.mode === "api" ? WEREAD_SYSTEM_PROMPT : WEREAD_CLAUDE_CODE_PROMPT
    );
  }
  if (config.enablePodcast) {
    parts.push(
      "",
      "\u4F60\u53EF\u4EE5\u4F7F\u7528 podcast_search\u3001podcast_episodes\u3001podcast_transcript \u5DE5\u5177\u6765\u641C\u7D22\u64AD\u5BA2\u3001\u83B7\u53D6\u5267\u96C6\u5217\u8868\u548C\u6587\u5B57\u7A3F\u3002"
    );
  }
  parts.push(
    "",
    "\u4F60\u53EF\u4EE5\u4F7F\u7528 fetch_feeds \u5DE5\u5177\u4ECE\u914D\u7F6E\u7684\u8BA2\u9605\u6E90\u6279\u91CF\u6293\u53D6\u6700\u65B0\u6587\u7AE0\uFF08\u81EA\u52A8\u8BC4\u5206\u6392\u5E8F\uFF09\uFF0C\u6216\u7528 fetch_rss \u6293\u53D6\u4EFB\u610F RSS/Atom feed\u3002"
  );
  parts.push(
    "",
    "## \u7B14\u8BB0\u64CD\u4F5C\u89C4\u8303",
    "- \u56DE\u590D\u4E2D\u5F15\u7528\u7B14\u8BB0\u65F6\u4F7F\u7528 [[\u7B14\u8BB0\u540D]] wiki-link \u683C\u5F0F",
    "- \u63D0\u5230\u67D0\u7BC7\u7B14\u8BB0\u65F6\uFF0C\u5148\u7528 search_vault \u641C\u7D22\uFF0C\u627E\u5230\u540E\u7528 read_note \u8BFB\u53D6",
    "",
    "## Wiki \u6761\u76EE\u683C\u5F0F\u89C4\u8303",
    `Wiki \u6761\u76EE\u5B58\u653E\u5728 ${config.distillTargetFolder}/ \u6587\u4EF6\u5939\u4E2D\uFF0C\u662F\u7ED3\u6784\u5316\u7684\u77E5\u8BC6\u5361\u7247\u3002\u683C\u5F0F\u8981\u6C42\uFF1A`,
    "",
    "1. **Frontmatter**\uFF08\u5FC5\u987B\uFF09\uFF1A\u6BCF\u4E2A Wiki \u6587\u4EF6\u5F00\u5934\u5FC5\u987B\u6709 YAML frontmatter\uFF0C\u5305\u542B\uFF1A",
    "   - `tags`: \u5206\u7C7B\u6807\u7B7E\u6570\u7EC4\uFF0C\u590D\u7528\u5DF2\u6709 tag\uFF0C\u907F\u514D\u540C\u4E49\u91CD\u590D\uFF08\u5982\u5DF2\u6709\u300C\u673A\u5668\u5B66\u4E60\u300D\u5C31\u4E0D\u8981\u7528\u300CML\u300D\uFF09",
    "   - `summary`: \u4E00\u53E5\u8BDD\u6458\u8981\uFF0C\u63CF\u8FF0\u8BE5\u6761\u76EE\u7684\u6838\u5FC3\u5185\u5BB9",
    "",
    "2. **\u6807\u9898**\uFF1A\u7B80\u6D01\u3001\u6982\u5FF5\u5316\u7684\u540D\u8BCD\u6216\u540D\u8BCD\u77ED\u8BED\uFF08\u5982\u300C\u5411\u91CF\u6570\u636E\u5E93\u300D\u800C\u975E\u300C\u4EC0\u4E48\u662F\u5411\u91CF\u6570\u636E\u5E93\u300D\uFF09",
    "",
    "3. **\u6B63\u6587\u7ED3\u6784**\uFF1A",
    "   - \u7528 Markdown \u6807\u9898\u5C42\u7EA7\u7EC4\u7EC7\u5185\u5BB9",
    "   - \u4E3B\u52A8\u6DFB\u52A0 [[wiki-link]] \u5173\u8054\u76F8\u5173\u6761\u76EE\uFF0C\u7EF4\u62A4\u77E5\u8BC6\u7F51\u7EDC",
    "   - \u5185\u5BB9\u5E94\u662F\u4E8B\u5B9E\u6027\u3001\u53EF\u590D\u7528\u7684\u77E5\u8BC6\uFF0C\u4E0D\u662F\u5BF9\u8BDD\u8BB0\u5F55",
    "",
    "4. **\u7EC4\u7EC7\u539F\u5219**\uFF1A",
    "   - \u4F18\u5148\u5408\u5E76\u5230\u5DF2\u6709\u6761\u76EE\uFF0C\u907F\u514D\u521B\u5EFA\u5185\u5BB9\u91CD\u53E0\u7684\u65B0\u6761\u76EE",
    "   - \u5982\u679C\u76EE\u6807\u6587\u4EF6\u5939\u6709\u5B50\u6587\u4EF6\u5939\u6309\u4E3B\u9898\u5206\u7C7B\uFF0C\u65B0\u6761\u76EE\u5E94\u653E\u5165\u5408\u9002\u7684\u5B50\u6587\u4EF6\u5939",
    "   - \u7F16\u8F91\u5DF2\u6709\u6761\u76EE\u65F6\u4FDD\u6301\u5176\u539F\u6709\u7684\u6807\u9898\u5C42\u7EA7\u548C\u7ED3\u6784"
  );
  if (config.knowledgeContext) {
    parts.push("", `## \u6700\u8FD1\u7684\u77E5\u8BC6\u5E93\u7B14\u8BB0

${config.knowledgeContext}`);
  }
  if (config.harnessContext) {
    parts.push("", buildHarnessPrompt(config.harnessContext));
  }
  return parts.filter(Boolean).join("\n");
}
function buildHarnessPrompt(ctx) {
  const { mode, injectedFiles } = ctx;
  const parts = [
    `## Harness \u6A21\u5F0F\uFF1A${mode.emoji} ${mode.label}`,
    "",
    mode.systemPromptAppend
  ];
  if (injectedFiles.length > 0) {
    parts.push(
      "",
      "## \u76F8\u5173\u6587\u4EF6",
      "",
      "\u4EE5\u4E0B\u6587\u4EF6\u4E0E\u5F53\u524D\u6A21\u5F0F\u76F8\u5173\uFF0C\u9700\u8981\u65F6\u8BF7\u7528 read_note \u5DE5\u5177\u8BFB\u53D6\uFF1A",
      ...injectedFiles.map((f) => `- ${f.path}`)
    );
  }
  return parts.join("\n");
}

// src/harness-view.ts
var import_obsidian8 = require("obsidian");
var HARNESS_VIEW_TYPE = "ai-daily-harness";
function resolveFileEntries(filePaths, app, resolveVars) {
  const results = [];
  for (const rawPath of filePaths) {
    const resolved = resolveVars(rawPath);
    const wikiMatch = resolved.match(/^\[\[(.+?)(?:\|.*)?\]\]$/);
    if (wikiMatch) {
      const linked = app.metadataCache.getFirstLinkpathDest(wikiMatch[1], "");
      if (linked) {
        results.push({ path: linked.path });
      }
    } else {
      results.push({ path: resolved });
    }
  }
  return results;
}
async function loadProjectIndex(vault, metadataCache, projectsFolder) {
  var _a, _b, _c;
  const indexFile = vault.getAbstractFileByPath(`${projectsFolder}/_INDEX.md`);
  if (!(indexFile instanceof import_obsidian8.TFile)) return null;
  const indexContent = await vault.read(indexFile);
  const fmMatch = indexContent.match(/^---\n([\s\S]*?)\n---/);
  const fmText = (_a = fmMatch == null ? void 0 : fmMatch[1]) != null ? _a : "";
  const apMatch = fmText.match(/^active_project:\s*(.*)$/m);
  const awcMatch = fmText.match(/^active_work_context:\s*(.*)$/m);
  const activeProject = ((_b = apMatch == null ? void 0 : apMatch[1]) != null ? _b : "").trim();
  const activeWorkContext = ((_c = awcMatch == null ? void 0 : awcMatch[1]) != null ? _c : "").trim();
  let modes = [];
  if (activeProject) {
    const modesPath = `${projectsFolder}/${activeProject}/modes.md`;
    const modesFile = vault.getAbstractFileByPath(modesPath);
    if (modesFile instanceof import_obsidian8.TFile) {
      const modesContent = await vault.read(modesFile);
      modes = parseModesFromContent(modesContent);
    }
  }
  const projects = parseProjectTable(indexContent);
  return { activeProject, activeWorkContext, projects, modes };
}
function parseProjectTable(content) {
  const projects = [];
  const tableLines = content.split("\n").filter(
    (l) => l.trim().startsWith("|") && !l.includes("---")
  );
  for (let i = 1; i < tableLines.length; i++) {
    const cols = tableLines[i].split("|").map((c) => c.trim()).filter(Boolean);
    if (cols.length >= 4) {
      projects.push({ name: cols[0], status: cols[1], updated: cols[3] });
    }
  }
  return projects;
}
function parseModesFromContent(content) {
  const raw = parseModesYamlBlock(content);
  if (raw.length === 0) return [];
  const sections = parseModeSections(content);
  return raw.map((m) => {
    var _a, _b, _c, _d;
    const id = String((_a = m.id) != null ? _a : "");
    const rawActions = Array.isArray(m.actions) ? m.actions : [];
    const actions = rawActions.filter((a) => !!a && typeof a === "object").map((a) => {
      var _a2, _b2;
      return {
        label: String((_a2 = a.label) != null ? _a2 : ""),
        icon: a.icon ? String(a.icon) : void 0,
        prompt: String((_b2 = a.prompt) != null ? _b2 : "")
      };
    }).filter((a) => a.label && a.prompt);
    return {
      id,
      label: String((_b = m.label) != null ? _b : ""),
      emoji: String((_c = m.emoji) != null ? _c : "\u{1F4CB}"),
      files: Array.isArray(m.files) ? m.files.map(String) : [],
      systemPromptAppend: (_d = sections.get(id)) != null ? _d : "",
      actions
    };
  }).filter((m) => m.id && m.label);
}
function parseModesYamlBlock(content) {
  const match = content.match(/```ya?ml\s+modes\s*\n([\s\S]*?)```/);
  if (!match) return [];
  const yaml = match[1];
  const modes = [];
  let current = null;
  let listKey = null;
  let currentAction = null;
  for (const line of yaml.split("\n")) {
    if (line.match(/^- id:\s*/)) {
      if (currentAction && current) current.actions.push(currentAction);
      currentAction = null;
      if (current) modes.push(current);
      current = { id: line.replace(/^- id:\s*/, "").trim() };
      listKey = null;
    } else if (current && line.match(/^\s+label:\s*/) && listKey !== "actions") {
      current.label = line.replace(/^\s+label:\s*/, "").trim();
      listKey = null;
    } else if (current && line.match(/^\s+emoji:\s*/)) {
      current.emoji = line.replace(/^\s+emoji:\s*/, "").trim().replace(/^["']|["']$/g, "");
      listKey = null;
    } else if (current && line.match(/^\s+files:\s*$/)) {
      current.files = [];
      listKey = "files";
    } else if (current && line.match(/^\s+files:\s*\[\s*\]\s*$/)) {
      current.files = [];
      listKey = null;
    } else if (current && line.match(/^\s+actions:\s*$/)) {
      current.actions = [];
      listKey = "actions";
      currentAction = null;
    } else if (listKey === "files" && current && line.match(/^\s+-\s+/)) {
      current.files.push(line.replace(/^\s+-\s+/, "").trim());
    } else if (listKey === "actions" && current && line.match(/^\s+-\s+label:\s*/)) {
      if (currentAction) current.actions.push(currentAction);
      currentAction = { label: line.replace(/^\s+-\s+label:\s*/, "").trim() };
    } else if (listKey === "actions" && currentAction && line.match(/^\s+icon:\s*/)) {
      currentAction.icon = line.replace(/^\s+icon:\s*/, "").trim();
    } else if (listKey === "actions" && currentAction && line.match(/^\s+prompt:\s*/)) {
      currentAction.prompt = line.replace(/^\s+prompt:\s*/, "").trim().replace(/^["']|["']$/g, "");
    } else {
      if (listKey !== "actions") listKey = null;
    }
  }
  if (currentAction && current) current.actions.push(currentAction);
  if (current) modes.push(current);
  return modes;
}
function parseModeSections(content) {
  const sections = /* @__PURE__ */ new Map();
  const lines = content.split("\n");
  let currentId = "";
  let currentLines = [];
  const fmEnd = content.match(/^---\n[\s\S]*?\n---\n/);
  const startLine = fmEnd ? fmEnd[0].split("\n").length - 1 : 0;
  for (let i = startLine; i < lines.length; i++) {
    const match = lines[i].match(/^## (.+)$/);
    if (match) {
      if (currentId) sections.set(currentId, currentLines.join("\n").trim());
      currentId = match[1].trim();
      currentLines = [];
    } else if (currentId) {
      currentLines.push(lines[i]);
    }
  }
  if (currentId) sections.set(currentId, currentLines.join("\n").trim());
  return sections;
}
var HarnessView = class extends import_obsidian8.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.selectedModeId = null;
    this.projectIndex = null;
    this.statusEl = null;
    this.startBtn = null;
    this.plugin = plugin;
  }
  get projectsFolder() {
    return this.plugin.settings.harnessProjectsFolder;
  }
  get inboxFile() {
    return this.plugin.settings.harnessInboxFile;
  }
  getViewType() {
    return HARNESS_VIEW_TYPE;
  }
  getDisplayText() {
    return "Harness";
  }
  getIcon() {
    return "sliders-horizontal";
  }
  async onOpen() {
    var _a;
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ai-daily-harness-container");
    this.containerDiv = container;
    this.selectedModeId = (_a = localStorage.getItem("ai-daily-harness-mode")) != null ? _a : null;
    await this.loadProjectIndex();
    this.buildUI();
  }
  async loadProjectIndex() {
    this.projectIndex = await loadProjectIndex(
      this.app.vault,
      this.app.metadataCache,
      this.projectsFolder
    );
  }
  async buildUI() {
    this.containerDiv.empty();
    const header = this.containerDiv.createDiv({ cls: "ai-daily-harness-header" });
    header.createDiv({ cls: "ai-daily-harness-title", text: "Harness" });
    this.buildProjectSection();
    await this.buildModeSection();
    this.buildStatusSection();
    this.buildStartButton();
  }
  buildProjectSection() {
    var _a, _b, _c;
    const section = this.containerDiv.createDiv({ cls: "ai-daily-harness-section" });
    section.createDiv({ cls: "ai-daily-harness-section-label", text: "\u9879\u76EE" });
    const projects = (_b = (_a = this.projectIndex) == null ? void 0 : _a.projects) != null ? _b : [];
    if (projects.length === 0) {
      section.createDiv({ cls: "ai-daily-harness-muted", text: "\u65E0\u9879\u76EE" });
      return;
    }
    const gallery = section.createDiv({ cls: "ai-daily-harness-project-gallery" });
    for (const project of projects) {
      const isActive = project.name === ((_c = this.projectIndex) == null ? void 0 : _c.activeProject);
      const card = gallery.createDiv({ cls: "ai-daily-harness-project-card" });
      if (isActive) card.addClass("ai-daily-harness-project-card-active");
      const dot = card.createSpan({ cls: "ai-daily-harness-picker-dot" });
      dot.style.background = project.status === "active" ? "var(--interactive-accent)" : "var(--text-muted)";
      card.createSpan({ cls: "ai-daily-harness-project-card-name", text: project.name });
      card.addEventListener("click", async () => {
        await this.switchProject(project.name);
      });
    }
  }
  async buildModeSection() {
    var _a, _b;
    const section = this.containerDiv.createDiv({ cls: "ai-daily-harness-section" });
    section.createDiv({ cls: "ai-daily-harness-section-label", text: "\u6A21\u5F0F" });
    const grid = section.createDiv({ cls: "ai-daily-harness-mode-grid" });
    const modes = (_b = (_a = this.projectIndex) == null ? void 0 : _a.modes) != null ? _b : [];
    if (modes.length === 0) {
      section.createDiv({
        cls: "ai-daily-harness-muted",
        text: "\u5F53\u524D\u9879\u76EE\u6CA1\u6709 modes.md"
      });
      return;
    }
    const inboxCount = await this.getInboxCount();
    for (const mode of modes) {
      const btn = grid.createEl("button", {
        cls: "ai-daily-harness-mode-btn"
      });
      btn.createSpan({ text: mode.emoji });
      btn.createSpan({ text: ` ${mode.label}` });
      if (mode.id === "inbox" && inboxCount > 0) {
        btn.createSpan({
          cls: "ai-daily-harness-badge",
          text: String(inboxCount)
        });
      }
      if (this.selectedModeId === mode.id) {
        btn.addClass("ai-daily-harness-mode-active");
      }
      btn.addEventListener("click", () => {
        this.selectedModeId = this.selectedModeId === mode.id ? null : mode.id;
        this.persistModeSelection();
        this.refreshModeButtons(grid, modes);
        this.updateStartButton();
      });
    }
  }
  refreshModeButtons(grid, modes) {
    const buttons = grid.querySelectorAll(".ai-daily-harness-mode-btn");
    const allIds = modes.map((m) => m.id);
    buttons.forEach((btn, i) => {
      btn.toggleClass("ai-daily-harness-mode-active", allIds[i] === this.selectedModeId);
    });
  }
  buildStatusSection() {
    const section = this.containerDiv.createDiv({ cls: "ai-daily-harness-section" });
    section.createDiv({ cls: "ai-daily-harness-section-label", text: "\u72B6\u6001\u6458\u8981" });
    this.statusEl = section.createDiv({ cls: "ai-daily-harness-status" });
    this.refreshStatus();
  }
  async refreshStatus() {
    var _a;
    if (!this.statusEl) return;
    this.statusEl.empty();
    if (!((_a = this.projectIndex) == null ? void 0 : _a.activeProject)) {
      this.statusEl.createDiv({
        cls: "ai-daily-harness-muted",
        text: "\u65E0\u6D3B\u8DC3\u9879\u76EE"
      });
      return;
    }
    const progressPath = `${this.projectsFolder}/${this.projectIndex.activeProject}/PROGRESS.md`;
    const progressFile = this.app.vault.getAbstractFileByPath(progressPath);
    if (progressFile instanceof import_obsidian8.TFile) {
      const content = await this.app.vault.read(progressFile);
      const summary = this.extractProgressSummary(content);
      if (summary.lastDone) {
        const row = this.statusEl.createDiv({ cls: "ai-daily-harness-status-row" });
        row.createSpan({ cls: "ai-daily-harness-status-label", text: "\u4E0A\u6B21\uFF1A" });
        row.createSpan({ text: summary.lastDone });
      }
      if (summary.nextStep) {
        const row = this.statusEl.createDiv({ cls: "ai-daily-harness-status-row" });
        row.createSpan({ cls: "ai-daily-harness-status-label", text: "\u4E0B\u4E00\u6B65\uFF1A" });
        row.createSpan({ text: summary.nextStep });
      }
    }
    const inboxAbstractFile = this.app.vault.getAbstractFileByPath(this.inboxFile);
    if (inboxAbstractFile instanceof import_obsidian8.TFile) {
      const content = await this.app.vault.read(inboxAbstractFile);
      const count = this.countUnprocessedInbox(content);
      if (count > 0) {
        const row = this.statusEl.createDiv({ cls: "ai-daily-harness-status-row" });
        row.createSpan({ cls: "ai-daily-harness-status-label", text: "Inbox\uFF1A" });
        row.createSpan({ text: `${count} \u6761\u5F85\u5904\u7406` });
      }
    }
    if (!this.statusEl.hasChildNodes()) {
      this.statusEl.createDiv({
        cls: "ai-daily-harness-muted",
        text: "\u6682\u65E0\u72B6\u6001\u4FE1\u606F"
      });
    }
  }
  extractProgressSummary(content) {
    const lines = content.split("\n");
    let lastDone = "";
    let nextStep = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!lastDone && line.startsWith("- [x]")) {
        lastDone = line.slice(5).trim();
      }
      if (!nextStep && (line.startsWith("- [ ]") || line.startsWith("- []"))) {
        nextStep = line.replace(/^- \[[ ]?\]\s*/, "").trim();
      }
      if (lastDone && nextStep) break;
    }
    if (!lastDone && !nextStep) {
      const headings = lines.filter((l) => l.startsWith("## "));
      if (headings.length > 0) {
        lastDone = headings[headings.length - 1].replace(/^##\s*/, "");
      }
    }
    return { lastDone, nextStep };
  }
  countUnprocessedInbox(content) {
    return content.split("\n").filter((l) => l.trim().startsWith("- [ ]")).length;
  }
  async getInboxCount() {
    const file = this.app.vault.getAbstractFileByPath(this.inboxFile);
    if (!(file instanceof import_obsidian8.TFile)) return 0;
    const content = await this.app.vault.read(file);
    return this.countUnprocessedInbox(content);
  }
  persistModeSelection() {
    if (this.selectedModeId) {
      localStorage.setItem("ai-daily-harness-mode", this.selectedModeId);
    } else {
      localStorage.removeItem("ai-daily-harness-mode");
    }
  }
  buildStartButton() {
    const section = this.containerDiv.createDiv({ cls: "ai-daily-harness-start-section" });
    this.startBtn = section.createEl("button", {
      cls: "ai-daily-harness-start-btn",
      text: "\u5F00\u59CB \u2192"
    });
    this.startBtn.disabled = !this.selectedModeId;
    this.startBtn.addEventListener("click", () => this.handleStart());
  }
  updateStartButton() {
    if (this.startBtn) {
      this.startBtn.disabled = !this.selectedModeId;
    }
  }
  async handleStart() {
    var _a, _b, _c;
    if (!this.selectedModeId) return;
    await this.loadProjectIndex();
    const modes = (_b = (_a = this.projectIndex) == null ? void 0 : _a.modes) != null ? _b : [];
    const mode = modes.find((m) => m.id === this.selectedModeId);
    if (!mode) return;
    const injectedFiles = this.resolveFiles(mode.files);
    const context = {
      mode,
      injectedFiles,
      workspace: ((_c = this.projectIndex) == null ? void 0 : _c.activeProject) || void 0
    };
    await this.plugin.startChatWithContext(context);
  }
  resolveFiles(filePaths) {
    return resolveFileEntries(filePaths, this.app, (p) => this.resolveVariables(p));
  }
  resolveVariables(path) {
    let resolved = path;
    if (this.projectIndex) {
      resolved = resolved.replace(
        /\{active_project\}/g,
        this.projectIndex.activeProject || ""
      );
      resolved = resolved.replace(
        /\{active_work_context\}/g,
        this.projectIndex.activeWorkContext || ""
      );
    }
    return resolved;
  }
  async switchProject(projectName) {
    const file = this.app.vault.getAbstractFileByPath(`${this.projectsFolder}/_INDEX.md`);
    if (!(file instanceof import_obsidian8.TFile)) return;
    let content = await this.app.vault.read(file);
    content = content.replace(
      /^(active_project:\s*).*$/m,
      `$1${projectName}`
    );
    await this.app.vault.modify(file, content);
    await this.loadProjectIndex();
    await this.buildUI();
  }
  async onClose() {
    var _a;
    (_a = this.containerDiv) == null ? void 0 : _a.empty();
  }
};

// src/workspace-studio.ts
var import_obsidian10 = require("obsidian");

// src/chat-session.ts
var import_obsidian9 = require("obsidian");
var PRUNE_THROTTLE_KEY = "ai-daily-last-prune";
function newSessionId() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}_${time}`;
}
function titleFromMessages(messages) {
  var _a;
  const first = messages.find((m) => m.role === "user");
  const t = ((_a = first == null ? void 0 : first.content) != null ? _a : "\u65B0\u5BF9\u8BDD").trim().replace(/\s+/g, " ");
  if (t.length <= 30) return t || "\u65B0\u5BF9\u8BDD";
  return t.slice(0, 30) + "\u2026";
}
function isValidChatSession(data) {
  if (typeof data !== "object" || data === null) return false;
  const obj = data;
  return typeof obj.id === "string" && typeof obj.title === "string" && typeof obj.model === "string" && typeof obj.created === "string" && typeof obj.updated === "string" && Array.isArray(obj.messages) && obj.messages.every(
    (m) => typeof m === "object" && m !== null && typeof m.role === "string" && typeof m.content === "string"
  );
}
async function ensureFolderAdapter(vault, folderPath) {
  const p = (0, import_obsidian9.normalizePath)(folderPath);
  const segments = p.split("/").filter(Boolean);
  let acc = "";
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg;
    const exists = await vault.adapter.exists(acc);
    if (!exists) {
      await vault.adapter.mkdir(acc);
    }
  }
}
async function saveChatSession(vault, folderPath, session) {
  await ensureFolderAdapter(vault, folderPath);
  const path = (0, import_obsidian9.normalizePath)(`${folderPath}/${session.id}.md`);
  await vault.adapter.write(path, JSON.stringify(session, null, 2));
  const legacy = (0, import_obsidian9.normalizePath)(`${folderPath}/${session.id}.json`);
  try {
    if (await vault.adapter.exists(legacy)) await vault.adapter.remove(legacy);
  } catch (e) {
  }
}
async function loadChatSession(vault, folderPath, id) {
  const path = (0, import_obsidian9.normalizePath)(`${folderPath}/${id}.md`);
  const legacyPath = (0, import_obsidian9.normalizePath)(`${folderPath}/${id}.json`);
  try {
    let raw;
    if (await vault.adapter.exists(path)) {
      raw = await vault.adapter.read(path);
    } else if (await vault.adapter.exists(legacyPath)) {
      raw = await vault.adapter.read(legacyPath);
    } else {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!isValidChatSession(parsed)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}
async function listChatSessions(vault, folderPath) {
  const p = (0, import_obsidian9.normalizePath)(folderPath);
  try {
    if (!await vault.adapter.exists(p)) return [];
    const listed = await vault.adapter.list(p);
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const filePath of listed.files) {
      if (!filePath.endsWith(".md") && !filePath.endsWith(".json")) continue;
      try {
        const raw = await vault.adapter.read(filePath);
        const parsed = JSON.parse(raw);
        if (isValidChatSession(parsed) && !seen.has(parsed.id)) {
          seen.add(parsed.id);
          out.push(parsed);
        }
      } catch (e) {
      }
    }
    out.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return a.updated < b.updated ? 1 : -1;
    });
    return out;
  } catch (e) {
    return [];
  }
}
async function togglePinSession(vault, folderPath, id) {
  const session = await loadChatSession(vault, folderPath, id);
  if (!session) return false;
  session.pinned = !session.pinned;
  await saveChatSession(vault, folderPath, session);
  return session.pinned;
}
async function renameSession(vault, folderPath, id, newTitle) {
  const session = await loadChatSession(vault, folderPath, id);
  if (!session) return;
  session.title = newTitle;
  await saveChatSession(vault, folderPath, session);
}
async function deleteChatSessionFile(vault, folderPath, id) {
  const path = (0, import_obsidian9.normalizePath)(`${folderPath}/${id}.md`);
  const legacy = (0, import_obsidian9.normalizePath)(`${folderPath}/${id}.json`);
  try {
    if (await vault.adapter.exists(path)) await vault.adapter.remove(path);
    if (await vault.adapter.exists(legacy)) await vault.adapter.remove(legacy);
  } catch (e) {
  }
}
function shouldPruneToday() {
  try {
    const last = localStorage.getItem(PRUNE_THROTTLE_KEY);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (last === today) return false;
    localStorage.setItem(PRUNE_THROTTLE_KEY, today);
    return true;
  } catch (e) {
    return true;
  }
}
async function pruneOldSessions(vault, folderPath, retentionDays) {
  if (retentionDays <= 0) return 0;
  if (!shouldPruneToday()) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1e3;
  const sessions = await listChatSessions(vault, folderPath);
  let removed = 0;
  for (const s of sessions) {
    const t = Date.parse(s.updated);
    if (!Number.isNaN(t) && t < cutoff) {
      await deleteChatSessionFile(vault, folderPath, s.id);
      removed++;
    }
  }
  return removed;
}

// src/modes-serializer.ts
function yamlEscape(s) {
  if (/[:#\[\]{},&*!|>'"%@`\n]/.test(s) || /^[-?]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}
function serializeMode(m) {
  const lines = [];
  lines.push(`- id: ${m.id}`);
  lines.push(`  label: ${yamlEscape(m.label)}`);
  lines.push(`  emoji: ${yamlEscape(m.emoji || "\u{1F4CB}")}`);
  if (m.files.length === 0) {
    lines.push(`  files: []`);
  } else {
    lines.push(`  files:`);
    for (const f of m.files) lines.push(`    - ${f}`);
  }
  if (m.actions.length === 0) {
    lines.push(`  actions: []`);
  } else {
    lines.push(`  actions:`);
    for (const a of m.actions) {
      lines.push(`    - label: ${yamlEscape(a.label)}`);
      if (a.icon) lines.push(`      icon: ${a.icon}`);
      lines.push(`      prompt: ${yamlEscape(a.prompt)}`);
    }
  }
  return lines.join("\n");
}
function serializeModesToContent(modes) {
  const yamlLines = ["```yaml modes"];
  for (const m of modes) yamlLines.push(serializeMode(m));
  yamlLines.push("```");
  const sections = [];
  for (const m of modes) {
    sections.push("");
    sections.push(`## ${m.id}`);
    sections.push("");
    sections.push(m.systemPromptAppend.trim());
  }
  return yamlLines.join("\n") + "\n" + sections.join("\n") + "\n";
}

// src/workspace-studio.ts
var WorkspaceStudio = class {
  constructor(container, plugin, callbacks) {
    this.projectIndex = null;
    this.sessions = [];
    this.screen = "home";
    this.selectedWorkspace = null;
    this.selectedModeIndex = -1;
    this.editingModes = [];
    this.workspaceLevelFiles = [];
    this.dirty = false;
    this.container = container;
    this.plugin = plugin;
    this.app = plugin.app;
    this.callbacks = callbacks;
  }
  async render() {
    this.container.empty();
    this.container.addClass("ws-studio");
    await this.loadData();
    switch (this.screen) {
      case "home":
        this.renderHome();
        break;
      case "workspace":
        await this.renderWorkspace();
        break;
      case "mode":
        this.renderMode();
        break;
    }
  }
  async loadData() {
    this.projectIndex = await loadProjectIndex(
      this.app.vault,
      this.app.metadataCache,
      this.plugin.settings.harnessProjectsFolder
    );
    this.sessions = await listChatSessions(
      this.app.vault,
      this.plugin.settings.chatHistoryFolder
    );
  }
  // ── 3c: Studio Home ─────────────────────────────────────
  renderHome() {
    var _a, _b;
    const head = this.container.createDiv({ cls: "ws-studio-head" });
    const backBtn = head.createEl("button", { cls: "ws-studio-back", attr: { "aria-label": "\u8FD4\u56DE" } });
    const backIcon = backBtn.createSpan({ cls: "ws-studio-back-icon" });
    (0, import_obsidian10.setIcon)(backIcon, "chevron-left");
    backBtn.addEventListener("click", () => this.callbacks.onClose());
    const addBtn = head.createEl("button", { cls: "ws-studio-head-action" });
    const addIcon = addBtn.createSpan({ cls: "ws-studio-head-action-icon" });
    (0, import_obsidian10.setIcon)(addIcon, "plus");
    addBtn.createSpan({ text: "\u65B0\u5EFA" });
    addBtn.addEventListener("click", () => this.openCreateWorkspaceModal());
    const searchWrap = this.container.createDiv({ cls: "ws-studio-search" });
    const searchIcon = searchWrap.createSpan({ cls: "ws-studio-search-icon" });
    (0, import_obsidian10.setIcon)(searchIcon, "search");
    const searchInput = searchWrap.createEl("input", {
      cls: "ws-studio-search-input",
      attr: { placeholder: "\u641C\u7D22\u5DE5\u4F5C\u533A\u2026", type: "text" }
    });
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase();
      const rows = this.container.querySelectorAll(".ws-studio-ws-row");
      rows.forEach((row) => {
        var _a2, _b2;
        const name = (_b2 = (_a2 = row.dataset.name) == null ? void 0 : _a2.toLowerCase()) != null ? _b2 : "";
        row.style.display = name.includes(q) ? "" : "none";
      });
    });
    const allProjects = (_b = (_a = this.projectIndex) == null ? void 0 : _a.projects) != null ? _b : [];
    const activeProjects = allProjects.filter((p) => p.status !== "archive");
    const archivedProjects = allProjects.filter((p) => p.status === "archive");
    if (activeProjects.length > 0) {
      const secHead = this.container.createDiv({ cls: "ws-studio-sec-head" });
      secHead.createSpan({ cls: "ws-studio-sec-label", text: "\u6D3B\u8DC3" });
      secHead.createSpan({ cls: "ws-studio-sec-count", text: String(activeProjects.length) });
      const list = this.container.createDiv({ cls: "ws-studio-ws-list" });
      for (const p of activeProjects) {
        this.renderWorkspaceRow(list, p.name, false);
      }
    }
    if (archivedProjects.length > 0) {
      const secHead = this.container.createDiv({ cls: "ws-studio-sec-head" });
      secHead.createSpan({ cls: "ws-studio-sec-label", text: "\u5DF2\u5F52\u6863" });
      secHead.createSpan({ cls: "ws-studio-sec-count", text: String(archivedProjects.length) });
      const list = this.container.createDiv({ cls: "ws-studio-ws-list" });
      for (const p of archivedProjects) {
        this.renderWorkspaceRow(list, p.name, true);
      }
    }
  }
  renderWorkspaceRow(parent, name, archived) {
    var _a;
    const row = parent.createDiv({ cls: "ws-studio-ws-row" });
    row.dataset.name = name;
    if (archived) row.addClass("ws-studio-ws-archived");
    const iconWrap = row.createDiv({ cls: "ws-studio-ws-icon" });
    (0, import_obsidian10.setIcon)(iconWrap, archived ? "archive" : "folder");
    const info = row.createDiv({ cls: "ws-studio-ws-info" });
    info.createDiv({ cls: "ws-studio-ws-name", text: name });
    const projectsFolder = this.plugin.settings.harnessProjectsFolder;
    const modesPath = `${projectsFolder}/${name}/modes.md`;
    const modesFile = this.app.vault.getAbstractFileByPath(modesPath);
    const wsSessions = this.sessions.filter(
      (s) => {
        var _a2;
        return (s.workspace || ((_a2 = s.harnessContext) == null ? void 0 : _a2.workspace)) === name;
      }
    );
    const lastUsed = wsSessions.length > 0 ? this.formatRelativeTime(wsSessions[0].updated) : "";
    if (modesFile instanceof import_obsidian10.TFile) {
      void this.app.vault.read(modesFile).then((content) => {
        const modes = parseModesFromContent(content);
        const actionCount = modes.reduce((sum, m) => sum + m.actions.length, 0);
        const metaParts = [];
        metaParts.push(`${modes.length} \u6A21\u5F0F`);
        if (actionCount > 0) metaParts.push(`${actionCount} action`);
        if (archived) {
          const archivedDate = this.getArchivedDate(name);
          if (archivedDate) metaParts.push(`\u5F52\u6863\u4E8E ${archivedDate}`);
        } else if (lastUsed) {
          metaParts.push(lastUsed);
        }
        const metaEl = info.querySelector(".ws-studio-ws-meta");
        if (metaEl) metaEl.textContent = metaParts.join(" \xB7 ");
      });
    }
    info.createDiv({ cls: "ws-studio-ws-meta", text: "\u2026" });
    if (archived) {
      const restoreBtn = row.createEl("button", { cls: "ws-studio-ws-restore", text: "\u6062\u590D" });
      restoreBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void this.unarchiveWorkspace(name);
      });
    } else {
      const active = (_a = this.projectIndex) == null ? void 0 : _a.activeProject;
      if (name === active) {
        row.createSpan({ cls: "ws-studio-ws-dot" });
      }
      const chevron = row.createSpan({ cls: "ws-studio-ws-chevron" });
      (0, import_obsidian10.setIcon)(chevron, "chevron-right");
    }
    row.addEventListener("click", () => {
      if (archived) return;
      this.navigateTo("workspace", name);
    });
  }
  // ── 3a: Workspace Overview ──────────────────────────────
  async renderWorkspace() {
    const name = this.selectedWorkspace;
    if (this.editingModes.length === 0 || !this.dirty) {
      const projectsFolder = this.plugin.settings.harnessProjectsFolder;
      const modesPath = `${projectsFolder}/${name}/modes.md`;
      const file = this.app.vault.getAbstractFileByPath(modesPath);
      if (file instanceof import_obsidian10.TFile) {
        const content = await this.app.vault.read(file);
        this.editingModes = parseModesFromContent(content);
      } else {
        this.editingModes = [];
      }
      this.dirty = false;
    }
    const head = this.container.createDiv({ cls: "ws-studio-head" });
    const backBtn = head.createEl("button", { cls: "ws-studio-back", attr: { "aria-label": "\u8FD4\u56DE" } });
    const backIcon = backBtn.createSpan({ cls: "ws-studio-back-icon" });
    (0, import_obsidian10.setIcon)(backIcon, "chevron-left");
    backBtn.addEventListener("click", () => this.navigateTo("home"));
    const addBtn = head.createEl("button", { cls: "ws-studio-head-action" });
    const addIcon = addBtn.createSpan({ cls: "ws-studio-head-action-icon" });
    (0, import_obsidian10.setIcon)(addIcon, "plus");
    addBtn.createSpan({ text: "\u65B0\u5EFA\u5DE5\u4F5C\u533A" });
    addBtn.addEventListener("click", () => this.openCreateWorkspaceModal());
    const identity = this.container.createDiv({ cls: "ws-studio-identity" });
    identity.createDiv({ cls: "ws-studio-identity-label", text: "\u5DE5\u4F5C\u533A" });
    const nameRow = identity.createDiv({ cls: "ws-studio-identity-name-row" });
    const wsIcon = nameRow.createDiv({ cls: "ws-studio-identity-icon" });
    (0, import_obsidian10.setIcon)(wsIcon, "folder");
    const nameInput = nameRow.createEl("input", {
      cls: "ws-studio-identity-input",
      attr: { value: name, readonly: "" }
    });
    const injLabel = identity.createDiv({ cls: "ws-studio-inject-label" });
    injLabel.createSpan({ text: "\u5DE5\u4F5C\u533A\u7EA7\u6CE8\u5165" });
    injLabel.createSpan({ cls: "ws-studio-inject-sep" });
    const injPills = identity.createDiv({ cls: "ws-studio-inject-pills" });
    this.renderWorkspaceLevelFiles(injPills);
    const modesSec = this.container.createDiv({ cls: "ws-studio-sec-head" });
    modesSec.createSpan({ cls: "ws-studio-sec-label", text: "\u6A21\u5F0F" });
    const totalActions = this.editingModes.reduce((s, m) => s + m.actions.length, 0);
    modesSec.createSpan({
      cls: "ws-studio-sec-count",
      text: `${this.editingModes.length} \u4E2A\u6A21\u5F0F \xB7 ${totalActions} \u4E2A Action`
    });
    const modeList = this.container.createDiv({ cls: "ws-studio-mode-list" });
    for (let i = 0; i < this.editingModes.length; i++) {
      this.renderModeRow(modeList, i);
    }
    const addMode = modeList.createDiv({ cls: "ws-studio-mode-add" });
    const addModeIcon = addMode.createSpan({ cls: "ws-studio-mode-add-icon" });
    (0, import_obsidian10.setIcon)(addModeIcon, "plus");
    addMode.createSpan({ text: "\u65B0\u5EFA\u6A21\u5F0F" });
    addMode.addEventListener("click", () => {
      this.editingModes.push({
        id: `mode-${this.editingModes.length + 1}`,
        label: "\u65B0\u6A21\u5F0F",
        emoji: "\u{1F4CB}",
        files: [],
        systemPromptAppend: "",
        actions: []
      });
      this.dirty = true;
      this.navigateTo("mode", this.selectedWorkspace, this.editingModes.length - 1);
    });
    const footer = this.container.createDiv({ cls: "ws-studio-footer" });
    const saveBtn = footer.createEl("button", { cls: "ws-studio-save-btn" });
    const saveIcon = saveBtn.createSpan({ cls: "ws-studio-save-icon" });
    (0, import_obsidian10.setIcon)(saveIcon, "check");
    saveBtn.createSpan({ text: "\u4FDD\u5B58\u5DE5\u4F5C\u533A" });
    saveBtn.addEventListener("click", async () => {
      await this.save();
    });
    const deleteBtn = footer.createEl("button", { cls: "ws-studio-delete-btn" });
    (0, import_obsidian10.setIcon)(deleteBtn, "trash-2");
    const delSvg = deleteBtn.querySelector("svg");
    if (delSvg) {
      delSvg.style.width = "20px";
      delSvg.style.height = "20px";
    }
    deleteBtn.addEventListener("click", async () => {
      await this.archiveWorkspace(name);
      this.navigateTo("home");
    });
  }
  renderModeRow(parent, index) {
    const mode = this.editingModes[index];
    const row = parent.createDiv({ cls: "ws-studio-mode-row" });
    const iconWrap = row.createDiv({ cls: "ws-studio-mode-icon" });
    iconWrap.textContent = mode.emoji;
    const info = row.createDiv({ cls: "ws-studio-mode-info" });
    info.createDiv({ cls: "ws-studio-mode-name", text: mode.label });
    const metaParts = [];
    metaParts.push(`${mode.files.length} files`);
    if (mode.actions.length > 0) {
      metaParts.push(`${mode.actions.length} action${mode.actions.length > 1 ? "s" : ""}`);
    } else {
      metaParts.push("\u65E0 action");
    }
    info.createDiv({ cls: "ws-studio-mode-meta", text: metaParts.join(" \xB7 ") });
    if (mode.actions.length > 0) {
      const badge = row.createSpan({ cls: "ws-studio-mode-badge" });
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>';
      badge.createSpan({ text: String(mode.actions.length) });
    }
    const chevron = row.createSpan({ cls: "ws-studio-mode-chevron" });
    (0, import_obsidian10.setIcon)(chevron, "chevron-right");
    row.addEventListener("click", () => {
      this.navigateTo("mode", this.selectedWorkspace, index);
    });
  }
  renderWorkspaceLevelFiles(container) {
    container.empty();
    const addPill = container.createDiv({ cls: "ws-studio-inject-add" });
    const addIcon = addPill.createSpan({ cls: "ws-studio-inject-add-icon" });
    (0, import_obsidian10.setIcon)(addIcon, "plus");
    addPill.createSpan({ text: "\u6DFB\u52A0" });
  }
  // ── 3b: Mode Editor ─────────────────────────────────────
  renderMode() {
    const mode = this.editingModes[this.selectedModeIndex];
    if (!mode) return;
    const head = this.container.createDiv({ cls: "ws-studio-head" });
    const backBtn = head.createEl("button", { cls: "ws-studio-back" });
    const backIcon = backBtn.createSpan({ cls: "ws-studio-back-icon" });
    (0, import_obsidian10.setIcon)(backIcon, "chevron-left");
    const breadcrumb = backBtn.createSpan();
    breadcrumb.createSpan({ cls: "ws-studio-breadcrumb-ws", text: this.selectedWorkspace });
    breadcrumb.createSpan({ cls: "ws-studio-breadcrumb-sep", text: " / " });
    breadcrumb.createSpan({ cls: "ws-studio-breadcrumb-mode", text: mode.label });
    backBtn.addEventListener("click", () => this.navigateTo("workspace", this.selectedWorkspace));
    const saveLink = head.createEl("button", { cls: "ws-studio-head-save", text: "\u4FDD\u5B58" });
    saveLink.addEventListener("click", async () => {
      await this.save();
    });
    const nameSection = this.container.createDiv({ cls: "ws-studio-editor-section" });
    nameSection.createDiv({ cls: "ws-studio-editor-label", text: "\u6A21\u5F0F\u540D\u79F0" });
    const nameRow = nameSection.createDiv({ cls: "ws-studio-identity-name-row" });
    const nameInput = nameRow.createEl("input", {
      cls: "ws-studio-identity-input",
      attr: { value: mode.label }
    });
    nameInput.addEventListener("input", () => {
      mode.label = nameInput.value;
      this.dirty = true;
    });
    const metaRow = nameSection.createDiv({ cls: "ws-studio-mode-meta-row" });
    const idWrap = metaRow.createDiv({ cls: "ws-studio-mode-meta-field" });
    idWrap.createSpan({ cls: "ws-studio-mode-meta-label", text: "ID" });
    const idInput = idWrap.createEl("input", {
      cls: "ws-studio-mode-meta-input",
      attr: { value: mode.id }
    });
    idInput.addEventListener("input", () => {
      mode.id = idInput.value;
      this.dirty = true;
    });
    const emojiWrap = metaRow.createDiv({ cls: "ws-studio-mode-meta-field" });
    emojiWrap.createSpan({ cls: "ws-studio-mode-meta-label", text: "\u56FE\u6807" });
    const emojiInput = emojiWrap.createEl("input", {
      cls: "ws-studio-mode-meta-input ws-studio-mode-meta-emoji",
      attr: { value: mode.emoji, maxlength: "2" }
    });
    emojiInput.addEventListener("input", () => {
      mode.emoji = emojiInput.value;
      this.dirty = true;
    });
    const promptSection = this.container.createDiv({ cls: "ws-studio-editor-section" });
    const promptHead = promptSection.createDiv({ cls: "ws-studio-editor-label-row" });
    promptHead.createSpan({ cls: "ws-studio-editor-label", text: "\u7CFB\u7EDF\u63D0\u793A" });
    const charCount = promptSection.createSpan({
      cls: "ws-studio-editor-count",
      text: `${mode.systemPromptAppend.length} \u5B57`
    });
    promptHead.appendChild(charCount);
    const promptEl = promptSection.createEl("textarea", { cls: "ws-studio-editor-prompt" });
    promptEl.value = mode.systemPromptAppend;
    promptEl.rows = 6;
    promptEl.setAttribute("placeholder", "System prompt...");
    promptEl.addEventListener("input", () => {
      mode.systemPromptAppend = promptEl.value;
      charCount.textContent = `${promptEl.value.length} \u5B57`;
      this.dirty = true;
    });
    const ctxSection = this.container.createDiv({ cls: "ws-studio-editor-section" });
    ctxSection.createDiv({
      cls: "ws-studio-editor-label",
      text: `\u6CE8\u5165\u4E0A\u4E0B\u6587 \xB7 ${mode.files.length}`
    });
    const filesList = ctxSection.createDiv({ cls: "ws-studio-editor-files" });
    const renderFiles = () => {
      filesList.empty();
      for (let fi = 0; fi < mode.files.length; fi++) {
        const filePath = mode.files[fi];
        const fileRow = filesList.createDiv({ cls: "ws-studio-editor-file" });
        const fIcon = fileRow.createSpan({ cls: "ws-studio-editor-file-icon" });
        (0, import_obsidian10.setIcon)(fIcon, "file-text");
        const displayName = filePath.replace(/^.*\//, "").replace(/\.md$/, "");
        fileRow.createSpan({ cls: "ws-studio-editor-file-name", text: displayName });
        fileRow.setAttribute("title", filePath);
        const removeBtn = fileRow.createSpan({ cls: "ws-studio-editor-file-remove" });
        (0, import_obsidian10.setIcon)(removeBtn, "x");
        removeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          mode.files.splice(fi, 1);
          this.dirty = true;
          renderFiles();
          ctxSection.querySelector(".ws-studio-editor-label").textContent = `\u6CE8\u5165\u4E0A\u4E0B\u6587 \xB7 ${mode.files.length}`;
        });
      }
      const addFileBtn = filesList.createDiv({ cls: "ws-studio-editor-file-add" });
      const afIcon = addFileBtn.createSpan({ cls: "ws-studio-editor-file-add-icon" });
      (0, import_obsidian10.setIcon)(afIcon, "plus");
      addFileBtn.createSpan({ text: "\u6DFB\u52A0\u6587\u4EF6 / \u6587\u4EF6\u5939" });
      addFileBtn.addEventListener("click", () => {
        new FileSuggestModal(this.app, (path) => {
          if (!mode.files.includes(path)) {
            mode.files.push(path);
            this.dirty = true;
            renderFiles();
            ctxSection.querySelector(".ws-studio-editor-label").textContent = `\u6CE8\u5165\u4E0A\u4E0B\u6587 \xB7 ${mode.files.length}`;
          }
        }).open();
      });
    };
    renderFiles();
    const actSection = this.container.createDiv({ cls: "ws-studio-editor-section ws-studio-editor-actions" });
    const actHead = actSection.createDiv({ cls: "ws-studio-editor-label-row ws-studio-editor-actions-head" });
    const boltIcon = actHead.createSpan({ cls: "ws-studio-editor-bolt" });
    (0, import_obsidian10.setIcon)(boltIcon, "zap");
    const boltSvg = boltIcon.querySelector("svg");
    if (boltSvg) {
      boltSvg.style.width = "14px";
      boltSvg.style.height = "14px";
    }
    actHead.createSpan({
      cls: "ws-studio-editor-label ws-studio-editor-label--accent",
      text: `\u4E00\u952E Action \xB7 ${mode.actions.length}`
    });
    const actionsList = actSection.createDiv({ cls: "ws-studio-editor-actions-list" });
    const renderActions = () => {
      actionsList.empty();
      for (let j = 0; j < mode.actions.length; j++) {
        const action = mode.actions[j];
        const actionCard = actionsList.createDiv({ cls: "ws-studio-editor-action" });
        const actionRow = actionCard.createDiv({ cls: "ws-studio-editor-action-head" });
        const labelInput = actionRow.createEl("input", {
          cls: "ws-studio-editor-action-label",
          attr: { value: action.label, placeholder: "Action \u540D\u79F0" }
        });
        labelInput.addEventListener("input", () => {
          action.label = labelInput.value;
          this.dirty = true;
        });
        const editBtn = actionRow.createSpan({ cls: "ws-studio-editor-action-edit" });
        (0, import_obsidian10.setIcon)(editBtn, "pencil");
        const removeBtn = actionRow.createSpan({ cls: "ws-studio-editor-action-remove" });
        (0, import_obsidian10.setIcon)(removeBtn, "x");
        removeBtn.addEventListener("click", () => {
          mode.actions.splice(j, 1);
          this.dirty = true;
          renderActions();
          actHead.querySelector(".ws-studio-editor-label").textContent = `\u4E00\u952E Action \xB7 ${mode.actions.length}`;
        });
        const promptInput = actionCard.createEl("textarea", {
          cls: "ws-studio-editor-action-prompt",
          attr: { placeholder: "Action prompt\u2026", rows: "2" }
        });
        promptInput.value = action.prompt;
        promptInput.addEventListener("input", () => {
          action.prompt = promptInput.value;
          this.dirty = true;
        });
      }
      const addAction = actionsList.createDiv({ cls: "ws-studio-editor-action-add" });
      const addAIcon = addAction.createSpan({ cls: "ws-studio-editor-action-add-icon" });
      (0, import_obsidian10.setIcon)(addAIcon, "plus");
      addAction.createSpan({ text: "\u65B0\u5EFA Action" });
      addAction.addEventListener("click", () => {
        mode.actions.push({ label: "\u65B0 Action", prompt: "" });
        this.dirty = true;
        renderActions();
        actHead.querySelector(".ws-studio-editor-label").textContent = `\u4E00\u952E Action \xB7 ${mode.actions.length}`;
      });
    };
    renderActions();
    const dangerSection = this.container.createDiv({ cls: "ws-studio-editor-danger" });
    const deleteBtn = dangerSection.createEl("button", { cls: "ws-studio-editor-delete-mode" });
    (0, import_obsidian10.setIcon)(deleteBtn, "trash-2");
    const delModeSvg = deleteBtn.querySelector("svg");
    if (delModeSvg) {
      delModeSvg.style.width = "15px";
      delModeSvg.style.height = "15px";
    }
    deleteBtn.createSpan({ text: "\u5220\u9664\u6B64\u6A21\u5F0F" });
    deleteBtn.addEventListener("click", () => {
      this.editingModes.splice(this.selectedModeIndex, 1);
      this.dirty = true;
      this.navigateTo("workspace", this.selectedWorkspace);
    });
  }
  navigateTo(screen, workspace, modeIndex) {
    this.screen = screen;
    if (workspace !== void 0) this.selectedWorkspace = workspace;
    if (modeIndex !== void 0) this.selectedModeIndex = modeIndex;
    if (screen === "home") {
      this.selectedWorkspace = null;
      this.selectedModeIndex = -1;
      this.editingModes = [];
      this.dirty = false;
    }
    void this.render();
  }
  // ── Data helpers ────────────────────────────────────────
  formatRelativeTime(dateStr) {
    const now = Date.now();
    const then = Date.parse(dateStr);
    if (isNaN(then)) return "";
    const diff = now - then;
    const mins = Math.floor(diff / 6e4);
    if (mins < 60) return "\u521A\u521A";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "\u6628\u5929";
    if (days < 7) return `${days} \u5929\u524D`;
    if (days < 30) return "\u4E0A\u5468";
    return `${Math.floor(days / 30)} \u6708\u524D`;
  }
  getArchivedDate(_name) {
    return "";
  }
  // ── CRUD ────────────────────────────────────────────────
  async switchWorkspace(name) {
    const projectsFolder = this.plugin.settings.harnessProjectsFolder;
    const indexPath = `${projectsFolder}/_INDEX.md`;
    const file = this.app.vault.getAbstractFileByPath(indexPath);
    if (!(file instanceof import_obsidian10.TFile)) return;
    let content = await this.app.vault.read(file);
    if (/^active_project:/m.test(content)) {
      content = content.replace(/^(active_project:\s*).*$/m, `$1${name}`);
    } else {
      content = `---
active_project: ${name}
---

${content}`;
    }
    await this.app.vault.modify(file, content);
  }
  openCreateWorkspaceModal() {
    new CreateWorkspaceModal(this.app, this.plugin, async (name) => {
      await this.createWorkspace(name);
      await this.render();
    }).open();
  }
  async createWorkspace(name) {
    const projectsFolder = this.plugin.settings.harnessProjectsFolder;
    const adapter = this.app.vault.adapter;
    const wsFolder = `${projectsFolder}/${name}`;
    if (!await adapter.exists(projectsFolder)) {
      await adapter.mkdir(projectsFolder);
    }
    if (!await adapter.exists(wsFolder)) {
      await adapter.mkdir(wsFolder);
    }
    const modesPath = `${wsFolder}/modes.md`;
    if (!this.app.vault.getAbstractFileByPath(modesPath)) {
      const template = defaultModesTemplate();
      await this.app.vault.create(modesPath, template);
    }
    const indexPath = `${projectsFolder}/_INDEX.md`;
    const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
    let indexContent;
    if (indexFile instanceof import_obsidian10.TFile) {
      indexContent = await this.app.vault.read(indexFile);
    } else {
      indexContent = `---
active_project: ${name}
active_work_context: 
---

| \u9879\u76EE | \u72B6\u6001 | \u6765\u6E90 | \u6700\u8FD1\u66F4\u65B0 |
|------|------|------|----------|
`;
    }
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const newRow = `| ${name} | active | manual | ${today} |`;
    if (!indexContent.includes(`| ${name} |`)) {
      indexContent = indexContent.trimEnd() + "\n" + newRow + "\n";
    }
    if (/^active_project:/m.test(indexContent)) {
      indexContent = indexContent.replace(/^(active_project:\s*).*$/m, `$1${name}`);
    }
    if (indexFile instanceof import_obsidian10.TFile) {
      await this.app.vault.modify(indexFile, indexContent);
    } else {
      await this.app.vault.create(indexPath, indexContent);
    }
    new import_obsidian10.Notice(`\u5DF2\u521B\u5EFA workspace\u300C${name}\u300D`);
  }
  async archiveWorkspace(name) {
    await this.setWorkspaceStatus(name, "archive");
    new import_obsidian10.Notice(`\u5DF2\u5F52\u6863\u300C${name}\u300D`);
  }
  async unarchiveWorkspace(name) {
    await this.setWorkspaceStatus(name, "active");
    new import_obsidian10.Notice(`\u5DF2\u6062\u590D\u300C${name}\u300D`);
    await this.render();
  }
  async setWorkspaceStatus(name, status) {
    const projectsFolder = this.plugin.settings.harnessProjectsFolder;
    const indexPath = `${projectsFolder}/_INDEX.md`;
    const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
    if (!(indexFile instanceof import_obsidian10.TFile)) return;
    let content = await this.app.vault.read(indexFile);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rowRe = new RegExp(`^(\\|\\s*${escaped}\\s*\\|)\\s*\\w+\\s*\\|`, "m");
    content = content.replace(rowRe, `$1 ${status} |`);
    await this.app.vault.modify(indexFile, content);
  }
  async save() {
    if (!this.selectedWorkspace) return;
    const modesPath = `${this.plugin.settings.harnessProjectsFolder}/${this.selectedWorkspace}/modes.md`;
    const content = serializeModesToContent(this.editingModes);
    const adapter = this.app.vault.adapter;
    await adapter.write(modesPath, content);
    this.dirty = false;
    new import_obsidian10.Notice("\u5DF2\u4FDD\u5B58 modes.md");
  }
  destroy() {
    this.container.empty();
    this.container.removeClass("ws-studio");
  }
};
function defaultModesTemplate() {
  return `\`\`\`yaml modes
- id: default
  label: \u9ED8\u8BA4
  emoji: "\u{1F4AC}"
  files: []
  actions: []
\`\`\`

## default

You are a helpful assistant.
`;
}
var CreateWorkspaceModal = class extends import_obsidian10.Modal {
  constructor(app, plugin, onSubmit) {
    super(app);
    this.nameValue = "";
    this.plugin = plugin;
    this.onSubmit = onSubmit;
    this.modalEl.addClass("ai-daily-modal-sm");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "\u65B0\u5EFA Workspace" });
    new import_obsidian10.Setting(contentEl).setName("\u540D\u79F0").addText((text) => {
      text.setPlaceholder("\u4F8B\u5982: my-project").onChange((v) => {
        this.nameValue = v.trim();
      });
      text.inputEl.focus();
    });
    new import_obsidian10.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("\u521B\u5EFA").setCta().onClick(async () => {
        const name = this.nameValue.trim();
        if (!name) {
          new import_obsidian10.Notice("\u8BF7\u8F93\u5165 workspace \u540D\u79F0");
          return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          new import_obsidian10.Notice("\u540D\u79F0\u53EA\u5141\u8BB8\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u3001\u8FDE\u5B57\u7B26");
          return;
        }
        this.onSubmit(name);
        this.close();
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};
var FileSuggestModal = class extends import_obsidian10.FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("\u641C\u7D22 vault \u4E2D\u7684\u6587\u4EF6\u2026");
  }
  getItems() {
    return this.app.vault.getMarkdownFiles();
  }
  getItemText(item) {
    return item.path;
  }
  onChooseSuggestion(item) {
    this.onChoose(item.item.path);
  }
  onChooseItem(item) {
    this.onChoose(item.path);
  }
};

// src/image-tools.ts
var SUPPORTED_EXTENSIONS = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif"
};
var WIKILINK_IMG_RE = /!\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g;
var MARKDOWN_IMG_RE = /!\[[^\]]*?\]\((?!https?:\/\/)([^)]+?)\)/g;
function extractLocalImageRefs(text) {
  const seen = /* @__PURE__ */ new Set();
  const refs = [];
  const collect = (raw, path) => {
    var _a, _b;
    const ext = (_b = (_a = path.split(".").pop()) == null ? void 0 : _a.toLowerCase()) != null ? _b : "";
    if (!(ext in SUPPORTED_EXTENSIONS)) return;
    if (seen.has(path)) return;
    seen.add(path);
    refs.push({ raw, path });
  };
  for (const m of text.matchAll(WIKILINK_IMG_RE)) {
    collect(m[0], m[1].trim());
  }
  for (const m of text.matchAll(MARKDOWN_IMG_RE)) {
    collect(m[0], decodeURIComponent(m[1].trim()));
  }
  return refs;
}
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
var TARGET_BYTES = 3e5;
var MAX_DIMENSION = 1200;
var JPEG_QUALITY_START = 0.75;
var JPEG_QUALITY_MIN = 0.4;
function loadImage(buf, mediaType) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buf], { type: mediaType });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("\u56FE\u7247\u52A0\u8F7D\u5931\u8D25"));
    };
    img.src = url;
  });
}
function compressToJpeg(img, maxDim, quality) {
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.split(",")[1];
}
async function compressImage(buf, mediaType) {
  const originalBase64 = arrayBufferToBase64(buf);
  const originalBytes = Math.ceil(originalBase64.length * 3 / 4);
  if (originalBytes <= TARGET_BYTES) {
    return { base64: originalBase64, mediaType };
  }
  if (mediaType === "image/gif") {
    return { base64: originalBase64, mediaType: "image/gif" };
  }
  try {
    const img = await loadImage(buf, mediaType);
    let quality = JPEG_QUALITY_START;
    let base64 = compressToJpeg(img, MAX_DIMENSION, quality);
    while (Math.ceil(base64.length * 3 / 4) > TARGET_BYTES && quality > JPEG_QUALITY_MIN) {
      quality -= 0.1;
      base64 = compressToJpeg(img, MAX_DIMENSION, quality);
    }
    return { base64, mediaType: "image/jpeg" };
  } catch (e) {
    return { base64: originalBase64, mediaType };
  }
}
async function prepareLocalImages(app, refs, opts) {
  var _a, _b, _c, _d;
  const maxImages = (_a = opts == null ? void 0 : opts.maxImages) != null ? _a : 3;
  const maxBytes = (_b = opts == null ? void 0 : opts.maxBytes) != null ? _b : 10485760;
  const images = [];
  const skipped = [];
  for (const ref of refs) {
    if (images.length >= maxImages) {
      skipped.push({ ref, reason: `\u8D85\u8FC7\u5355\u6B21\u4E0A\u9650 ${maxImages} \u5F20` });
      continue;
    }
    const ext = (_d = (_c = ref.path.split(".").pop()) == null ? void 0 : _c.toLowerCase()) != null ? _d : "";
    const mediaType = SUPPORTED_EXTENSIONS[ext];
    if (!mediaType) {
      skipped.push({ ref, reason: `\u4E0D\u652F\u6301\u7684\u683C\u5F0F: .${ext}` });
      continue;
    }
    const file = app.vault.getFiles().find((f) => {
      if (f.path === ref.path) return true;
      if (f.name === ref.path) return true;
      if (f.path.endsWith("/" + ref.path)) return true;
      return false;
    });
    if (!file) {
      skipped.push({ ref, reason: "\u6587\u4EF6\u672A\u627E\u5230" });
      continue;
    }
    try {
      const buf = await app.vault.readBinary(file);
      if (buf.byteLength > maxBytes) {
        const sizeMB = (buf.byteLength / 1048576).toFixed(1);
        const limitMB = (maxBytes / 1048576).toFixed(1);
        skipped.push({
          ref,
          reason: `\u6587\u4EF6\u8FC7\u5927 (${sizeMB}MB > ${limitMB}MB)`
        });
        continue;
      }
      const compressed = await compressImage(buf, mediaType);
      images.push({
        ref,
        mediaType: compressed.mediaType,
        base64: compressed.base64
      });
    } catch (e) {
      skipped.push({ ref, reason: "\u8BFB\u53D6\u5931\u8D25" });
    }
  }
  return { images, skipped };
}

// src/markdown-normalize.ts
function normalizeMarkdownForObsidian(markdown) {
  let fence = null;
  return markdown.split("\n").map((line) => {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === marker) fence = null;
      else if (fence === null) fence = marker;
      return line;
    }
    if (fence !== null) return line;
    return line.split(/(`+[^`]*`+)/g).map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(/\\\[/g, () => "$$").replace(/\\\]/g, () => "$$").replace(/\\\(/g, "$").replace(/\\\)/g, "$");
    }).join("");
  }).join("\n");
}

// src/knowledge-agent.ts
var MAX_NOTES_PER_RUN = 5;
var ORGANIZED_MARKER = "organized";
async function findUnorganizedNotes(app, folder) {
  return app.vault.getMarkdownFiles().filter((f) => {
    var _a;
    if (!f.path.startsWith(folder + "/") && f.path !== folder) return false;
    const cache = app.metadataCache.getFileCache(f);
    if (((_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a[ORGANIZED_MARKER]) === true) return false;
    return true;
  });
}
async function wikiHealthCheck(app, folders) {
  const normalizedFolders = folders.map((f) => f.replace(/\/+$/, "")).filter(Boolean);
  const allFolders = /* @__PURE__ */ new Set();
  for (const f of app.vault.getAllLoadedFiles()) {
    if (f.path.includes("/")) {
      allFolders.add(f.path.split("/")[0]);
    }
  }
  const existingFolders = normalizedFolders.filter((dir) => allFolders.has(dir));
  const files = app.vault.getMarkdownFiles().filter(
    (f) => normalizedFolders.some((dir) => f.path.startsWith(dir + "/"))
  );
  const result = {
    missingFrontmatter: [],
    orphanNotes: [],
    emptyNotes: [],
    duplicateTitles: [],
    brokenLinks: [],
    totalNotes: files.length,
    searchedFolders: normalizedFolders,
    existingFolders
  };
  const titleMap = /* @__PURE__ */ new Map();
  for (const file of files) {
    const content = await app.vault.cachedRead(file);
    const { frontmatter, body } = parseFrontmatter(content);
    const missing = [];
    if (!frontmatter.tags || Array.isArray(frontmatter.tags) && frontmatter.tags.length === 0) {
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
  const unresolvedLinks = app.metadataCache.unresolvedLinks;
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
function formatHealthCheckReport(result) {
  const sections = [];
  const score = computeHealthScore(result);
  sections.push(`## Wiki \u5065\u5EB7\u68C0\u67E5\u62A5\u544A
`);
  sections.push(`**\u603B\u8BA1**: ${result.totalNotes} \u7BC7\u7B14\u8BB0 | **\u5065\u5EB7\u5206\u6570**: ${score}/100
`);
  if (result.totalNotes === 0) {
    const missing = result.searchedFolders.filter((f) => !result.existingFolders.includes(f));
    if (result.searchedFolders.length === 0) {
      sections.push("\u26A0\uFE0F \u672A\u914D\u7F6E\u77E5\u8BC6\u5E93\u6587\u4EF6\u5939\u3002\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u300C\u77E5\u8BC6\u5E93\u6587\u4EF6\u5939\u300D\u3002");
    } else if (missing.length > 0) {
      sections.push(`\u26A0\uFE0F \u4EE5\u4E0B\u6587\u4EF6\u5939\u5728 Vault \u4E2D\u4E0D\u5B58\u5728: ${missing.join("\u3001")}`);
      sections.push(`\u5F53\u524D\u641C\u7D22\u8303\u56F4: ${result.searchedFolders.join("\u3001")}\u3002\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u786E\u8BA4\u6587\u4EF6\u5939\u540D\u79F0\u6B63\u786E\u3002`);
    } else {
      sections.push(`\u641C\u7D22\u8303\u56F4: ${result.searchedFolders.join("\u3001")}\uFF08\u6587\u4EF6\u5939\u5B58\u5728\u4F46\u4E3A\u7A7A\uFF09`);
    }
    return sections.join("\n\n");
  }
  if (result.emptyNotes.length > 0) {
    sections.push(`### \u26A0\uFE0F \u7A7A\u7B14\u8BB0 (${result.emptyNotes.length})`);
    sections.push(result.emptyNotes.map((p) => `- [[${pathToName(p)}]]`).join("\n"));
  }
  if (result.missingFrontmatter.length > 0) {
    sections.push(`### \u{1F4CB} \u7F3A\u5C11 Frontmatter (${result.missingFrontmatter.length})`);
    const items = result.missingFrontmatter.slice(0, 20).map(
      (e) => `- [[${pathToName(e.path)}]] \u2014 \u7F3A\u5C11: ${e.missing.join(", ")}`
    );
    if (result.missingFrontmatter.length > 20) {
      items.push(`- ... \u8FD8\u6709 ${result.missingFrontmatter.length - 20} \u7BC7`);
    }
    sections.push(items.join("\n"));
  }
  if (result.orphanNotes.length > 0) {
    sections.push(`### \u{1F517} \u5B64\u5C9B\u7B14\u8BB0 \u2014 \u65E0\u5165\u94FE (${result.orphanNotes.length})`);
    const items = result.orphanNotes.slice(0, 20).map(
      (p) => `- [[${pathToName(p)}]]`
    );
    if (result.orphanNotes.length > 20) {
      items.push(`- ... \u8FD8\u6709 ${result.orphanNotes.length - 20} \u7BC7`);
    }
    sections.push(items.join("\n"));
  }
  if (result.brokenLinks.length > 0) {
    sections.push(`### \u274C \u65AD\u94FE (${result.brokenLinks.length})`);
    const items = result.brokenLinks.slice(0, 15).map(
      (l) => `- [[${pathToName(l.source)}]] \u2192 \`${l.target}\``
    );
    if (result.brokenLinks.length > 15) {
      items.push(`- ... \u8FD8\u6709 ${result.brokenLinks.length - 15} \u6761`);
    }
    sections.push(items.join("\n"));
  }
  if (result.duplicateTitles.length > 0) {
    sections.push(`### \u{1F4D1} \u7591\u4F3C\u91CD\u590D\u6761\u76EE (${result.duplicateTitles.length} \u7EC4)`);
    sections.push(result.duplicateTitles.map(
      (d) => `- **${d.title}**: ${d.paths.map((p) => `[[${pathToName(p)}]]`).join(", ")}`
    ).join("\n"));
  }
  const allClean = result.emptyNotes.length === 0 && result.missingFrontmatter.length === 0 && result.orphanNotes.length === 0 && result.brokenLinks.length === 0 && result.duplicateTitles.length === 0;
  if (allClean) {
    sections.push("\u2705 \u77E5\u8BC6\u5E93\u72B6\u6001\u826F\u597D\uFF0C\u6CA1\u6709\u53D1\u73B0\u95EE\u9898\uFF01");
  }
  return sections.join("\n\n");
}
function computeHealthScore(r) {
  if (r.totalNotes === 0) return 100;
  let score = 100;
  score -= Math.min(30, r.missingFrontmatter.length / r.totalNotes * 30);
  score -= Math.min(25, r.orphanNotes.length / r.totalNotes * 25);
  score -= Math.min(20, r.emptyNotes.length * 5);
  score -= Math.min(15, r.brokenLinks.length * 3);
  score -= Math.min(10, r.duplicateTitles.length * 5);
  return Math.max(0, Math.round(score));
}
function hasFixableIssues(r) {
  return r.missingFrontmatter.length > 0 || r.orphanNotes.length > 0 || r.emptyNotes.length > 0 || r.brokenLinks.length > 0;
}
function prepareHealthFix(result, knowledgeFolders) {
  const systemPrompt = `\u4F60\u662F\u4E00\u4E2A\u77E5\u8BC6\u5E93\u7EF4\u62A4 Agent\u3002\u4F60\u7684\u4EFB\u52A1\u662F\u6839\u636E\u5065\u5EB7\u68C0\u67E5\u62A5\u544A\u4FEE\u590D\u77E5\u8BC6\u5E93\u4E2D\u7684\u95EE\u9898\u3002

\u4F60\u53EF\u4EE5\u4F7F\u7528\u5DE5\u5177\u6765\u8BFB\u53D6\u3001\u7F16\u8F91\u3001\u5220\u9664\u7B14\u8BB0\u548C\u66F4\u65B0 frontmatter\u3002

\u4FEE\u590D\u89C4\u5219\uFF1A
1. **\u7F3A\u5C11 tags/summary \u7684\u7B14\u8BB0**\uFF1A\u7528 read_note \u8BFB\u53D6\u5185\u5BB9\uFF0C\u5206\u6790\u540E\u7528 update_frontmatter \u8865\u5145\u5408\u9002\u7684 tags \u548C summary
   - tags \u5E94\u7B80\u6D01\u3001\u6982\u5FF5\u5316\uFF0C\u4F18\u5148\u590D\u7528\u5DF2\u6709 tag
   - summary \u7528\u4E2D\u6587\uFF0C1-2 \u53E5\u8BDD\u6982\u62EC\u7B14\u8BB0\u5185\u5BB9
2. **\u5B64\u5C9B\u7B14\u8BB0\uFF08\u65E0\u5165\u94FE\uFF09**\uFF1A\u7528 read_note \u8BFB\u53D6\u5185\u5BB9\uFF0C\u7528 search_vault \u627E\u76F8\u5173\u7B14\u8BB0\uFF0C\u5728\u76F8\u5173\u7B14\u8BB0\u4E2D\u7528 edit_note \u6DFB\u52A0 [[wiki-link]] \u6307\u5411\u5B64\u5C9B\u7B14\u8BB0
3. **\u7A7A\u7B14\u8BB0**\uFF1A\u7528 delete_note \u5220\u9664\u7A7A\u7B14\u8BB0
4. **\u65AD\u94FE**\uFF1A\u7528 read_note \u68C0\u67E5\u6E90\u7B14\u8BB0\u4E2D\u7684\u65AD\u94FE\uFF0C\u5982\u679C\u80FD\u627E\u5230\u6B63\u786E\u76EE\u6807\u5219\u4FEE\u590D\u94FE\u63A5\uFF0C\u5426\u5219\u79FB\u9664\u65AD\u94FE

\u77E5\u8BC6\u5E93\u6587\u4EF6\u5939: ${knowledgeFolders.join("\u3001")}

\u91CD\u8981\u7EA6\u675F\uFF1A
- \u6BCF\u4E2A\u64CD\u4F5C\u524D\u5148 read_note \u786E\u8BA4\u5F53\u524D\u5185\u5BB9
- tags \u4F18\u5148\u590D\u7528\u5DF2\u6709 tag\uFF0C\u4FDD\u6301\u4E00\u81F4\u6027
- \u7F16\u8F91\u7B14\u8BB0\u65F6\u4FDD\u6301\u539F\u6709\u7ED3\u6784\u548C\u683C\u5F0F
- \u5B8C\u6210\u540E\u7B80\u8981\u6C47\u62A5\u4FEE\u590D\u4E86\u54EA\u4E9B\u95EE\u9898`;
  const issues = [];
  if (result.missingFrontmatter.length > 0) {
    const items = result.missingFrontmatter.slice(0, 30).map(
      (e) => `- ${e.path} \u2014 \u7F3A\u5C11: ${e.missing.join(", ")}`
    );
    issues.push(`### \u7F3A\u5C11 Frontmatter (${result.missingFrontmatter.length} \u7BC7)
${items.join("\n")}`);
  }
  if (result.orphanNotes.length > 0) {
    const items = result.orphanNotes.slice(0, 30).map((p) => `- ${p}`);
    issues.push(`### \u5B64\u5C9B\u7B14\u8BB0 (${result.orphanNotes.length} \u7BC7)
${items.join("\n")}`);
  }
  if (result.emptyNotes.length > 0) {
    issues.push(`### \u7A7A\u7B14\u8BB0 (${result.emptyNotes.length} \u7BC7)
${result.emptyNotes.map((p) => `- ${p}`).join("\n")}`);
  }
  if (result.brokenLinks.length > 0) {
    const items = result.brokenLinks.slice(0, 20).map(
      (l) => `- ${l.source} \u2192 ${l.target}`
    );
    issues.push(`### \u65AD\u94FE (${result.brokenLinks.length} \u6761)
${items.join("\n")}`);
  }
  const userMessage = `\u8BF7\u6839\u636E\u4EE5\u4E0B\u5065\u5EB7\u68C0\u67E5\u62A5\u544A\u4FEE\u590D\u77E5\u8BC6\u5E93\u95EE\u9898\uFF1A

${issues.join("\n\n")}

\u8BF7\u9010\u9879\u4FEE\u590D\uFF0C\u5B8C\u6210\u540E\u6C47\u62A5\u7ED3\u679C\u3002`;
  return { systemPrompt, userMessage };
}
function pathToName(path) {
  const base = path.split("/").pop() || path;
  return base.replace(/\.md$/, "");
}
async function prepareDistillation(app, messages, opts) {
  const allFolders = opts.knowledgeFolders.join("\u3001");
  const existingStructure = await getWikiStructureSummary(app, opts.targetFolder);
  const systemPrompt = `\u4F60\u662F\u4E00\u4E2A\u77E5\u8BC6\u84B8\u998F Agent\u3002\u4F60\u7684\u4EFB\u52A1\u662F\u4ECE\u5BF9\u8BDD\u5386\u53F2\u4E2D\u63D0\u53D6\u6709\u4EF7\u503C\u7684\u4E8B\u5B9E\u6027\u77E5\u8BC6\uFF0C\u4FDD\u5B58\u4E3A Wiki \u6761\u76EE\u3002

\u4F60\u53EF\u4EE5\u4F7F\u7528\u5DE5\u5177\u6765\u641C\u7D22\u3001\u8BFB\u53D6\u3001\u521B\u5EFA\u548C\u7F16\u8F91\u7B14\u8BB0\u3002

\u84B8\u998F\u6D41\u7A0B\uFF1A
1. \u5206\u6790\u5BF9\u8BDD\u5386\u53F2\uFF0C\u8BC6\u522B\u6709\u4EF7\u503C\u7684\u4E8B\u5B9E\u6027\u77E5\u8BC6\uFF08\u6392\u9664\u95F2\u804A\u3001\u95EE\u5019\u7B49\uFF09
2. \u5BF9\u6BCF\u4E2A\u77E5\u8BC6\u70B9\uFF0C\u7528 search_vault \u641C\u7D22 ${opts.targetFolder}/ \u4E2D\u662F\u5426\u5DF2\u6709\u76F8\u5173\u6761\u76EE
3. \u5DF2\u6709\u6761\u76EE\uFF1A\u7528 edit_note \u8865\u5145\u65B0\u77E5\u8BC6\uFF0C\u4FDD\u6301\u539F\u6709\u7ED3\u6784\u548C\u683C\u5F0F
4. \u6CA1\u6709\u6761\u76EE\uFF1A\u7528 create_note \u5728 ${opts.targetFolder}/ \u4E2D\u521B\u5EFA\u65B0\u6761\u76EE
5. \u6BCF\u4E2A\u6761\u76EE\u5FC5\u987B\u6709 frontmatter\uFF08tags\u3001summary\uFF09\u548C wiki-link \u5173\u8054
6. \u65B0\u5EFA\u6761\u76EE\u540E\uFF0C\u68C0\u67E5\u662F\u5426\u6709\u76F8\u5173\u7684\u5DF2\u6709\u6761\u76EE\u9700\u8981\u6DFB\u52A0\u4EA4\u53C9\u5F15\u7528

\u77E5\u8BC6\u5E93\u6587\u4EF6\u5939: ${allFolders}
\u76EE\u6807\u6587\u4EF6\u5939: ${opts.targetFolder}

## \u7EC4\u7EC7\u7ED3\u6784\u7EF4\u62A4

${existingStructure}

\u7EF4\u62A4\u89C4\u5219\uFF1A
- \u65B0\u6761\u76EE\u7684 tags \u5E94\u5C3D\u91CF\u590D\u7528\u5DF2\u6709 tag\uFF0C\u907F\u514D\u521B\u5EFA\u540C\u4E49 tag\uFF08\u5982\u5DF2\u6709 "\u673A\u5668\u5B66\u4E60" \u5C31\u4E0D\u8981\u518D\u7528 "ML"\uFF09
- \u5982\u679C\u5DF2\u6709\u5B50\u6587\u4EF6\u5939\u6309\u4E3B\u9898\u5206\u7C7B\uFF0C\u65B0\u6761\u76EE\u5E94\u653E\u5165\u5408\u9002\u7684\u5B50\u6587\u4EF6\u5939
- \u521B\u5EFA\u6216\u7F16\u8F91\u6761\u76EE\u65F6\uFF0C\u4E3B\u52A8\u6DFB\u52A0 [[wiki-link]] \u6307\u5411\u76F8\u5173\u6761\u76EE\uFF0C\u7EF4\u62A4\u77E5\u8BC6\u7F51\u7EDC
- \u7F16\u8F91\u5DF2\u6709\u6761\u76EE\u65F6\uFF0C\u4FDD\u6301\u5176\u539F\u6709\u7684\u6807\u9898\u5C42\u7EA7\u548C\u5185\u5BB9\u7ED3\u6784

\u91CD\u8981\u7EA6\u675F\uFF1A
- \u53EA\u63D0\u53D6\u4E8B\u5B9E\u6027\u3001\u53EF\u590D\u7528\u7684\u77E5\u8BC6\uFF0C\u8DF3\u8FC7\u7EAF\u95F2\u804A
- Wiki \u6761\u76EE\u6807\u9898\u7B80\u6D01\u3001\u6982\u5FF5\u5316\uFF08\u540D\u8BCD\u6216\u540D\u8BCD\u77ED\u8BED\uFF09
- \u5185\u5BB9\u7528\u4E2D\u6587\uFF0C\u7ED3\u6784\u6E05\u6670
- \u4F18\u5148\u5408\u5E76\u5230\u5DF2\u6709\u6761\u76EE\uFF0C\u907F\u514D\u521B\u5EFA\u5185\u5BB9\u91CD\u53E0\u7684\u65B0\u6761\u76EE`;
  const conversationText = messages.filter((m) => m.content.length > 0).map((m) => `${m.role === "user" ? "\u7528\u6237" : "\u52A9\u624B"}: ${m.content}`).join("\n\n");
  const userMessage = `\u8BF7\u4ECE\u4EE5\u4E0B\u5BF9\u8BDD\u4E2D\u63D0\u53D6\u77E5\u8BC6\u5E76\u4FDD\u5B58\u4E3A Wiki \u6761\u76EE\uFF1A

${conversationText.slice(0, 12e3)}

\u5B8C\u6210\u540E\uFF0C\u8BF7\u7B80\u8981\u8BF4\u660E\u4F60\u63D0\u53D6\u4E86\u54EA\u4E9B\u77E5\u8BC6\u3001\u521B\u5EFA\u6216\u66F4\u65B0\u4E86\u54EA\u4E9B\u6761\u76EE\u3002`;
  return { systemPrompt, userMessage };
}
async function distillConversation(app, messages, opts) {
  const vaultTools = new VaultTools(app, opts.knowledgeFolders);
  const { systemPrompt, userMessage } = await prepareDistillation(app, messages, {
    knowledgeFolders: opts.knowledgeFolders,
    targetFolder: opts.targetFolder
  });
  const client = new ClaudeClient(opts.apiKey, opts.model, systemPrompt, {
    streamMode: "off",
    enableWebSearch: false
  });
  return client.chat(
    userMessage,
    (name, input) => vaultTools.execute(name, input)
  );
}
async function getWikiStructureSummary(app, targetFolder) {
  var _a;
  const files = app.vault.getMarkdownFiles().filter(
    (f) => f.path.startsWith(targetFolder + "/")
  );
  if (files.length === 0) return "\u76EE\u6807\u6587\u4EF6\u5939\u4E3A\u7A7A\uFF0C\u53EF\u81EA\u7531\u521B\u5EFA\u6761\u76EE\u3002";
  const subfolders = /* @__PURE__ */ new Set();
  const allTags = /* @__PURE__ */ new Map();
  for (const file of files) {
    const rel = file.path.slice(targetFolder.length + 1);
    const slashIdx = rel.indexOf("/");
    if (slashIdx !== -1) {
      subfolders.add(rel.slice(0, slashIdx));
    }
    const cache = app.metadataCache.getFileCache(file);
    if ((_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a.tags) {
      const raw = cache.frontmatter.tags;
      const tags = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(",").map((t) => t.trim()).filter(Boolean) : [];
      for (const tag of tags) {
        allTags.set(tag, (allTags.get(tag) || 0) + 1);
      }
    }
  }
  const parts = [`\u5F53\u524D ${targetFolder}/ \u4E2D\u6709 ${files.length} \u7BC7\u6761\u76EE\u3002`];
  if (subfolders.size > 0) {
    parts.push(`\u5B50\u6587\u4EF6\u5939: ${[...subfolders].sort().join("\u3001")}`);
  }
  if (allTags.size > 0) {
    const sorted = [...allTags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([tag, count]) => `${tag}(${count})`);
    parts.push(`\u5E38\u7528 tags: ${sorted.join("\u3001")}`);
  }
  return parts.join("\n");
}

// src/claude-code.ts
var import_obsidian11 = require("obsidian");

// agent-tool-policy.json
var agent_tool_policy_default = {
  claudeCode: {
    desktopBuiltins: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite"],
    proxyBuiltins: ["WebSearch", "WebFetch", "TodoWrite", "ToolSearch"]
  },
  codex: {
    readOnlyMcp: [
      "read_note",
      "search_vault",
      "list_notes",
      "get_links",
      "read_image",
      "podcast_search",
      "podcast_episodes",
      "podcast_transcript",
      "fetch_feeds",
      "fetch_rss",
      "weread_api"
    ],
    vaultWriteMcp: ["create_note", "append_to_note", "edit_note", "update_frontmatter"],
    alwaysDisabledMcp: ["delete_note", "rename_note"]
  }
};

// src/reasoning-effort.ts
function appendClaudeEffortArg(args, effort) {
  if (effort) args.push("--effort", effort);
}
function appendCodexReasoningEffortArg(args, effort) {
  if (effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
}

// src/claude-code.ts
var cachedClaudePath = null;
var cachedNodePath = null;
var cachedMcpServerPath = null;
function getMcpServerPath() {
  if (cachedMcpServerPath) return cachedMcpServerPath;
  const { writeFileSync, mkdirSync, existsSync } = require("fs");
  const { join } = require("path");
  const tmpDir = join(process.env.TMPDIR || "/tmp", "ai-daily-mcp");
  try {
    mkdirSync(tmpDir, { recursive: true });
  } catch (e) {
  }
  const serverPath = join(tmpDir, "mcp-server.mjs");
  if (typeof __MCP_SERVER_CODE__ === "string" && __MCP_SERVER_CODE__.length > 0) {
    writeFileSync(serverPath, __MCP_SERVER_CODE__);
    cachedMcpServerPath = serverPath;
    return serverPath;
  }
  return serverPath;
}
var MIN_NODE_MAJOR = 18;
function nodeMajorVersion(versionDir) {
  const m = versionDir.match(/^v(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
function resolveNvmNodeBin(home) {
  const { existsSync, readFileSync, readdirSync } = require("fs");
  const nvmDir = process.env.NVM_DIR || `${home}/.nvm`;
  const current = `${nvmDir}/current/bin`;
  if (existsSync(current)) {
    try {
      const target2 = require("fs").readlinkSync(`${nvmDir}/current`);
      if (nodeMajorVersion(require("path").basename(target2)) >= MIN_NODE_MAJOR) {
        return current;
      }
    } catch (e) {
      return current;
    }
  }
  const aliasDir = `${nvmDir}/alias`;
  const versionsDir = `${nvmDir}/versions/node`;
  if (!existsSync(versionsDir)) return null;
  let target = "default";
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < 5; i++) {
    if (seen.has(target)) break;
    seen.add(target);
    const aliasFile = `${aliasDir}/${target}`;
    if (!existsSync(aliasFile)) break;
    target = readFileSync(aliasFile, "utf-8").trim();
    if (!target) break;
  }
  if (target === "node" || target === "stable") {
    target = "";
  }
  try {
    const installed = readdirSync(versionsDir).filter((v) => nodeMajorVersion(v) >= MIN_NODE_MAJOR).sort();
    if (installed.length === 0) return null;
    let match;
    if (target) {
      const prefix = target.startsWith("v") ? target : `v${target}`;
      match = installed.filter((v) => v.startsWith(prefix)).pop();
    }
    if (!match) match = installed.pop();
    if (match) {
      const bin = `${versionsDir}/${match}/bin`;
      if (existsSync(bin)) return bin;
    }
  } catch (e) {
  }
  return null;
}
function resolveFnmNodeBin(home) {
  const { existsSync, readdirSync, readlinkSync } = require("fs");
  const { join } = require("path");
  const candidates = [
    `${home}/Library/Application Support/fnm/node-versions`,
    // macOS
    `${home}/.local/share/fnm/node-versions`,
    // Linux
    `${home}/.fnm/node-versions`
    // legacy / custom
  ];
  const aliasDirs = [
    `${home}/Library/Application Support/fnm/aliases`,
    `${home}/.local/share/fnm/aliases`,
    `${home}/.fnm/aliases`
  ];
  for (const aliasDir of aliasDirs) {
    const defaultAlias = join(aliasDir, "default");
    if (existsSync(defaultAlias)) {
      try {
        const resolved = readlinkSync(defaultAlias);
        const bin = join(resolved, "installation/bin");
        if (existsSync(bin)) return bin;
      } catch (e) {
      }
    }
  }
  for (const dir of candidates) {
    try {
      const versions = readdirSync(dir).sort();
      if (versions.length > 0) {
        const latest = versions.pop();
        const bin = `${dir}/${latest}/installation/bin`;
        if (existsSync(bin)) return bin;
      }
    } catch (e) {
    }
  }
  return null;
}
function buildEnhancedPath(home) {
  const { existsSync } = require("fs");
  const dirs = [];
  const nvmBin = resolveNvmNodeBin(home);
  if (nvmBin) dirs.push(nvmBin);
  const fnmBin = resolveFnmNodeBin(home);
  if (fnmBin) dirs.push(fnmBin);
  const voltaBin = `${home}/.volta/bin`;
  if (existsSync(voltaBin)) dirs.push(voltaBin);
  const asdfShims = `${home}/.asdf/shims`;
  if (existsSync(asdfShims)) dirs.push(asdfShims);
  dirs.push(
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
    `${home}/Library/pnpm`,
    `${home}/.bun/bin`,
    "/opt/homebrew/bin",
    // macOS ARM
    "/usr/local/bin"
    // macOS x86 / Linux
  );
  if (cachedClaudePath && cachedClaudePath !== "claude") {
    const { dirname } = require("path");
    const claudeDir = dirname(cachedClaudePath);
    if (!dirs.includes(claudeDir)) dirs.unshift(claudeDir);
  }
  return [...dirs, process.env.PATH || ""].join(":");
}
function findNodeExecutable(home) {
  const { existsSync } = require("fs");
  if (cachedNodePath) return cachedNodePath;
  const nvmBin = resolveNvmNodeBin(home);
  if (nvmBin) {
    const candidate = `${nvmBin}/node`;
    if (existsSync(candidate)) {
      cachedNodePath = candidate;
      return candidate;
    }
  }
  const fnmBin = resolveFnmNodeBin(home);
  if (fnmBin) {
    const candidate = `${fnmBin}/node`;
    if (existsSync(candidate)) {
      cachedNodePath = candidate;
      return candidate;
    }
  }
  const staticPaths = [
    `${home}/.volta/bin/node`,
    `${home}/.asdf/shims/node`,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node"
  ];
  for (const p of staticPaths) {
    if (existsSync(p)) {
      cachedNodePath = p;
      return p;
    }
  }
  return null;
}
function getClaudeSearchPaths(home) {
  return [
    // User-level installs (most common for npm -g / pnpm)
    `${home}/.local/bin/claude`,
    `${home}/.npm-global/bin/claude`,
    `${home}/Library/pnpm/claude`,
    `${home}/.pnpm-global/bin/claude`,
    // Version managers
    `${home}/.volta/bin/claude`,
    `${home}/.asdf/shims/claude`,
    `${home}/.bun/bin/claude`,
    // NVM-managed
    ...resolveNvmNodeBin(home) ? [`${resolveNvmNodeBin(home)}/claude`] : [],
    // System-wide
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude"
  ];
}
async function findClaudeBinary() {
  const { existsSync } = require("fs");
  const { execFile } = require("child_process");
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = getClaudeSearchPaths(home);
  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`[ai-daily] found claude at: ${p}`);
      return p;
    }
  }
  const enhancedPath = home ? buildEnhancedPath(home) : process.env.PATH || "";
  return new Promise((resolve) => {
    execFile("claude", ["--version"], {
      timeout: 5e3,
      env: { ...process.env, PATH: enhancedPath }
    }, (err) => {
      if (!err) {
        console.log("[ai-daily] found claude via enhanced PATH");
        resolve("claude");
      } else {
        console.log("[ai-daily] claude not found");
        resolve(false);
      }
    });
  });
}
async function isClaudeCodeAvailable() {
  if (import_obsidian11.Platform.isMobile) return false;
  if (cachedClaudePath !== null) return cachedClaudePath !== false;
  try {
    cachedClaudePath = await findClaudeBinary();
    console.log("[ai-daily] claude detection result:", cachedClaudePath);
    return cachedClaudePath !== false;
  } catch (e) {
    console.error("[ai-daily] claude detection error:", e);
    cachedClaudePath = false;
    return false;
  }
}
function getClaudePath() {
  return cachedClaudePath || "claude";
}
function spawnClaudeCode(prompt, options, callbacks) {
  var _a, _b;
  const { spawn } = require("child_process");
  const { mcpConfig, sessionId, model, effort } = options;
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const nodeBin = findNodeExecutable(home) || "node";
  const { writeFileSync, mkdirSync, unlinkSync } = require("fs");
  const { join } = require("path");
  const tmpDir = join(process.env.TMPDIR || "/tmp", "ai-daily-mcp");
  try {
    mkdirSync(tmpDir, { recursive: true });
  } catch (e) {
  }
  const mcpConfigPath = join(tmpDir, `mcp-${Date.now()}.json`);
  const mcpConfigJson = {
    mcpServers: {
      "obsidian-vault": {
        command: nodeBin,
        args: [mcpConfig.mcpServerPath],
        env: {
          VAULT_PATH: mcpConfig.vaultPath,
          KNOWLEDGE_FOLDERS: mcpConfig.knowledgeFolders.join(","),
          ...mcpConfig.wereadApiKey ? { WEREAD_API_KEY: mcpConfig.wereadApiKey } : {}
        }
      }
    }
  };
  const mcpJsonStr = JSON.stringify(mcpConfigJson, null, 2);
  writeFileSync(mcpConfigPath, mcpJsonStr);
  console.log("[ai-daily] MCP config path:", mcpConfigPath);
  console.log("[ai-daily] MCP config:", mcpJsonStr);
  console.log("[ai-daily] node binary:", nodeBin);
  console.log("[ai-daily] MCP server path:", mcpConfig.mcpServerPath);
  const { existsSync } = require("fs");
  if (!existsSync(mcpConfig.mcpServerPath)) {
    console.error("[ai-daily] MCP server file NOT FOUND:", mcpConfig.mcpServerPath);
  }
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "bypassPermissions",
    "--tools",
    agent_tool_policy_default.claudeCode.desktopBuiltins.join(","),
    "--mcp-config",
    mcpConfigPath
  ];
  if (model) {
    args.push("--model", model);
  }
  appendClaudeEffortArg(args, effort);
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  const claudeBin = getClaudePath();
  console.log("[ai-daily] spawn:", claudeBin, args.filter((a) => a !== prompt).join(" "));
  const env = { ...process.env };
  if (home) {
    env.PATH = buildEnhancedPath(home);
  }
  let child;
  try {
    child = spawn(claudeBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env
    });
  } catch (e) {
    callbacks.onError(`Failed to spawn claude: ${e instanceof Error ? e.message : String(e)}`);
    return { abort: () => {
    } };
  }
  let fullText = "";
  let resultText = "";
  let buffer = "";
  (_a = child.stdout) == null ? void 0 : _a.on("data", (chunk) => {
    buffer += chunk.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "result" && typeof event.result === "string") {
          resultText = event.result;
        }
        handleStreamEvent(event, callbacks, (t) => {
          fullText += t;
        });
      } catch (e) {
        callbacks.onText(line);
        fullText += line;
      }
    }
  });
  (_b = child.stderr) == null ? void 0 : _b.on("data", (chunk) => {
    const text = chunk.toString("utf-8").trim();
    if (text) console.warn("[ai-daily] claude stderr:", text);
  });
  child.on("close", (code) => {
    try {
      unlinkSync(mcpConfigPath);
    } catch (e) {
    }
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        if (event.type === "result" && typeof event.result === "string") {
          resultText = event.result;
        }
        handleStreamEvent(event, callbacks, (t) => {
          fullText += t;
        });
      } catch (e) {
        callbacks.onText(buffer);
        fullText += buffer;
      }
    }
    if (!fullText && resultText) {
      callbacks.onText(resultText);
      fullText = resultText;
    }
    if (code !== 0 && code !== null && !fullText) {
      callbacks.onError(`Claude Code exited with code ${code}`);
    } else {
      callbacks.onDone(fullText);
    }
  });
  child.on("error", (err) => {
    callbacks.onError(`Claude Code error: ${err.message}`);
  });
  return {
    abort: () => {
      child.kill("SIGTERM");
    }
  };
}
var pendingTools = /* @__PURE__ */ new Map();
var UNDO_MARKER = "__undo__";
function extractToolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => {
      if (b.type === "text" && typeof b.text === "string") return b.text;
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}
function extractUndoData(text) {
  const idx = text.indexOf(UNDO_MARKER);
  if (idx === -1) return { clean: text, undo: null };
  const jsonStr = text.slice(idx + UNDO_MARKER.length);
  const clean = text.slice(0, idx).trimEnd();
  try {
    const data = JSON.parse(jsonStr);
    return { clean, undo: data };
  } catch (e) {
    return { clean: text, undo: null };
  }
}
function handleStreamEvent(event, callbacks, appendText) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  const type = event.type;
  switch (type) {
    case "stream_event": {
      const inner = event.event;
      if (!inner) break;
      const innerType = inner.type;
      if (innerType === "content_block_delta") {
        const delta = inner.delta;
        if ((delta == null ? void 0 : delta.type) === "text_delta" && typeof delta.text === "string") {
          callbacks.onText(delta.text);
          appendText(delta.text);
        } else if ((delta == null ? void 0 : delta.type) === "thinking_delta" && typeof delta.thinking === "string") {
          (_a = callbacks.onThinking) == null ? void 0 : _a.call(callbacks, delta.thinking);
        }
      }
      break;
    }
    case "assistant": {
      const msg = event.message;
      if ((msg == null ? void 0 : msg.content) && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block;
          if (b.type === "tool_use" && typeof b.name === "string") {
            const input = b.input || {};
            const id = b.id || `tool-${Date.now()}`;
            pendingTools.set(id, b.name);
            (_b = callbacks.onToolCall) == null ? void 0 : _b.call(callbacks, id, b.name, input, "running");
          }
        }
      }
      const sid = event.session_id;
      if (sid) (_c = callbacks.onSessionId) == null ? void 0 : _c.call(callbacks, sid);
      break;
    }
    case "content_block_delta": {
      const delta = event.delta;
      if ((delta == null ? void 0 : delta.type) === "text_delta" && typeof delta.text === "string") {
        callbacks.onText(delta.text);
        appendText(delta.text);
      } else if ((delta == null ? void 0 : delta.type) === "thinking_delta" && typeof delta.thinking === "string") {
        (_d = callbacks.onThinking) == null ? void 0 : _d.call(callbacks, delta.thinking);
      }
      break;
    }
    case "result": {
      const sid = event.session_id;
      if (sid) (_e = callbacks.onSessionId) == null ? void 0 : _e.call(callbacks, sid);
      pendingTools.clear();
      break;
    }
    case "user": {
      const msg = event.message;
      if ((msg == null ? void 0 : msg.content) && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block;
          if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
            const toolId = b.tool_use_id;
            const toolName = pendingTools.get(toolId);
            const isError = b.is_error === true;
            const rawText = extractToolResultText(b.content);
            const { clean: resultText, undo } = extractUndoData(rawText);
            if (toolName) {
              (_f = callbacks.onToolCall) == null ? void 0 : _f.call(callbacks, toolId, toolName, {}, isError ? "error" : "done");
              (_g = callbacks.onToolResult) == null ? void 0 : _g.call(callbacks, toolId, resultText, isError);
              if (undo && !isError) {
                (_h = callbacks.onUndoData) == null ? void 0 : _h.call(callbacks, undo);
              }
              pendingTools.delete(toolId);
            }
          }
        }
      }
      break;
    }
  }
}
async function seedClaudeCodeSession(history, cwd, model) {
  var _a, _b;
  const { writeFile, mkdir } = require("fs/promises");
  const { join } = require("path");
  const { randomUUID } = require("crypto");
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const dirName = cwd.replace(/^\//, "").replace(/[\/ ]/g, "-");
  const dir = join(home, ".claude", "projects", dirName);
  await mkdir(dir, { recursive: true });
  const sessionId = randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const lines = [];
  let parentUuid = null;
  for (const msg of history) {
    const uuid = randomUUID();
    if (msg.role === "user") {
      lines.push(JSON.stringify({
        type: "user",
        message: { role: "user", content: msg.content },
        uuid,
        parentUuid,
        isSidechain: false,
        timestamp: now,
        sessionId,
        cwd
      }));
    } else {
      lines.push(JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: msg.content }],
          model: model || "sonnet",
          type: "message",
          id: `msg_seed_${uuid.slice(0, 12)}`,
          stop_reason: "end_turn"
        },
        uuid,
        parentUuid,
        isSidechain: false,
        timestamp: now,
        sessionId,
        cwd
      }));
    }
    parentUuid = uuid;
  }
  if (parentUuid) {
    lines.push(JSON.stringify({
      type: "last-prompt",
      lastPrompt: (_b = (_a = history.filter((m) => m.role === "user").pop()) == null ? void 0 : _a.content) != null ? _b : "",
      leafUuid: parentUuid,
      sessionId
    }));
  }
  await writeFile(join(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n", "utf-8");
  return sessionId;
}

// src/codex.ts
var import_obsidian12 = require("obsidian");
var cachedCodexPath = null;
function getCodexSearchPaths(home) {
  return [
    `${home}/.local/bin/codex`,
    `${home}/.npm-global/bin/codex`,
    `${home}/.cargo/bin/codex`,
    `${home}/.volta/bin/codex`,
    "/usr/local/bin/codex",
    "/usr/bin/codex",
    "/opt/homebrew/bin/codex"
  ];
}
async function findCodexBinary() {
  const { existsSync } = require("fs");
  const { execFile } = require("child_process");
  const home = process.env.HOME || process.env.USERPROFILE || "";
  for (const p of getCodexSearchPaths(home)) {
    if (existsSync(p)) {
      console.log(`[ai-daily] found codex at: ${p}`);
      return p;
    }
  }
  return new Promise((resolve) => {
    execFile("codex", ["--version"], {
      timeout: 5e3
    }, (err) => {
      if (!err) {
        console.log("[ai-daily] found codex via PATH");
        resolve("codex");
      } else {
        console.log("[ai-daily] codex not found");
        resolve(false);
      }
    });
  });
}
async function isCodexAvailable() {
  if (import_obsidian12.Platform.isMobile) return false;
  if (cachedCodexPath !== null) return cachedCodexPath !== false;
  try {
    cachedCodexPath = await findCodexBinary();
    console.log("[ai-daily] codex detection result:", cachedCodexPath);
    return cachedCodexPath !== false;
  } catch (e) {
    console.error("[ai-daily] codex detection error:", e);
    cachedCodexPath = false;
    return false;
  }
}
function getCodexPath() {
  return cachedCodexPath || "codex";
}
function ensureCodexMcp(config) {
  const { execFileSync } = require("child_process");
  const codexBin = getCodexPath();
  try {
    execFileSync(codexBin, ["mcp", "remove", "obsidian-vault"], {
      timeout: 5e3,
      stdio: "ignore"
    });
  } catch (e) {
  }
  const args = [
    "mcp",
    "add",
    "--env",
    `VAULT_PATH=${config.vaultPath}`,
    "--env",
    `KNOWLEDGE_FOLDERS=${config.knowledgeFolders.join(",")}`
  ];
  if (config.wereadApiKey) {
    args.push("--env", `WEREAD_API_KEY=${config.wereadApiKey}`);
  }
  args.push("obsidian-vault", "--", config.nodeBin, config.mcpServerPath);
  execFileSync(codexBin, args, { timeout: 1e4, stdio: "ignore" });
  console.log("[ai-daily] Codex MCP server registered");
}
function findNodeBin() {
  const { existsSync } = require("fs");
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    `${home}/.nvm/current/bin/node`,
    `${home}/.volta/bin/node`,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node"
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "node";
}
function spawnCodex(prompt, options, callbacks) {
  var _a, _b;
  const { spawn } = require("child_process");
  const { mcpConfig, sessionId, model, codexPermissionMode = "vault-write", codexReasoningEffort } = options;
  const nodeBin = findNodeBin();
  ensureCodexMcp({
    mcpServerPath: mcpConfig.mcpServerPath,
    vaultPath: mcpConfig.vaultPath,
    knowledgeFolders: mcpConfig.knowledgeFolders,
    wereadApiKey: mcpConfig.wereadApiKey,
    nodeBin
  });
  let args;
  if (sessionId) {
    args = [
      "exec",
      "resume",
      sessionId,
      prompt,
      "--json",
      "--skip-git-repo-check"
    ];
  } else {
    args = [
      "exec",
      prompt,
      "--json",
      "--skip-git-repo-check"
    ];
  }
  const enabledTools = codexPermissionMode === "vault-write" ? [...agent_tool_policy_default.codex.readOnlyMcp, ...agent_tool_policy_default.codex.vaultWriteMcp] : agent_tool_policy_default.codex.readOnlyMcp;
  args.push(
    "-c",
    'approval_policy="never"',
    "-c",
    'sandbox_mode="read-only"',
    "-c",
    `mcp_servers.obsidian-vault.enabled_tools=${JSON.stringify(enabledTools)}`,
    "-c",
    'mcp_servers.obsidian-vault.default_tools_approval_mode="approve"'
  );
  if (model) {
    args.push("-m", model);
  }
  appendCodexReasoningEffortArg(args, codexReasoningEffort);
  const codexBin = getCodexPath();
  console.log("[ai-daily] spawn codex:", codexBin, args.filter((a) => a !== prompt).join(" "));
  let child;
  try {
    child = spawn(codexBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      cwd: mcpConfig.vaultPath || void 0
    });
  } catch (e) {
    callbacks.onError(`Failed to spawn codex: ${e instanceof Error ? e.message : String(e)}`);
    return { abort: () => {
    } };
  }
  let fullText = "";
  let buffer = "";
  (_a = child.stdout) == null ? void 0 : _a.on("data", (chunk) => {
    buffer += chunk.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        handleCodexStreamEvent(event, callbacks, (t) => {
          fullText += t;
        });
      } catch (e) {
        callbacks.onText(line);
        fullText += line;
      }
    }
  });
  (_b = child.stderr) == null ? void 0 : _b.on("data", (chunk) => {
    const text = chunk.toString("utf-8").trim();
    if (text) console.warn("[ai-daily] codex stderr:", text);
  });
  child.on("close", (code) => {
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        handleCodexStreamEvent(event, callbacks, (t) => {
          fullText += t;
        });
      } catch (e) {
        callbacks.onText(buffer);
        fullText += buffer;
      }
    }
    if (code !== 0 && code !== null && !fullText) {
      callbacks.onError(`Codex exited with code ${code}`);
    } else {
      callbacks.onDone(fullText);
    }
  });
  child.on("error", (err) => {
    callbacks.onError(`Codex error: ${err.message}`);
  });
  return {
    abort: () => {
      child.kill("SIGTERM");
    }
  };
}
function handleCodexStreamEvent(event, callbacks, appendText) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  const type = event.type;
  switch (type) {
    case "thread.started": {
      const threadId = event.thread_id;
      if (threadId) (_a = callbacks.onSessionId) == null ? void 0 : _a.call(callbacks, threadId);
      break;
    }
    case "item.started": {
      const item = event.item;
      if (!item) break;
      if (item.type === "command_execution") {
        const id = item.id || `tool-${Date.now()}`;
        const cmd = item.command || "";
        (_b = callbacks.onToolCall) == null ? void 0 : _b.call(callbacks, id, "shell", { command: cmd }, "running");
      } else if (item.type === "mcp_tool_call") {
        const id = item.id || `tool-${Date.now()}`;
        const name = item.name || item.tool || "mcp_tool";
        const input = item.arguments || {};
        (_c = callbacks.onToolCall) == null ? void 0 : _c.call(callbacks, id, name, input, "running");
      }
      break;
    }
    case "item.completed": {
      const item = event.item;
      if (!item) break;
      if (item.type === "command_execution") {
        const id = item.id || "";
        const output = item.aggregated_output || "";
        const exitCode = item.exit_code;
        const isError = exitCode !== null && exitCode !== 0;
        (_d = callbacks.onToolCall) == null ? void 0 : _d.call(callbacks, id, "shell", {}, isError ? "error" : "done");
        if (output) (_e = callbacks.onToolResult) == null ? void 0 : _e.call(callbacks, id, output, isError);
      } else if (item.type === "mcp_tool_call") {
        const id = item.id || "";
        const output = item.output || JSON.stringify((_f = item.result) != null ? _f : "");
        const isError = item.status === "failed";
        const name = item.name || item.tool || "mcp_tool";
        (_g = callbacks.onToolCall) == null ? void 0 : _g.call(callbacks, id, name, {}, isError ? "error" : "done");
        if (output) (_h = callbacks.onToolResult) == null ? void 0 : _h.call(callbacks, id, output, isError);
      } else if (item.type === "agent_message") {
        const text = item.text || "";
        if (text) {
          callbacks.onText(text);
          appendText(text);
        }
      } else if (item.type === "reasoning") {
        const text = item.text || "";
        if (text) (_i = callbacks.onThinking) == null ? void 0 : _i.call(callbacks, text);
      } else if (item.type === "error") {
        const msg = item.message || "Unknown error";
        console.warn("[ai-daily] codex item error:", msg);
      }
      break;
    }
    case "turn.completed": {
      break;
    }
    case "turn.failed": {
      const error = event.error;
      const msg = (error == null ? void 0 : error.message) || "Codex turn failed";
      callbacks.onError(msg);
      break;
    }
    case "error": {
      const msg = event.message || "Codex error";
      callbacks.onError(msg);
      break;
    }
  }
}

// src/chat-view.ts
var VIEW_TYPE = "ai-daily-chat";
var STREAM_MARKDOWN_RENDER_INTERVAL_MS = 120;
function shouldShowChatMoreButton(state) {
  return state.messageCount > 0 || state.hasSession || state.hasHarnessContext;
}
function getSelectedTextWithinElement(element, selection) {
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return "";
  if (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return "";
  return selection.toString().trim();
}
var TOOL_DISPLAY_NAMES = {
  read_note: "\u8BFB\u53D6\u7B14\u8BB0",
  search_vault: "\u641C\u7D22\u7B14\u8BB0",
  append_to_note: "\u8FFD\u52A0\u5185\u5BB9",
  list_notes: "\u5217\u51FA\u7B14\u8BB0",
  create_note: "\u521B\u5EFA\u7B14\u8BB0",
  edit_note: "\u7F16\u8F91\u7B14\u8BB0",
  rename_note: "\u91CD\u547D\u540D\u7B14\u8BB0",
  delete_note: "\u5220\u9664\u7B14\u8BB0",
  get_links: "\u83B7\u53D6\u94FE\u63A5",
  update_frontmatter: "\u66F4\u65B0\u5C5E\u6027",
  read_image: "\u8BFB\u53D6\u56FE\u7247",
  web_search: "\u7F51\u7EDC\u641C\u7D22",
  web_fetch: "\u6293\u53D6\u7F51\u9875",
  weread_api: "\u5FAE\u4FE1\u8BFB\u4E66"
};
function normalizeToolName(raw) {
  const match = raw.match(/(?:mcp__[^_]+__)?(.+)/);
  return match ? match[1] : raw;
}
function toolCallSummary(name, input) {
  const normalized = normalizeToolName(name);
  const label = TOOL_DISPLAY_NAMES[normalized] || normalized;
  const path = typeof input.path === "string" ? input.path : "";
  const query = typeof input.query === "string" ? input.query : "";
  if (path) return `${label}: ${path}`;
  if (query) return `${label}: ${query}`;
  return label;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function simpleDiff(before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const lcs = lcsLines(oldLines, newLines);
  const result = [];
  let oi = 0, ni = 0, li = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && ni < newLines.length && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
      oi++;
      ni++;
      li++;
    } else if (li < lcs.length && ni < newLines.length && newLines[ni] === lcs[li]) {
      result.push(`<span class="ai-daily-diff-del">- ${escapeHtml(oldLines[oi])}</span>`);
      oi++;
    } else if (li < lcs.length && oi < oldLines.length && oldLines[oi] === lcs[li]) {
      result.push(`<span class="ai-daily-diff-add">+ ${escapeHtml(newLines[ni])}</span>`);
      ni++;
    } else {
      if (oi < oldLines.length) {
        result.push(`<span class="ai-daily-diff-del">- ${escapeHtml(oldLines[oi])}</span>`);
        oi++;
      }
      if (ni < newLines.length) {
        result.push(`<span class="ai-daily-diff-add">+ ${escapeHtml(newLines[ni])}</span>`);
        ni++;
      }
    }
  }
  if (result.length > 40) {
    return result.slice(0, 40).join("\n") + `
<span class="ai-daily-diff-more">\u2026\u8FD8\u6709 ${result.length - 40} \u884C</span>`;
  }
  return result.join("\n");
}
function lcsLines(a, b) {
  const m = a.length, n = b.length;
  if (m > 500 || n > 500) {
    return [];
  }
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i2 = 1; i2 <= m; i2++) {
    for (let j2 = 1; j2 <= n; j2++) {
      dp[i2][j2] = a[i2 - 1] === b[j2 - 1] ? dp[i2 - 1][j2 - 1] + 1 : Math.max(dp[i2 - 1][j2], dp[i2][j2 - 1]);
    }
  }
  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}
function formatTokenK(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}
var ConfirmModal = class extends import_obsidian13.Modal {
  constructor(app, message, onConfirm) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
    this.modalEl.addClass("ai-daily-modal-sm");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });
    const btnRow = contentEl.createDiv({ cls: "ai-daily-confirm-btns" });
    const confirmBtn = btnRow.createEl("button", {
      text: "\u5220\u9664",
      cls: "mod-warning"
    });
    const cancelBtn = btnRow.createEl("button", { text: "\u53D6\u6D88" });
    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
    cancelBtn.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};
var RenameModal = class extends import_obsidian13.Modal {
  constructor(app, currentTitle, onRename) {
    super(app);
    this.currentTitle = currentTitle;
    this.onRename = onRename;
    this.modalEl.addClass("ai-daily-modal-sm");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", { text: "\u91CD\u547D\u540D\u5BF9\u8BDD" });
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "ai-daily-rename-input",
      value: this.currentTitle
    });
    input.style.width = "100%";
    input.style.marginBottom = "12px";
    const btnRow = contentEl.createDiv({ cls: "ai-daily-confirm-btns" });
    const confirmBtn = btnRow.createEl("button", { text: "\u786E\u8BA4", cls: "mod-cta" });
    const cancelBtn = btnRow.createEl("button", { text: "\u53D6\u6D88" });
    confirmBtn.addEventListener("click", () => {
      const v = input.value.trim();
      if (v) {
        this.onRename(v);
        this.close();
      }
    });
    cancelBtn.addEventListener("click", () => this.close());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        if (v) {
          this.onRename(v);
          this.close();
        }
      }
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var _ChatView = class _ChatView extends import_obsidian13.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.closed = false;
    this.messages = [];
    this.client = null;
    this.vaultTools = null;
    this.webTools = new WebTools();
    this.wereadTools = null;
    this.podcastTools = null;
    this.feedTools = null;
    this.contextBtnEl = null;
    this.historyOverlay = null;
    this.historyOverlayResizeCleanup = null;
    this.templatePopupEl = null;
    this.isLoading = false;
    this.userScrolledUp = false;
    this.cachedTokenCount = 0;
    this.sessionId = null;
    this.lastMode = null;
    this.attachedFiles = [];
    this.pendingImages = [];
    this.attachBarEl = null;
    this.harnessContext = null;
    this.mentionPopupEl = null;
    this.mentionStartPos = null;
    this.mentionCursorPos = null;
    this.studioEl = null;
    this.moreBtnEl = null;
    this.studio = null;
    this.scrollFabTopEl = null;
    this.scrollFabBottomEl = null;
    this.readImageCount = 0;
    this.claudeCodeAbort = null;
    this.codexAbort = null;
    this.restoredProxySessionIds = {};
    this.restoredProxyTaskIds = {};
    this.claudeCodeUndoHistory = [];
    this.claudeCodeUndoCounter = 0;
    this.workspaceColorMap = /* @__PURE__ */ new Map();
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Cortex";
  }
  getIcon() {
    return "brain";
  }
  async onOpen() {
    const {
      chatHistoryFolder,
      chatHistoryRetentionDays
    } = this.plugin.settings;
    try {
      await pruneOldSessions(
        this.app.vault,
        chatHistoryFolder,
        chatHistoryRetentionDays
      );
    } catch (e) {
    }
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ai-daily-chat-container");
    this.chatContainerEl = container;
    this.buildHeader(container);
    this.messagesWrapEl = container.createDiv({ cls: "ai-daily-messages-wrap" });
    this.messagesEl = this.messagesWrapEl.createDiv({ cls: "ai-daily-messages" });
    this.messagesEl.addEventListener("scroll", () => {
      const el = this.messagesEl;
      this.userScrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 50;
      this.updateScrollFabs();
    });
    this.buildScrollFabs(this.messagesWrapEl);
    this.tokenBarEl = container.createDiv({ cls: "ai-daily-token-bar" });
    this.updateTokenBar();
    this.buildInputArea(container);
    this.showWelcome();
    if (import_obsidian13.Platform.isMobile) {
      this.setupMobileKeyboard(container);
    }
  }
  buildHeader(container) {
    this.headerEl = container.createDiv({ cls: "ai-daily-header" });
    if (import_obsidian13.Platform.isMobile) {
      const backBtn = this.headerEl.createDiv({
        cls: "ai-daily-header-btn",
        attr: { "aria-label": "\u8FD4\u56DE", title: "\u8FD4\u56DE" }
      });
      (0, import_obsidian13.setIcon)(backBtn, "arrow-left");
      backBtn.addEventListener("click", () => {
        this.leaf.detach();
      });
      const spacer = this.headerEl.createDiv();
      spacer.style.flex = "1";
    }
    const studioBtn = this.headerEl.createDiv({
      cls: "ai-daily-header-btn",
      attr: { "aria-label": "Workspace Studio", title: "Workspace Studio" }
    });
    (0, import_obsidian13.setIcon)(studioBtn, "layout-grid");
    studioBtn.addEventListener("click", () => this.toggleStudio());
    const newChatBtn = this.headerEl.createDiv({
      cls: "ai-daily-header-btn",
      attr: { "aria-label": "\u65B0\u5BF9\u8BDD", title: "\u65B0\u5BF9\u8BDD" }
    });
    (0, import_obsidian13.setIcon)(newChatBtn, "plus");
    newChatBtn.addEventListener("click", () => this.clearChat());
    this.moreBtnEl = this.headerEl.createDiv({
      cls: "ai-daily-header-btn",
      attr: { "aria-label": "\u66F4\u591A", title: "\u66F4\u591A" }
    });
    this.updateMoreButtonVisibility();
    (0, import_obsidian13.setIcon)(this.moreBtnEl, "more-vertical");
    this.moreBtnEl.addEventListener("click", (e) => {
      const menu = new import_obsidian13.Menu();
      const hasSession = !!this.sessionId;
      menu.addItem(
        (item) => item.setTitle("\u4FDD\u5B58\u4E3A\u7B14\u8BB0").setIcon("file-down").setDisabled(!hasSession).onClick(() => this.saveSessionAsNote())
      );
      menu.addItem(
        (item) => item.setTitle("\u590D\u5236\u5168\u6587").setIcon("copy").setDisabled(!hasSession).onClick(() => this.copySessionText())
      );
      menu.addSeparator();
      menu.addItem(
        (item) => item.setTitle("\u91CD\u547D\u540D").setIcon("pencil").setDisabled(!hasSession).onClick(() => this.renameCurrentSession())
      );
      menu.addItem(
        (item) => item.setTitle("\u7F6E\u9876\u5BF9\u8BDD").setIcon("pin").setDisabled(!hasSession).onClick(() => this.togglePinCurrentSession())
      );
      menu.addSeparator();
      menu.addItem(
        (item) => item.setTitle("\u5386\u53F2").setIcon("history").onClick(() => this.openHistoryPanel())
      );
      menu.addItem(
        (item) => item.setTitle("\u84B8\u998F\u77E5\u8BC6").setIcon("sparkles").onClick(() => {
          this.inputEl.value = "/distill";
          this.handleSend();
        })
      );
      menu.addSeparator();
      menu.addItem(
        (item) => item.setTitle("\u5220\u9664\u5BF9\u8BDD").setIcon("trash-2").setDisabled(!hasSession).onClick(() => this.deleteCurrentSession())
      );
      menu.showAtMouseEvent(e);
    });
  }
  updateMoreButtonVisibility() {
    if (!this.moreBtnEl) return;
    this.moreBtnEl.style.display = shouldShowChatMoreButton({
      messageCount: this.messages.length,
      hasSession: !!this.sessionId,
      hasHarnessContext: !!this.harnessContext
    }) ? "" : "none";
  }
  buildInputArea(container) {
    this.inputAreaEl = container.createDiv({ cls: "ai-daily-input-area" });
    this.attachBarEl = this.inputAreaEl.createDiv({ cls: "ai-daily-attach-bar" });
    this.attachBarEl.style.display = "none";
    const inputRow = this.inputAreaEl.createDiv({ cls: "ai-daily-input-row" });
    const inputWrap = inputRow.createDiv({ cls: "ai-daily-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "ai-daily-input",
      attr: { placeholder: "\u56DE\u590D\u2026", rows: "1" }
    });
    this.expandBtn = inputWrap.createEl("button", {
      cls: "ai-daily-expand-btn",
      attr: { "aria-label": "\u5C55\u5F00/\u6536\u8D77\u8F93\u5165\u6846" }
    });
    this.expandBtn.textContent = "\u5C55\u5F00 \u2191";
    this.expandBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const isExpanded = this.inputEl.classList.toggle("expanded");
      this.expandBtn.textContent = isExpanded ? "\u6536\u8D77 \u2193" : "\u5C55\u5F00 \u2191";
      this.autoResizeInput();
    });
    const toolbar = inputWrap.createDiv({ cls: "ai-daily-input-toolbar" });
    const attachBtn = toolbar.createEl("button", {
      cls: "ai-daily-attach-btn",
      attr: { "aria-label": "\u6DFB\u52A0\u7B14\u8BB0" }
    });
    (0, import_obsidian13.setIcon)(attachBtn, "paperclip");
    attachBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.openFilePicker();
    });
    this.contextBtnEl = toolbar.createEl("button", {
      cls: "ai-daily-context-btn",
      attr: { "aria-label": "\u4E0A\u4E0B\u6587\u6587\u4EF6" }
    });
    const ctxIcon = this.contextBtnEl.createSpan({ cls: "ai-daily-context-btn-icon" });
    (0, import_obsidian13.setIcon)(ctxIcon, "file-text");
    this.contextBtnEl.createSpan({ cls: "ai-daily-context-btn-label", text: "\u4E0A\u4E0B\u6587" });
    this.contextBtnEl.createSpan({ cls: "ai-daily-context-btn-badge" });
    this.contextBtnEl.style.display = "none";
    this.contextBtnEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const ctxHeader = this.messagesEl.querySelector(".ai-daily-ctx-header");
      if (ctxHeader) {
        const toggle = ctxHeader.querySelector(".ai-daily-ctx-toggle");
        if (toggle) toggle.click();
      }
    });
    const toolbarSpacer = toolbar.createDiv({ cls: "ai-daily-input-toolbar-spacer" });
    this.sendHintEl = toolbar.createDiv({ cls: "ai-daily-send-hint" });
    this.sendHintEl.createSpan({ text: "\u23CE \u53D1\u9001" });
    this.sendBtn = toolbar.createEl("button", {
      cls: "ai-daily-send-btn"
    });
    (0, import_obsidian13.setIcon)(this.sendBtn, "arrow-up");
    this.sendBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.isLoading) {
        this.handleStop();
      } else {
        this.handleSend();
      }
    });
    this.inputAreaEl.addEventListener("pointerdown", (e) => {
      const target = e.target;
      if (target !== this.inputEl && !target.closest("button") && !target.closest(".ai-daily-attach-chip") && !target.closest(".ai-daily-context-btn") && !target.closest(".ai-daily-mention-popup")) {
        e.preventDefault();
        this.inputEl.focus();
      }
    });
    this.inputEl.addEventListener("input", () => {
      this.autoResizeInput();
      this.updateSendBtnActive();
      this.handleTemplateInput();
      this.handleMentionInput();
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (this.mentionPopupEl) {
        if (e.key === "Escape") {
          e.preventDefault();
          this.closeMentionPopup();
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          this.navigatePopup(this.mentionPopupEl, e.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          const active = this.mentionPopupEl.querySelector(".ai-daily-mention-item-active");
          if (active) {
            e.preventDefault();
            active.click();
            return;
          }
        }
      }
      if (this.templatePopupEl) {
        if (e.key === "Escape") {
          e.preventDefault();
          this.closeTemplatePopup();
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          this.navigateTemplatePopup(e.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (e.key === "Enter") {
          const active = this.templatePopupEl.querySelector(".ai-daily-template-item-active");
          if (active) {
            e.preventDefault();
            active.click();
            return;
          }
        }
      }
      if (e.key === "Enter") {
        if (import_obsidian13.Platform.isMobile) return;
        if (!e.shiftKey) {
          e.preventDefault();
          this.handleSend();
        }
      }
    });
    this.inputEl.addEventListener("paste", (e) => {
      this.handleImagePaste(e);
    });
    this.inputEl.addEventListener("dragover", (e) => {
      var _a;
      if ((_a = e.dataTransfer) == null ? void 0 : _a.types.includes("Files")) {
        e.preventDefault();
      }
    });
    this.inputEl.addEventListener("drop", (e) => {
      this.handleImageDrop(e);
    });
  }
  updateSendBtnActive() {
    const hasContent = this.inputEl.value.trim().length > 0;
    this.sendBtn.toggleClass("ai-daily-send-btn-active", hasContent);
  }
  updateContextBtn() {
    var _a, _b, _c;
    if (!this.contextBtnEl) return;
    const count = (_c = (_b = (_a = this.harnessContext) == null ? void 0 : _a.injectedFiles) == null ? void 0 : _b.length) != null ? _c : 0;
    const badge = this.contextBtnEl.querySelector(".ai-daily-context-btn-badge");
    if (count > 0) {
      this.contextBtnEl.style.display = "";
      if (badge) badge.textContent = String(count);
    } else {
      this.contextBtnEl.style.display = "none";
    }
  }
  // ── Prompt template popup ──────────────────────────────
  handleTemplateInput() {
    const value = this.inputEl.value;
    if (value.startsWith("/")) {
      const query = value.slice(1).toLowerCase();
      const templates = this.plugin.settings.promptTemplates;
      const filtered = query ? templates.filter(
        (t) => t.name.toLowerCase().includes(query) || t.prompt.toLowerCase().includes(query)
      ) : templates;
      if (filtered.length > 0) {
        this.showTemplatePopup(filtered);
      } else {
        this.closeTemplatePopup();
      }
    } else {
      this.closeTemplatePopup();
    }
  }
  showTemplatePopup(templates) {
    this.closeTemplatePopup();
    const popup = this.inputAreaEl.createDiv({ cls: "ai-daily-template-popup" });
    this.templatePopupEl = popup;
    for (let i = 0; i < templates.length; i++) {
      const tpl = templates[i];
      const item = popup.createDiv({
        cls: `ai-daily-template-item${i === 0 ? " ai-daily-template-item-active" : ""}`
      });
      const content = item.createDiv({ cls: "ai-daily-template-item-content" });
      content.createDiv({ cls: "ai-daily-template-item-name", text: tpl.name });
      content.createDiv({
        cls: "ai-daily-template-item-prompt",
        text: tpl.prompt.length > 50 ? tpl.prompt.slice(0, 50) + "\u2026" : tpl.prompt
      });
      const deleteBtn = item.createDiv({ cls: "ai-daily-template-item-delete", attr: { "aria-label": "\u5220\u9664\u6A21\u677F" } });
      deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx = this.plugin.settings.promptTemplates.indexOf(tpl);
        if (idx !== -1) {
          this.plugin.settings.promptTemplates.splice(idx, 1);
          await this.plugin.saveSettings();
          this.handleTemplateInput();
        }
      });
      item.addEventListener("click", () => {
        this.inputEl.value = tpl.prompt;
        this.autoResizeInput();
        this.closeTemplatePopup();
        this.inputEl.focus();
      });
    }
  }
  navigateTemplatePopup(direction) {
    var _a, _b, _c;
    if (!this.templatePopupEl) return;
    const items = Array.from(
      this.templatePopupEl.querySelectorAll(".ai-daily-template-item")
    );
    const activeIndex = items.findIndex(
      (el) => el.classList.contains("ai-daily-template-item-active")
    );
    (_a = items[activeIndex]) == null ? void 0 : _a.classList.remove("ai-daily-template-item-active");
    const next = (activeIndex + direction + items.length) % items.length;
    (_b = items[next]) == null ? void 0 : _b.classList.add("ai-daily-template-item-active");
    (_c = items[next]) == null ? void 0 : _c.scrollIntoView({ block: "nearest" });
  }
  closeTemplatePopup() {
    if (this.templatePopupEl) {
      this.templatePopupEl.remove();
      this.templatePopupEl = null;
    }
  }
  // ── @ mention popup ──────────────────────────────────
  handleMentionInput() {
    var _a;
    const value = this.inputEl.value;
    const cursor = (_a = this.inputEl.selectionStart) != null ? _a : value.length;
    const before = value.slice(0, cursor);
    const atMatch = before.match(/@([^\s@]*)$/);
    if (atMatch) {
      this.mentionStartPos = cursor - atMatch[1].length - 1;
      this.mentionCursorPos = cursor;
      const query = atMatch[1].toLowerCase();
      const allFiles = this.app.vault.getMarkdownFiles();
      const filtered = query ? allFiles.filter(
        (f) => f.basename.toLowerCase().includes(query) || f.path.toLowerCase().includes(query)
      ) : allFiles;
      const sorted = filtered.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 10);
      if (sorted.length > 0) {
        this.showMentionPopup(sorted);
      } else {
        this.closeMentionPopup();
      }
    } else {
      this.closeMentionPopup();
    }
  }
  showMentionPopup(files) {
    if (this.mentionPopupEl) {
      this.mentionPopupEl.remove();
      this.mentionPopupEl = null;
    }
    const popup = this.inputAreaEl.createDiv({ cls: "ai-daily-mention-popup" });
    this.mentionPopupEl = popup;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const already = this.attachedFiles.some((f) => f.path === file.path);
      const item = popup.createDiv({
        cls: `ai-daily-mention-item${i === 0 ? " ai-daily-mention-item-active" : ""}${already ? " ai-daily-mention-item-attached" : ""}`
      });
      const iconSpan = item.createSpan({ cls: "ai-daily-mention-item-icon" });
      (0, import_obsidian13.setIcon)(iconSpan, "file-text");
      const textDiv = item.createDiv({ cls: "ai-daily-mention-item-text" });
      textDiv.createDiv({ cls: "ai-daily-mention-item-name", text: file.basename });
      if (file.parent && file.parent.path !== "/") {
        textDiv.createDiv({ cls: "ai-daily-mention-item-path", text: file.parent.path });
      }
      if (already) {
        const badge = item.createSpan({ cls: "ai-daily-mention-item-badge", text: "\u5DF2\u6DFB\u52A0" });
      }
      item.addEventListener("click", () => {
        this.selectMention(file);
      });
    }
  }
  selectMention(file) {
    var _a, _b;
    if (!this.attachedFiles.some((f) => f.path === file.path)) {
      this.attachedFiles.push(file);
      this.renderAttachBar();
    }
    if (this.mentionStartPos !== null) {
      const value = this.inputEl.value;
      const start = this.mentionStartPos;
      const end = (_b = (_a = this.mentionCursorPos) != null ? _a : this.inputEl.selectionStart) != null ? _b : value.length;
      this.inputEl.value = value.slice(0, start) + value.slice(end);
      this.inputEl.selectionStart = this.inputEl.selectionEnd = start;
    }
    this.closeMentionPopup();
    this.inputEl.focus();
  }
  navigatePopup(popup, direction) {
    var _a, _b, _c;
    const items = Array.from(popup.querySelectorAll(".ai-daily-mention-item"));
    if (items.length === 0) return;
    const activeIndex = items.findIndex((el) => el.classList.contains("ai-daily-mention-item-active"));
    (_a = items[activeIndex]) == null ? void 0 : _a.classList.remove("ai-daily-mention-item-active");
    const next = (activeIndex + direction + items.length) % items.length;
    (_b = items[next]) == null ? void 0 : _b.classList.add("ai-daily-mention-item-active");
    (_c = items[next]) == null ? void 0 : _c.scrollIntoView({ block: "nearest" });
  }
  openFilePicker() {
    if (this.mentionPopupEl) {
      this.closeMentionPopup();
      return;
    }
    const allFiles = this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 20);
    if (allFiles.length > 0) {
      this.mentionStartPos = null;
      this.mentionCursorPos = null;
      this.showMentionPopup(allFiles);
    }
  }
  closeMentionPopup() {
    if (this.mentionPopupEl) {
      this.mentionPopupEl.remove();
      this.mentionPopupEl = null;
    }
    this.mentionStartPos = null;
    this.mentionCursorPos = null;
  }
  renderAttachBar() {
    if (!this.attachBarEl) return;
    this.attachBarEl.empty();
    if (this.attachedFiles.length === 0 && this.pendingImages.length === 0) {
      this.attachBarEl.style.display = "none";
      return;
    }
    this.attachBarEl.style.display = "";
    for (const file of this.attachedFiles) {
      const chip = this.attachBarEl.createDiv({ cls: "ai-daily-attach-chip" });
      const iconSpan = chip.createSpan({ cls: "ai-daily-attach-chip-icon" });
      (0, import_obsidian13.setIcon)(iconSpan, "file-text");
      chip.createSpan({ cls: "ai-daily-attach-chip-name", text: file.basename });
      const removeBtn = chip.createSpan({ cls: "ai-daily-attach-chip-remove" });
      (0, import_obsidian13.setIcon)(removeBtn, "x");
      removeBtn.addEventListener("click", () => {
        this.attachedFiles = this.attachedFiles.filter((f) => f.path !== file.path);
        this.renderAttachBar();
      });
    }
    this.renderImageChips();
  }
  async consumeAttachedFiles() {
    if (this.attachedFiles.length === 0) return "";
    const parts = [];
    for (const file of this.attachedFiles) {
      try {
        const content = await this.app.vault.cachedRead(file);
        parts.push(`## \u9644\u52A0\u7B14\u8BB0: ${file.path}

${content}`);
      } catch (e) {
        parts.push(`## \u9644\u52A0\u7B14\u8BB0: ${file.path}

(\u8BFB\u53D6\u5931\u8D25)`);
      }
    }
    this.attachedFiles = [];
    this.renderAttachBar();
    return parts.join("\n\n---\n\n");
  }
  // ── Image paste / drop ───────────────────────────────
  handleImagePaste(e) {
    var _a;
    const items = (_a = e.clipboardData) == null ? void 0 : _a.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) this.addImageFromBlob(file);
        return;
      }
    }
  }
  handleImageDrop(e) {
    var _a;
    const files = (_a = e.dataTransfer) == null ? void 0 : _a.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith("image/")) {
        e.preventDefault();
        e.stopPropagation();
        this.addImageFromBlob(files[i]);
      }
    }
  }
  addImageFromBlob(file) {
    var _a, _b;
    const ext = (_b = (_a = file.name.split(".").pop()) == null ? void 0 : _a.toLowerCase()) != null ? _b : "";
    const MEDIA_MAP = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif"
    };
    const mediaType = MEDIA_MAP[ext] || file.type || "image/png";
    const inferredExt = mediaType.split("/")[1] === "jpeg" ? "jpg" : mediaType.split("/")[1];
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      if (!base64) return;
      const maxImages = this.plugin.settings.maxImagesPerMessage || 3;
      if (this.pendingImages.length >= maxImages) {
        new import_obsidian13.Notice(`\u6700\u591A\u9644\u5E26 ${maxImages} \u5F20\u56FE\u7247`);
        return;
      }
      const filename = file.name && file.name !== "image" && file.name.includes(".") ? file.name : `paste-${Date.now()}.${inferredExt}`;
      const img = {
        ref: { raw: filename, path: filename },
        mediaType,
        base64
      };
      this.pendingImages.push(img);
      this.renderAttachBar();
      new import_obsidian13.Notice(`\u5DF2\u6DFB\u52A0\u56FE\u7247: ${filename}`);
    };
    reader.readAsDataURL(file);
  }
  renderImageChips() {
    if (!this.attachBarEl || this.pendingImages.length === 0) return;
    for (let i = 0; i < this.pendingImages.length; i++) {
      const img = this.pendingImages[i];
      const chip = this.attachBarEl.createDiv({ cls: "ai-daily-attach-chip ai-daily-attach-chip-image" });
      const thumb = chip.createEl("img", {
        cls: "ai-daily-attach-thumb",
        attr: { src: `data:${img.mediaType};base64,${img.base64}` }
      });
      thumb.style.height = "20px";
      thumb.style.borderRadius = "3px";
      chip.createSpan({ cls: "ai-daily-attach-chip-name", text: img.ref.path });
      const removeBtn = chip.createSpan({ cls: "ai-daily-attach-chip-remove" });
      (0, import_obsidian13.setIcon)(removeBtn, "x");
      const idx = i;
      removeBtn.addEventListener("click", () => {
        this.pendingImages.splice(idx, 1);
        this.renderAttachBar();
      });
    }
  }
  consumePendingImages() {
    if (this.pendingImages.length === 0) return [];
    const images = [...this.pendingImages];
    this.pendingImages = [];
    this.renderAttachBar();
    return images;
  }
  static saveImagesToDisk(images) {
    if (images.length === 0) return [];
    const { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } = require("fs");
    const { join } = require("path");
    const tmpDir = join(process.env.TMPDIR || "/tmp", "ai-daily-images");
    try {
      mkdirSync(tmpDir, { recursive: true });
    } catch (e) {
    }
    try {
      const now = Date.now();
      for (const f of readdirSync(tmpDir)) {
        const fp = join(tmpDir, f);
        try {
          if (now - statSync(fp).mtimeMs > 36e5) unlinkSync(fp);
        } catch (e) {
        }
      }
    } catch (e) {
    }
    const paths = [];
    for (const img of images) {
      const filename = `${Date.now()}-${img.ref.path}`;
      const filepath = join(tmpDir, filename);
      writeFileSync(filepath, Buffer.from(img.base64, "base64"));
      paths.push(filepath);
    }
    return paths;
  }
  static buildImagePrompt(imagePaths) {
    if (imagePaths.length === 0) return "";
    const imageList = imagePaths.map((p) => `- ${p}`).join("\n");
    return `

\u7528\u6237\u63D0\u4F9B\u4E86\u4EE5\u4E0B\u53C2\u8003\u56FE\u7247\uFF0C\u8BF7\u5148\u7528 Read \u5DE5\u5177\u67E5\u770B\uFF1A
${imageList}`;
  }
  // ── Post-processing: wiki-links & code copy buttons ───
  postProcessAssistantEl(el) {
    this.processMarkdownLinks(el);
    this.processWikiLinks(el);
    this.processCodeBlocks(el);
    this.addSaveToInboxBtn(el);
    this.updateForkButtons();
  }
  getOrCreateToolbar(el) {
    let toolbar = el.querySelector(".ai-daily-msg-toolbar");
    if (!toolbar) {
      toolbar = el.createDiv({ cls: "ai-daily-msg-toolbar" });
    }
    return toolbar;
  }
  addSaveToInboxBtn(el) {
    if (el.querySelector(".ai-daily-save-inbox-btn")) return;
    const toolbar = this.getOrCreateToolbar(el);
    const btn = toolbar.createDiv({ cls: "ai-daily-save-inbox-btn" });
    (0, import_obsidian13.setIcon)(btn, "pin");
    btn.setAttribute("aria-label", "\u4FDD\u5B58\u5230 Inbox\uFF08\u6709\u9009\u533A\u65F6\u4EC5\u4FDD\u5B58\u9009\u4E2D\u6587\u5B57\uFF09");
    btn.setAttribute("title", "\u4FDD\u5B58\u5230 Inbox\uFF08\u6709\u9009\u533A\u65F6\u4EC5\u4FDD\u5B58\u9009\u4E2D\u6587\u5B57\uFF09");
    let selectedTextAtPress = "";
    btn.addEventListener("pointerdown", () => {
      selectedTextAtPress = getSelectedTextWithinElement(el, window.getSelection());
    });
    btn.addEventListener("click", async () => {
      var _a;
      const selectedText = selectedTextAtPress || getSelectedTextWithinElement(el, window.getSelection());
      selectedTextAtPress = "";
      const text = selectedText || ((_a = el.textContent) == null ? void 0 : _a.trim()) || "";
      if (!text) return;
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const snippet = text.length > 200 ? text.slice(0, 200) + "\u2026" : text;
      const entry = `- [ ] [AI \u5BF9\u8BDD] ${snippet}`;
      const inboxPath = this.plugin.settings.harnessInboxFile;
      const file = this.app.vault.getAbstractFileByPath(inboxPath);
      const dateHeader = `## ${today}`;
      if (file instanceof import_obsidian13.TFile) {
        let content = await this.app.vault.read(file);
        if (content.includes(dateHeader)) {
          content = content.replace(dateHeader, `${dateHeader}
${entry}`);
        } else {
          const insertPos = content.indexOf("\n## ");
          if (insertPos !== -1) {
            content = content.slice(0, insertPos) + `
${dateHeader}
${entry}
` + content.slice(insertPos);
          } else {
            content += `

${dateHeader}
${entry}`;
          }
        }
        await this.app.vault.modify(file, content);
      } else {
        await this.app.vault.create(inboxPath, `# Inbox

${dateHeader}
${entry}
`);
      }
      btn.empty();
      (0, import_obsidian13.setIcon)(btn, "check");
      btn.addClass("ai-daily-save-inbox-done");
      new import_obsidian13.Notice(selectedText ? "\u5DF2\u4FDD\u5B58\u9009\u4E2D\u5185\u5BB9\u5230 Inbox" : "\u5DF2\u4FDD\u5B58\u5230 Inbox", 2e3);
      setTimeout(() => {
        btn.empty();
        (0, import_obsidian13.setIcon)(btn, "pin");
        btn.removeClass("ai-daily-save-inbox-done");
      }, 2e3);
    });
  }
  updateForkButtons() {
    var _a;
    this.messagesEl.querySelectorAll(".ai-daily-fork-btn").forEach((el) => el.remove());
    const msgEls = this.messagesEl.querySelectorAll(".ai-daily-msg-assistant");
    if (msgEls.length === 0 || this.messages.length < 2) return;
    let assistantDomIdx = 0;
    const assistantMsgIndices = [];
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i].role === "assistant") {
        assistantMsgIndices.push(i);
      }
    }
    for (let d = 0; d < msgEls.length && d < assistantMsgIndices.length; d++) {
      const el = msgEls[d];
      if (el.querySelector(".ai-daily-fork-btn")) continue;
      const msgIdx = assistantMsgIndices[d];
      if (msgIdx < 1 || ((_a = this.messages[msgIdx - 1]) == null ? void 0 : _a.role) !== "user") continue;
      const toolbar = this.getOrCreateToolbar(el);
      const btn = toolbar.createDiv({ cls: "ai-daily-fork-btn" });
      (0, import_obsidian13.setIcon)(btn, "git-branch");
      btn.setAttribute("aria-label", "\u4ECE\u6B64\u5904\u5206\u53C9");
      btn.setAttribute("title", "\u4ECE\u6B64\u5904\u5206\u53C9");
      const capturedIdx = msgIdx;
      btn.addEventListener("click", () => {
        void this.forkAtMessage(capturedIdx);
      });
    }
  }
  processMarkdownLinks(el) {
    el.querySelectorAll("a.internal-link").forEach((link) => {
      var _a;
      const href = (_a = link.getAttr("data-href")) != null ? _a : link.getAttr("href");
      if (!href) return;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.app.workspace.openLinkText(href, "", false);
      });
    });
    el.querySelectorAll("a.external-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const href = link.getAttr("href");
        if (href) window.open(href, "_blank");
      });
    });
  }
  processWikiLinks(el) {
    var _a, _b, _c;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const wikiLinkRe = /\[\[([^\]]+)\]\]/g;
    const replacements = [];
    let textNode;
    while (textNode = walker.nextNode()) {
      if ((_a = textNode.parentElement) == null ? void 0 : _a.closest("pre, code, a")) continue;
      const text = (_b = textNode.textContent) != null ? _b : "";
      if (!wikiLinkRe.test(text)) continue;
      wikiLinkRe.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match;
      while ((match = wikiLinkRe.exec(text)) !== null) {
        if (match.index > lastIndex) {
          frag.appendChild(
            document.createTextNode(text.slice(lastIndex, match.index))
          );
        }
        const linkText = match[1];
        const resolved = this.app.metadataCache.getFirstLinkpathDest(
          linkText,
          ""
        );
        const link = document.createElement("a");
        link.className = "ai-daily-wiki-link";
        link.textContent = linkText;
        link.setAttribute("data-href", linkText);
        if (resolved) {
          link.classList.add("ai-daily-wiki-link-resolved");
          link.addEventListener("click", (e) => {
            e.preventDefault();
            this.app.workspace.openLinkText(linkText, "", false);
          });
        } else {
          link.classList.add("ai-daily-wiki-link-unresolved");
        }
        frag.appendChild(link);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      replacements.push({ node: textNode, frag });
    }
    for (const { node, frag } of replacements) {
      (_c = node.parentNode) == null ? void 0 : _c.replaceChild(frag, node);
    }
  }
  processCodeBlocks(el) {
    el.querySelectorAll("pre > code").forEach((codeEl) => {
      const pre = codeEl.parentElement;
      if (pre.querySelector(".ai-daily-copy-btn") || pre.querySelector(".copy-code-button")) return;
      const btn = pre.createDiv({ cls: "ai-daily-copy-btn" });
      (0, import_obsidian13.setIcon)(btn, "copy");
      btn.setAttribute("aria-label", "\u590D\u5236");
      btn.addEventListener("click", async () => {
        var _a;
        const text = (_a = codeEl.textContent) != null ? _a : "";
        await navigator.clipboard.writeText(text);
        btn.empty();
        (0, import_obsidian13.setIcon)(btn, "check");
        btn.classList.add("ai-daily-copy-btn-done");
        setTimeout(() => {
          btn.empty();
          (0, import_obsidian13.setIcon)(btn, "copy");
          btn.classList.remove("ai-daily-copy-btn-done");
        }, 2e3);
      });
    });
  }
  // ── Mobile keyboard ───────────────────────────────────
  setupMobileKeyboard(container) {
    const inMainArea = this.leaf.getRoot() === this.app.workspace.rootSplit;
    const navbar = document.querySelector(".mobile-navbar");
    const navbarH = navbar ? navbar.getBoundingClientRect().height : 48;
    this.inputAreaEl.style.setProperty("padding-bottom", navbarH + "px", "important");
    if (inMainArea) {
      const killObsidianPadding = new MutationObserver(() => {
        if (container.style.getPropertyValue("padding-bottom") !== "0px") {
          container.style.setProperty("padding-bottom", "0", "important");
        }
      });
      this.register(() => killObsidianPadding.disconnect());
      let focusCount = 0;
      container.addEventListener("focusin", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
        focusCount++;
        container.style.setProperty("padding-bottom", "0", "important");
        killObsidianPadding.observe(container, { attributes: true, attributeFilter: ["style"] });
      });
      container.addEventListener("focusout", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
        focusCount--;
        if (focusCount <= 0) {
          focusCount = 0;
          killObsidianPadding.disconnect();
          container.style.removeProperty("padding-bottom");
        }
      });
      this.inputEl.addEventListener("focus", () => {
        this.inputAreaEl.style.setProperty("padding-bottom", "8px", "important");
      });
      this.inputEl.addEventListener("blur", () => {
        this.inputAreaEl.style.setProperty("padding-bottom", navbarH + "px", "important");
      });
    } else {
      const initialPb = parseFloat(getComputedStyle(container).paddingBottom) || 0;
      const containerTop = container.getBoundingClientRect().top;
      const initialParentH = container.parentElement.getBoundingClientRect().height;
      const tabBarH = window.innerHeight - containerTop - initialParentH;
      const tabBarUiH = Math.max(0, tabBarH - initialPb);
      container.style.setProperty("padding-bottom", "0", "important");
      let keyboardOpen = false;
      let recalcTimer = null;
      const recalcPadding = () => {
        container.style.removeProperty("padding-bottom");
        void container.offsetHeight;
        const obsidianPb = parseFloat(getComputedStyle(container).paddingBottom) || 0;
        let appliedPb;
        if (obsidianPb > 50) {
          appliedPb = Math.max(8, obsidianPb - tabBarUiH);
        } else {
          appliedPb = 0;
        }
        container.style.setProperty("padding-bottom", appliedPb + "px", "important");
      };
      const scheduleRecalc = () => {
        if (recalcTimer) clearTimeout(recalcTimer);
        recalcTimer = setTimeout(recalcPadding, 300);
      };
      const resizeObs = new ResizeObserver(() => {
        if (keyboardOpen) scheduleRecalc();
      });
      resizeObs.observe(container.parentElement);
      this.register(() => resizeObs.disconnect());
      let focusCount = 0;
      container.addEventListener("focusin", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
        focusCount++;
        if (!keyboardOpen) {
          keyboardOpen = true;
          container.addClass("ai-daily-keyboard-open");
          scheduleRecalc();
        }
      });
      container.addEventListener("focusout", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
        focusCount--;
        if (focusCount <= 0) {
          focusCount = 0;
          keyboardOpen = false;
          if (recalcTimer) {
            clearTimeout(recalcTimer);
            recalcTimer = null;
          }
          container.removeClass("ai-daily-keyboard-open");
          container.style.setProperty("padding-bottom", "0", "important");
        }
      });
      this.inputEl.addEventListener("focus", () => {
        this.inputAreaEl.style.setProperty("padding-bottom", "8px", "important");
      });
      this.inputEl.addEventListener("blur", () => {
        this.inputAreaEl.style.setProperty("padding-bottom", navbarH + "px", "important");
      });
    }
  }
  updateTokenBar() {
    const budget = this.plugin.settings.chatContextBudgetTokens;
    const used = this.client ? this.client.estimateContextTokens() : this.cachedTokenCount;
    const pct = Math.min(100, budget > 0 ? used / budget * 100 : 0);
    this.tokenBarEl.empty();
    this.tokenBarEl.toggleClass("ai-daily-token-bar-low", pct < 10);
    this.tokenBarEl.createDiv({
      cls: "ai-daily-token-bar-inner",
      attr: {
        style: `--ai-token-pct:${pct}%;`
      }
    });
    this.tokenBarEl.createSpan({
      cls: "ai-daily-token-bar-label",
      text: `\u7EA6 ${formatTokenK(used)} / ${formatTokenK(budget)} tokens`
    });
  }
  showWelcome() {
    const welcomeEl = this.messagesEl.createDiv({
      cls: "ai-daily-welcome"
    });
    const masthead = welcomeEl.createDiv({ cls: "ai-daily-welcome-masthead" });
    const glyph = masthead.createDiv({ cls: "ai-daily-welcome-glyph" });
    glyph.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A2.5 2.5 0 0 0 9 18a3 3 0 0 0 3 1 3 3 0 0 0 3-1 2.5 2.5 0 0 0 2-4.8A3 3 0 0 0 15 8a3 3 0 0 0-3-3Z"/><path d="M12 5v14"/></svg>';
    const titleRow = masthead.createEl("h1", { cls: "ai-daily-welcome-title" });
    titleRow.createSpan({ text: "Cortex" });
    titleRow.createSpan({ cls: "ai-daily-welcome-ver", text: `v${this.plugin.manifest.version}` });
    this.buildResumeHero(welcomeEl);
    this.buildWelcomeHarness(welcomeEl);
    const tools = [
      { icon: "layout-grid", label: "Studio", action: () => void this.openStudio() },
      { icon: "history", label: "\u5386\u53F2", action: () => this.openHistoryPanel() },
      { icon: "heart-pulse", label: "Wiki", action: () => this.plugin.runWikiHealthCheck() }
    ];
    const toolsEl = welcomeEl.createDiv({ cls: "ai-daily-welcome-tools" });
    for (const t of tools) {
      const btn = toolsEl.createEl("button", { cls: "ai-daily-welcome-tool" });
      const iconEl = btn.createSpan({ cls: "ai-daily-welcome-tool-icon" });
      (0, import_obsidian13.setIcon)(iconEl, t.icon);
      btn.createSpan({ text: t.label });
      btn.addEventListener("click", t.action);
    }
    this.updateTokenBar();
  }
  buildResumeHero(welcomeEl) {
    listChatSessions(
      this.app.vault,
      this.plugin.settings.chatHistoryFolder
    ).then((sessions) => {
      var _a, _b, _c, _d, _e, _f;
      if (sessions.length === 0) return;
      const last = sessions[0];
      const hero = welcomeEl.createDiv({ cls: "ai-daily-welcome-hero" });
      const playBtn = hero.createDiv({ cls: "ai-daily-welcome-hero-play" });
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      const info = hero.createDiv({ cls: "ai-daily-welcome-hero-info" });
      info.createDiv({ cls: "ai-daily-welcome-hero-label", text: "\u7EE7\u7EED\u4E0A\u6B21" });
      const modeName = ((_a = last.harnessContext) == null ? void 0 : _a.mode) ? `${last.harnessContext.mode.label}` : "";
      const actionLabel = (_e = (_d = (_c = (_b = last.harnessContext) == null ? void 0 : _b.mode) == null ? void 0 : _c.actions) == null ? void 0 : _d[0]) == null ? void 0 : _e.label;
      const titleParts = [modeName, actionLabel].filter(Boolean).join(" \xB7 ");
      info.createDiv({ cls: "ai-daily-welcome-hero-title", text: titleParts || last.title || "\u65B0\u5BF9\u8BDD" });
      const wsName = last.workspace || ((_f = last.harnessContext) == null ? void 0 : _f.workspace) || "";
      const timeStr = last.updated ? this.formatRelativeTime(last.updated) : "";
      const metaParts = [wsName, timeStr].filter(Boolean).join(" \xB7 ");
      if (metaParts) {
        info.createDiv({ cls: "ai-daily-welcome-hero-meta", text: metaParts });
      }
      const chevron = hero.createSpan({ cls: "ai-daily-welcome-hero-chevron" });
      (0, import_obsidian13.setIcon)(chevron, "chevron-right");
      hero.addEventListener("click", () => {
        void this.loadSession(last.id);
      });
      const harness = welcomeEl.querySelector(".ai-daily-welcome-harness");
      if (harness) welcomeEl.insertBefore(hero, harness);
    });
  }
  formatRelativeTime(dateStr) {
    const now = Date.now();
    const then = Date.parse(dateStr);
    if (isNaN(then)) return "";
    const diff = now - then;
    const mins = Math.floor(diff / 6e4);
    if (mins < 60) return "\u521A\u521A";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
    const days = Math.floor(hours / 24);
    if (days === 0) return "\u4ECA\u5929";
    if (days === 1) return "\u6628\u5929";
    if (days < 7) return `${days} \u5929\u524D`;
    if (days < 30) return "\u4E0A\u5468";
    return `${Math.floor(days / 30)} \u6708\u524D`;
  }
  toggleStudio() {
    if (this.studioEl) {
      this.closeStudio();
    } else {
      void this.openStudio();
    }
  }
  async openStudio() {
    if (this.studioEl) return;
    this.messagesWrapEl.style.display = "none";
    this.inputAreaEl.style.display = "none";
    this.tokenBarEl.style.display = "none";
    this.studioEl = this.chatContainerEl.createDiv({ cls: "ai-daily-studio-panel" });
    this.studio = new WorkspaceStudio(this.studioEl, this.plugin, {
      onStartWithContext: (ctx) => {
        this.closeStudio();
        this.startWithContext(ctx);
      },
      onOpenSession: (id) => {
        this.closeStudio();
        void this.loadSession(id);
      },
      onStartFresh: () => {
        this.closeStudio();
        this.clearChat();
      },
      onClose: () => this.closeStudio()
    });
    await this.studio.render();
  }
  closeStudio() {
    var _a;
    if (!this.studioEl) return;
    (_a = this.studio) == null ? void 0 : _a.destroy();
    this.studio = null;
    this.studioEl.remove();
    this.studioEl = null;
    this.messagesWrapEl.style.display = "";
    this.inputAreaEl.style.display = "";
    this.tokenBarEl.style.display = "";
  }
  buildWelcomeHarness(welcomeEl) {
    const container = welcomeEl.createDiv({ cls: "ai-daily-welcome-harness" });
    loadProjectIndex(
      this.app.vault,
      this.app.metadataCache,
      this.plugin.settings.harnessProjectsFolder
    ).then((index) => {
      if (!index || index.projects.length === 0) return;
      const projectsFolder = this.plugin.settings.harnessProjectsFolder;
      const activeProjects = index.projects.filter((p) => p.status !== "archive");
      const archivedCount = index.projects.length - activeProjects.length;
      const secHead = container.createDiv({ cls: "ai-daily-welcome-sec-head" });
      secHead.createSpan({ cls: "ai-daily-welcome-sec-label", text: "\u5DE5\u4F5C\u533A" });
      const countParts = [String(activeProjects.length)];
      if (archivedCount > 0) countParts.push(`${archivedCount} \u5DF2\u5F52\u6863`);
      secHead.createSpan({ cls: "ai-daily-welcome-sec-count", text: countParts.join(" \xB7 ") });
      for (const project of activeProjects) {
        const modesPath = `${projectsFolder}/${project.name}/modes.md`;
        const modesFile = this.app.vault.getAbstractFileByPath(modesPath);
        if (!(modesFile instanceof import_obsidian13.TFile)) continue;
        void this.app.vault.read(modesFile).then((content) => {
          const modes = parseModesFromContent(content);
          if (modes.length === 0) return;
          const card = container.createDiv({ cls: "ai-daily-welcome-card" });
          const cardHead = card.createDiv({ cls: "ai-daily-welcome-card-head" });
          const cardIcon = cardHead.createSpan({ cls: "ai-daily-welcome-card-icon" });
          (0, import_obsidian13.setIcon)(cardIcon, "folder");
          cardHead.createSpan({ cls: "ai-daily-welcome-card-name", text: project.name });
          if (project.name === index.activeProject) {
            cardHead.createSpan({ cls: "ai-daily-welcome-card-dot" });
          }
          const chips = card.createDiv({ cls: "ai-daily-welcome-chips" });
          for (const mode of modes) {
            const resolveContext = () => {
              const resolveVars = (p) => {
                let r = p;
                r = r.replace(/\{active_project\}/g, project.name);
                r = r.replace(/\{active_work_context\}/g, index.activeWorkContext || "");
                return r;
              };
              const resolvedFiles = resolveFileEntries(mode.files, this.app, resolveVars);
              return { mode, injectedFiles: resolvedFiles, workspace: project.name };
            };
            const boltSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>';
            if (mode.actions.length >= 1) {
              for (const action of mode.actions) {
                const chip = chips.createEl("button", { cls: "ai-daily-welcome-chip ai-daily-welcome-chip--action" });
                const bolt = chip.createSpan({ cls: "ai-daily-welcome-chip-bolt" });
                bolt.innerHTML = boltSvg;
                chip.createSpan({ text: action.label });
                chip.addEventListener("click", () => {
                  const ctx = resolveContext();
                  this.startWithContext(ctx);
                  this.inputEl.value = action.prompt;
                  void this.handleSend();
                });
              }
            } else {
              const chip = chips.createEl("button", { cls: "ai-daily-welcome-chip" });
              chip.createSpan({ text: mode.label });
              chip.addEventListener("click", () => {
                this.startWithContext(resolveContext());
              });
            }
          }
        });
      }
    });
  }
  autoResizeInput() {
    this.inputEl.style.height = "auto";
    const isExpanded = this.inputEl.classList.contains("expanded");
    const maxH = isExpanded ? window.innerHeight * 0.5 : 200;
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, maxH) + "px";
    const overflowing = this.inputEl.scrollHeight > 200;
    this.expandBtn.classList.toggle("visible", overflowing);
    if (!overflowing) {
      this.inputEl.classList.remove("expanded");
      this.expandBtn.textContent = "\u5C55\u5F00 \u2191";
    }
  }
  handleStop() {
    if (!this.isLoading) return;
    if (this.claudeCodeAbort) {
      this.claudeCodeAbort();
      this.claudeCodeAbort = null;
      return;
    }
    if (this.codexAbort) {
      this.codexAbort();
      this.codexAbort = null;
      return;
    }
    if (this.client) {
      this.client.abort();
    }
  }
  setSendButtonState(loading) {
    (0, import_obsidian13.setIcon)(this.sendBtn, loading ? "square" : "arrow-up");
    this.sendBtn.toggleClass("ai-daily-send-btn-stop", loading);
    if (!loading) this.updateSendBtnActive();
    this.sendBtn.setAttribute("aria-label", loading ? "\u505C\u6B62\u751F\u6210" : "\u53D1\u9001");
    this.sendBtn.setAttribute("title", loading ? "\u505C\u6B62\u751F\u6210" : "\u53D1\u9001");
  }
  async handleSend() {
    var _a, _b, _c;
    this.closeTemplatePopup();
    const text = this.inputEl.value.trim();
    if (!text || this.isLoading) return;
    if (text === "/distill") {
      this.inputEl.value = "";
      this.inputEl.style.height = "auto";
      this.handleDistillAsMessage();
      return;
    }
    const cliBackend = this.plugin.settings.cliBackend;
    const useCodex = cliBackend === "codex" && await isCodexAvailable();
    const useClaudeCode = cliBackend === "claude-code" && await isClaudeCodeAvailable();
    const useCliAgent = useCodex || useClaudeCode;
    const proxyReady = this.plugin.settings.proxyEnabled && !!this.plugin.settings.proxyUrl && !!this.plugin.settings.proxyToken;
    if (!useCliAgent && !this.plugin.getEffectiveApiKey() && !proxyReady) {
      this.addMessage(
        "assistant",
        "\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E Anthropic API Key\uFF0C\u6216\u5B89\u88C5 Claude Code / Codex\u3002"
      );
      return;
    }
    this.isLoading = true;
    this.readImageCount = 0;
    this.setSendButtonState(true);
    this.inputEl.value = "";
    this.inputEl.style.height = "auto";
    this.inputEl.classList.remove("expanded");
    this.expandBtn.classList.remove("visible");
    this.expandBtn.textContent = "\u5C55\u5F00 \u2191";
    const currentMode = useCodex ? "codex" : useClaudeCode ? "claude-code" : proxyReady ? "proxy" : "api";
    if (this.lastMode && this.lastMode !== currentMode) {
      if (this.lastMode === "proxy" || (this.lastMode === "claude-code" || this.lastMode === "codex") && currentMode === "proxy") {
        (_a = this.client) == null ? void 0 : _a.clearProxySessionId();
      }
      if (this.lastMode === "claude-code" || this.lastMode === "codex" || this.lastMode === "proxy" && (currentMode === "claude-code" || currentMode === "codex")) {
        this.claudeCodeSessionId = void 0;
        this.codexSessionId = void 0;
      }
      const modeNames = {
        "claude-code": "\u672C\u5730 Claude Code",
        "codex": "\u672C\u5730 Codex",
        "proxy": "\u4EE3\u7406\u6A21\u5F0F",
        "api": "API \u76F4\u8FDE"
      };
      new import_obsidian13.Notice(`\u5DF2\u5207\u6362\u5230${modeNames[currentMode]}\uFF0C\u5BF9\u8BDD\u4E0A\u4E0B\u6587\u5C06\u81EA\u52A8\u540C\u6B65`, 4e3);
    }
    this.lastMode = currentMode;
    if (useCodex) {
      const images2 = this.consumePendingImages();
      this.handleSendViaCodex(text, images2).catch((e) => {
        console.error("[ai-daily] Codex error:", e);
        this.addMessage("assistant", `Codex \u51FA\u9519: ${e instanceof Error ? e.message : String(e)}`, "codex");
        this.isLoading = false;
        this.setSendButtonState(false);
      });
      return;
    }
    if (useClaudeCode) {
      const images2 = this.consumePendingImages();
      this.handleSendViaClaudeCode(text, images2).catch((e) => {
        console.error("[ai-daily] Claude Code error:", e);
        this.addMessage("assistant", `Claude Code \u51FA\u9519: ${e instanceof Error ? e.message : String(e)}`, "claude-code");
        this.isLoading = false;
        this.setSendButtonState(false);
      });
      return;
    }
    const images = this.consumePendingImages();
    const attachedContent = await this.consumeAttachedFiles();
    const userMessage = attachedContent ? attachedContent + "\n\n" + text : text;
    const displayText = images.length > 0 ? `${text}
[\u{1F4F7} ${images.length} \u5F20\u56FE\u7247]` : text;
    this.addMessage("user", displayText);
    if (!this.sessionId) {
      this.sessionId = newSessionId();
    }
    const proxySettingsChanged = this.client && this.client.isProxyMode() !== (this.plugin.settings.proxyEnabled && !!this.plugin.settings.proxyUrl);
    if (!this.client || proxySettingsChanged) {
      await this.initClient();
      this.restoreProxyHandlesToClient();
    }
    const loadingEl = this.messagesEl.createDiv({
      cls: "ai-daily-loading"
    });
    const loadingTextEl = loadingEl.createSpan({ text: "\u601D\u8003\u4E2D" });
    const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    const useStream = this.plugin.settings.chatStreamMode !== "off";
    let assistantEl = null;
    let streamingRenderTimer = null;
    let latestStreamingMarkdown = "";
    let streamingRenderQueue = Promise.resolve();
    const renderStreamingMarkdown = async (content) => {
      if (!assistantEl) return;
      assistantEl.empty();
      await import_obsidian13.MarkdownRenderer.render(
        this.app,
        normalizeMarkdownForObsidian(content),
        assistantEl,
        "",
        this.plugin
      );
      this.scrollToBottomIfFollowing();
    };
    const scheduleStreamingMarkdown = (content) => {
      latestStreamingMarkdown = content;
      if (streamingRenderTimer !== null) return;
      streamingRenderTimer = window.setTimeout(() => {
        streamingRenderTimer = null;
        const snapshot = latestStreamingMarkdown;
        streamingRenderQueue = streamingRenderQueue.then(
          () => renderStreamingMarkdown(snapshot)
        );
      }, STREAM_MARKDOWN_RENDER_INTERVAL_MS);
    };
    const flushStreamingMarkdown = async (content) => {
      latestStreamingMarkdown = content;
      if (streamingRenderTimer !== null) {
        window.clearTimeout(streamingRenderTimer);
        streamingRenderTimer = null;
      }
      await streamingRenderQueue;
      await renderStreamingMarkdown(content);
    };
    const cancelStreamingMarkdown = () => {
      if (streamingRenderTimer !== null) {
        window.clearTimeout(streamingRenderTimer);
        streamingRenderTimer = null;
      }
    };
    let proxyTypewriterTarget = "";
    let proxyTypewriterRendered = 0;
    let proxyTypewriterTimer = null;
    try {
      let preparedImages;
      if (this.plugin.settings.enableLocalImages) {
        const refs = extractLocalImageRefs(text);
        if (refs.length > 0) {
          const { images: images2, skipped } = await prepareLocalImages(
            this.app,
            refs,
            {
              maxImages: this.plugin.settings.maxImagesPerMessage,
              maxBytes: this.plugin.settings.maxImageBytes
            }
          );
          if (images2.length > 0) {
            preparedImages = images2;
            new import_obsidian13.Notice(`\u5DF2\u9644\u5E26 ${images2.length} \u5F20\u56FE\u7247`);
          }
          if (skipped.length > 0) {
            new import_obsidian13.Notice(
              `\u8DF3\u8FC7 ${skipped.length} \u5F20\u56FE\u7247: ${skipped.map((s) => s.reason).join(", ")}`
            );
          }
        }
      }
      const proxyImages = images.length > 0 && ((_b = this.client) == null ? void 0 : _b.isProxyMode()) ? images.map((img) => ({ name: img.ref.path, base64: img.base64, mediaType: img.mediaType })) : void 0;
      if (images.length > 0 && !((_c = this.client) == null ? void 0 : _c.isProxyMode())) {
        new import_obsidian13.Notice("API \u6A21\u5F0F\u4E0B\u8BF7\u4F7F\u7528 ![[\u56FE\u7247]] \u5F15\u7528 vault \u5185\u56FE\u7247");
      }
      let toolCallsEl = null;
      let toolCallsSummaryEl = null;
      const toolCallEls = /* @__PURE__ */ new Map();
      let toolCallCounter = 0;
      let toolTotal = 0;
      let toolRunning = 0;
      const onToolCall = (name, input, status) => {
        if (status === "start") {
          loadingEl.remove();
          if (!toolCallsEl) {
            const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
            const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
            toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
            toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
          }
          toolTotal++;
          toolRunning++;
          const key = `${name}-${toolCallCounter++}`;
          const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
          const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
          (0, import_obsidian13.setIcon)(iconSpan, "loader");
          el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
          toolCallEls.set(key, el);
          this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
          this.scrollToBottomIfFollowing();
        } else {
          const lastKey = `${name}-${toolCallCounter - 1}`;
          const el = toolCallEls.get(lastKey);
          if (el) {
            el.removeClass("ai-daily-tool-call-running");
            el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
            const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
            if (iconSpan) {
              iconSpan.empty();
              (0, import_obsidian13.setIcon)(iconSpan, status === "done" ? "check" : "x");
            }
            toolRunning--;
            this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
          }
        }
      };
      const PROXY_TYPEWRITER_INTERVAL = 25;
      const proxyTypewriterTick = () => {
        const buffered = proxyTypewriterTarget.length - proxyTypewriterRendered;
        if (buffered <= 0) {
          proxyTypewriterTimer = null;
          return;
        }
        const chars = buffered > 60 ? 4 : buffered > 20 ? 2 : 1;
        proxyTypewriterRendered = Math.min(proxyTypewriterRendered + chars, proxyTypewriterTarget.length);
        scheduleStreamingMarkdown(proxyTypewriterTarget.slice(0, proxyTypewriterRendered));
        proxyTypewriterTimer = window.setTimeout(proxyTypewriterTick, PROXY_TYPEWRITER_INTERVAL);
      };
      const startProxyTypewriter = () => {
        if (proxyTypewriterTimer !== null) return;
        proxyTypewriterTimer = window.setTimeout(proxyTypewriterTick, PROXY_TYPEWRITER_INTERVAL);
      };
      const flushProxyTypewriter = () => {
        if (proxyTypewriterTimer !== null) {
          window.clearTimeout(proxyTypewriterTimer);
          proxyTypewriterTimer = null;
        }
        proxyTypewriterRendered = proxyTypewriterTarget.length;
      };
      const streamCb = useStream ? (_delta, accumulated) => {
        loadingEl.remove();
        if (!assistantEl) {
          assistantEl = this.messagesEl.createDiv({
            cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming"
          });
        }
        if (this.client.isProxyMode()) {
          proxyTypewriterTarget = accumulated;
          startProxyTypewriter();
        } else {
          scheduleStreamingMarkdown(accumulated);
        }
      } : void 0;
      const doLocalChat = () => this.client.chat(
        userMessage,
        async (name, input) => {
          if (name === "web_fetch") return this.webTools.execute(name, input);
          if (name === "read_image") return this.executeReadImage(input);
          if (name === "weread_api" && this.wereadTools) return this.wereadTools.execute(name, input);
          if (name.startsWith("podcast_") && this.podcastTools) return this.podcastTools.execute(name, input);
          if (name.startsWith("fetch_") && this.feedTools) return this.feedTools.execute(name, input);
          return this.vaultTools.execute(name, input);
        },
        streamCb,
        preparedImages,
        onToolCall
      );
      let reply;
      let actualSource = "api";
      if (this.client.isProxyMode()) {
        const proxyBackend = this.plugin.settings.cliBackend;
        const isFirstProxyMessage = !this.client.getProxySessionId(proxyBackend);
        let seedHistory;
        if (isFirstProxyMessage && this.messages.length > 1) {
          seedHistory = this.messages.slice(0, -1).map((m) => ({
            role: m.role,
            content: m.content
          }));
        }
        let proxyMessage = userMessage;
        if (isFirstProxyMessage && this.harnessContext) {
          const hm = this.harnessContext.mode;
          const filesList = this.harnessContext.injectedFiles.map((f) => f.path).join("\n");
          const harnessBlock = [
            `[Harness \u6A21\u5F0F\uFF1A${hm.emoji} ${hm.label}]`,
            "",
            hm.systemPromptAppend,
            "",
            filesList ? `\u76F8\u5173\u6587\u4EF6\uFF08\u9700\u8981\u65F6\u8BF7\u7528\u5DE5\u5177\u8BFB\u53D6\uFF09\uFF1A
${filesList}` : "",
            "",
            "\u8BF7\u4E25\u683C\u6309\u7167\u4E0A\u8FF0\u6A21\u5F0F\u8981\u6C42\u56DE\u590D\uFF0C\u4E0D\u8981\u504F\u79BB\u89D2\u8272\u3002",
            "---",
            ""
          ].filter(Boolean).join("\n");
          proxyMessage = harnessBlock + proxyMessage;
        }
        try {
          reply = await this.client.proxyChat(
            proxyMessage,
            streamCb,
            onToolCall,
            seedHistory,
            proxyBackend,
            this.plugin.settings.cliBackend === "codex" ? this.plugin.settings.codexModel : this.plugin.settings.claudeCodeModel,
            this.plugin.settings.codexPermissionMode,
            this.plugin.settings.cliBackend === "codex" ? this.plugin.settings.codexReasoningEffort : this.plugin.settings.claudeCodeEffort,
            (message) => loadingTextEl.setText(message),
            proxyImages
          );
          actualSource = "proxy";
        } catch (proxyErr) {
          if (this.plugin.settings.proxyFallbackToApi && this.plugin.getEffectiveApiKey()) {
            console.warn("[ai-daily] proxy failed, falling back to API:", proxyErr);
            new import_obsidian13.Notice("\u4EE3\u7406\u4E0D\u53EF\u7528\uFF0C\u56DE\u9000\u5230\u672C\u5730 API", 4e3);
            this.client.clearProxySessionId(proxyBackend);
            this.lastMode = "api";
            reply = await doLocalChat();
            actualSource = "api";
          } else {
            throw proxyErr;
          }
        }
      } else {
        reply = await doLocalChat();
        actualSource = "api";
      }
      loadingEl.remove();
      flushProxyTypewriter();
      const lastUserMsg = this.messages[this.messages.length - 1];
      if ((lastUserMsg == null ? void 0 : lastUserMsg.role) === "user") lastUserMsg.source = actualSource;
      if (useStream && assistantEl) {
        await flushStreamingMarkdown(reply || "*(\u5DF2\u505C\u6B62)*");
        this.postProcessAssistantEl(assistantEl);
        assistantEl.removeClass("ai-daily-msg-streaming");
        this.messages.push({ role: "assistant", content: reply || "*(\u5DF2\u505C\u6B62)*", source: actualSource });
        this.cachedTokenCount += estimateTextTokens(reply);
      } else if (reply) {
        this.addMessage("assistant", reply, actualSource);
      } else {
        this.addMessage("assistant", "*(\u7A7A\u56DE\u590D\uFF0C\u8BF7\u68C0\u67E5\u4EE3\u7406\u914D\u7F6E)*", actualSource);
      }
      this.scrollToBottomIfFollowing();
      this.renderUndoBar();
      if (this.client.isProxyMode()) {
        await this.fetchAndRenderProxyUndo();
      }
      await this.persistSession();
      this.updateTokenBar();
    } catch (e) {
      if (proxyTypewriterTimer !== null) {
        window.clearTimeout(proxyTypewriterTimer);
        proxyTypewriterTimer = null;
      }
      cancelStreamingMarkdown();
      loadingEl.remove();
      if (assistantEl && latestStreamingMarkdown) {
        assistantEl.removeClass("ai-daily-msg-streaming");
        this.messages.push({ role: "assistant", content: latestStreamingMarkdown });
      } else if (assistantEl) {
        assistantEl.remove();
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.addMessage("assistant", `\u51FA\u9519\u4E86: ${msg}`);
    } finally {
      this.isLoading = false;
      this.setSendButtonState(false);
      this.updateTokenBar();
    }
  }
  getMcpConfig() {
    const { knowledgeFolders, enableWeRead, wereadApiKey } = this.plugin.settings;
    const adapter = this.app.vault.adapter;
    const vaultPath = adapter.basePath || "";
    const mcpServerPath = getMcpServerPath();
    return { vaultPath, mcpServerPath, knowledgeFolders, ...enableWeRead && wereadApiKey ? { wereadApiKey } : {} };
  }
  async handleSendViaClaudeCode(text, images = []) {
    const displayText = images.length > 0 ? `${text}
[\u{1F4F7} ${images.length} \u5F20\u56FE\u7247]` : text;
    this.addMessage("user", displayText, "claude-code");
    if (!this.sessionId) this.sessionId = newSessionId();
    const isFirstMessage = !this.claudeCodeSessionId;
    const attachedContent = await this.consumeAttachedFiles();
    const imagePaths = _ChatView.saveImagesToDisk(images);
    let prompt = text + _ChatView.buildImagePrompt(imagePaths);
    if (isFirstMessage && this.messages.length > 1) {
      const adapter = this.app.vault.adapter;
      const vaultAbsPath = adapter.basePath || "";
      const history = this.messages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content
      }));
      try {
        const seededId = await seedClaudeCodeSession(history, vaultAbsPath, this.plugin.settings.claudeCodeModel);
        this.claudeCodeSessionId = seededId;
      } catch (e) {
        console.error("[ai-daily] Failed to seed claude-code session:", e);
      }
    }
    if (isFirstMessage && !this.claudeCodeSessionId) {
      const adapter = this.app.vault.adapter;
      const vaultAbsPath = adapter.basePath || "";
      const systemPromptText = buildSystemPrompt({
        mode: "claude-code",
        knowledgeFolders: this.plugin.settings.knowledgeFolders,
        distillTargetFolder: this.plugin.settings.distillTargetFolder,
        autoTagFolders: this.plugin.settings.autoTagFolders,
        enableWebSearch: false,
        enableWeRead: this.plugin.settings.enableWeRead && !!this.plugin.settings.wereadApiKey,
        enablePodcast: false,
        harnessContext: this.harnessContext,
        vaultAbsPath
      });
      prompt = systemPromptText + "\n\n" + (attachedContent ? attachedContent + "\n\n" : "") + text;
    } else if (attachedContent) {
      prompt = attachedContent + "\n\n" + text;
    }
    this.runClaudeCodeStream(prompt, this.getMcpConfig(), this.claudeCodeSessionId, this.plugin.settings.claudeCodeModel);
  }
  async handleSendViaCodex(text, images = []) {
    const displayText = images.length > 0 ? `${text}
[\u{1F4F7} ${images.length} \u5F20\u56FE\u7247]` : text;
    this.addMessage("user", displayText, "codex");
    if (!this.sessionId) this.sessionId = newSessionId();
    const isFirstMessage = !this.codexSessionId;
    const attachedContent = await this.consumeAttachedFiles();
    const imagePaths = _ChatView.saveImagesToDisk(images);
    let prompt = text + _ChatView.buildImagePrompt(imagePaths);
    if (isFirstMessage) {
      const adapter = this.app.vault.adapter;
      const vaultAbsPath = adapter.basePath || "";
      const systemPromptText = buildSystemPrompt({
        mode: "codex",
        knowledgeFolders: this.plugin.settings.knowledgeFolders,
        distillTargetFolder: this.plugin.settings.distillTargetFolder,
        autoTagFolders: this.plugin.settings.autoTagFolders,
        enableWebSearch: false,
        enableWeRead: this.plugin.settings.enableWeRead && !!this.plugin.settings.wereadApiKey,
        enablePodcast: false,
        harnessContext: this.harnessContext,
        vaultAbsPath
      });
      prompt = systemPromptText + "\n\n" + (attachedContent ? attachedContent + "\n\n" : "") + text;
    } else if (attachedContent) {
      prompt = attachedContent + "\n\n" + text;
    }
    this.runCodexStream(prompt, this.getMcpConfig(), this.codexSessionId, this.plugin.settings.codexModel);
  }
  async executeReadImage(input) {
    const path = typeof input.path === "string" ? input.path : "";
    if (!path) return "Error: path is required";
    if (this.readImageCount >= _ChatView.MAX_IMAGES_PER_TURN) {
      return `[\u5DF2\u8FBE\u672C\u8F6E\u56FE\u7247\u4E0A\u9650 ${_ChatView.MAX_IMAGES_PER_TURN} \u5F20\uFF0C\u65E0\u6CD5\u8BFB\u53D6 ${path}\u3002\u8BF7\u5148\u57FA\u4E8E\u5DF2\u8BFB\u53D6\u7684\u56FE\u7247\u56DE\u590D\u7528\u6237\uFF0C\u7528\u6237\u53EF\u5728\u540E\u7EED\u6D88\u606F\u4E2D\u8981\u6C42\u7EE7\u7EED\u8BFB\u53D6\u3002]`;
    }
    const refs = [{ raw: path, path }];
    const { images, skipped } = await prepareLocalImages(this.app, refs, {
      maxImages: 1,
      maxBytes: this.plugin.settings.maxImageBytes
    });
    if (skipped.length > 0) return `Error: ${skipped[0].reason} (${path})`;
    if (images.length === 0) return `Error: \u65E0\u6CD5\u8BFB\u53D6\u56FE\u7247 (${path})`;
    this.readImageCount++;
    const img = images[0];
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
          data: img.base64
        }
      },
      { type: "text", text: `\u56FE\u7247: ${path} (${this.readImageCount}/${_ChatView.MAX_IMAGES_PER_TURN})` }
    ];
  }
  async initClient() {
    const {
      apiKey,
      model,
      knowledgeFolders,
      chatStreamMode,
      chatCompressThresholdEst,
      enableWebSearch,
      enableWeRead,
      wereadApiKey,
      enablePodcast
    } = this.plugin.settings;
    this.vaultTools = new VaultTools(this.app, knowledgeFolders);
    const weReadActive = enableWeRead && !!wereadApiKey;
    this.wereadTools = weReadActive ? new WeReadTools(wereadApiKey) : null;
    this.podcastTools = enablePodcast ? new PodcastTools() : null;
    this.feedTools = new FeedTools(this.plugin.settings.feedSources);
    const knowledgeContext = await this.vaultTools.loadKnowledgeContext(5);
    const proxyActive = this.plugin.settings.proxyEnabled;
    const systemPrompt = buildSystemPrompt({
      mode: proxyActive ? "proxy" : "api",
      knowledgeFolders,
      distillTargetFolder: this.plugin.settings.distillTargetFolder,
      autoTagFolders: this.plugin.settings.autoTagFolders,
      enableWebSearch,
      enableWeRead: weReadActive,
      enablePodcast,
      harnessContext: this.harnessContext,
      knowledgeContext: knowledgeContext || void 0
    });
    this.client = new ClaudeClient(apiKey, model, systemPrompt, {
      streamMode: chatStreamMode,
      enableWebSearch,
      enableWeRead: weReadActive,
      enablePodcast,
      enableFeeds: true,
      compressThresholdEst: chatCompressThresholdEst,
      onCompress: (detail) => {
        new import_obsidian13.Notice(detail, 6e3);
      },
      onStreamFallback: (reason) => {
        console.warn("[ai-daily] stream fallback:", reason);
      },
      proxyUrl: proxyActive ? this.plugin.settings.proxyUrl : void 0,
      proxyToken: proxyActive ? this.plugin.settings.proxyToken : void 0
    });
  }
  async persistSession() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    if (!this.sessionId) return;
    const { chatHistoryFolder, model } = this.plugin.settings;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const persisted = this.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...m.source ? { source: m.source } : {}
    }));
    const existing = await loadChatSession(
      this.app.vault,
      chatHistoryFolder,
      this.sessionId
    );
    const file = {
      id: this.sessionId,
      title: titleFromMessages(persisted),
      model,
      created: (_a = existing == null ? void 0 : existing.created) != null ? _a : now,
      updated: now,
      messages: persisted,
      claudeCodeSessionId: this.claudeCodeSessionId,
      codexSessionId: this.codexSessionId,
      claudeCodeProxySessionId: (_b = this.client) == null ? void 0 : _b.getProxySessionId("claude-code"),
      codexProxySessionId: (_c = this.client) == null ? void 0 : _c.getProxySessionId("codex"),
      claudeCodeProxyTaskId: (_d = this.client) == null ? void 0 : _d.getProxyTaskId("claude-code"),
      codexProxyTaskId: (_e = this.client) == null ? void 0 : _e.getProxyTaskId("codex"),
      harnessContext: (_f = this.harnessContext) != null ? _f : void 0,
      lastMode: (_g = this.lastMode) != null ? _g : void 0,
      workspace: (_i = (_h = this.harnessContext) == null ? void 0 : _h.workspace) != null ? _i : existing == null ? void 0 : existing.workspace,
      pinned: existing == null ? void 0 : existing.pinned
    };
    try {
      await saveChatSession(this.app.vault, chatHistoryFolder, file);
    } catch (e) {
      console.error("[ai-daily] persist session failed", e);
      new import_obsidian13.Notice(
        `\u5BF9\u8BDD\u5B58\u6863\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`,
        6e3
      );
    }
  }
  scrollToBottomIfFollowing() {
    if (!this.userScrolledUp) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
  buildScrollFabs(parent) {
    const group = parent.createDiv({ cls: "ai-daily-scroll-fabs" });
    this.scrollFabTopEl = group.createDiv({ cls: "ai-daily-scroll-fab ai-daily-scroll-fab--hidden" });
    (0, import_obsidian13.setIcon)(this.scrollFabTopEl, "arrow-up");
    this.scrollFabTopEl.addEventListener("click", () => {
      this.messagesEl.scrollTo({ top: 0, behavior: "smooth" });
    });
    this.scrollFabBottomEl = group.createDiv({ cls: "ai-daily-scroll-fab ai-daily-scroll-fab--hidden" });
    (0, import_obsidian13.setIcon)(this.scrollFabBottomEl, "arrow-down");
    this.scrollFabBottomEl.createDiv({ cls: "ai-daily-scroll-fab-dot" });
    this.scrollFabBottomEl.addEventListener("click", () => {
      this.userScrolledUp = false;
      this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior: "smooth" });
    });
  }
  updateScrollFabs() {
    var _a, _b;
    const el = this.messagesEl;
    const atTop = el.scrollTop < 50;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    (_a = this.scrollFabTopEl) == null ? void 0 : _a.toggleClass("ai-daily-scroll-fab--hidden", atTop);
    (_b = this.scrollFabBottomEl) == null ? void 0 : _b.toggleClass("ai-daily-scroll-fab--hidden", atBottom);
  }
  addMessage(role, content, source) {
    const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
    if (welcome) {
      welcome.remove();
    }
    this.messages.push({ role, content, source });
    this.updateMoreButtonVisibility();
    this.cachedTokenCount += estimateTextTokens(content);
    const msgEl = this.messagesEl.createDiv({
      cls: `ai-daily-msg ai-daily-msg-${role}`
    });
    if (role === "assistant") {
      void import_obsidian13.MarkdownRenderer.render(
        this.app,
        normalizeMarkdownForObsidian(content),
        msgEl,
        "",
        this.plugin
      ).then(() => {
        this.postProcessAssistantEl(msgEl);
      });
    } else {
      msgEl.setText(content);
    }
    if (role === "user") {
      this.userScrolledUp = false;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    } else {
      this.scrollToBottomIfFollowing();
    }
    this.updateTokenBar();
  }
  async fetchAndRenderProxyUndo() {
    const { proxyUrl, proxyToken } = this.plugin.settings;
    if (!proxyUrl || !proxyToken) return;
    const base = /^https?:\/\//i.test(proxyUrl) ? proxyUrl : `https://${proxyUrl}`;
    try {
      const resp = await fetch(`${base}/undo-history`, {
        headers: { Authorization: `Bearer ${proxyToken}` }
      });
      if (!resp.ok) return;
      const entries = await resp.json();
      if (entries.length === 0) return;
      this.messagesEl.querySelectorAll(".ai-daily-undo-bar-proxy").forEach((el) => el.remove());
      for (const entry of entries.slice(0, 3)) {
        const label = `${entry.operation.replace(/_/g, " ")}: ${entry.path.split("/").pop()}`;
        this.createUndoBarEl(label, entry.path, async () => {
          const r = await fetch(`${base}/undo`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${proxyToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ id: entry.id })
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || "\u64A4\u9500\u5931\u8D25");
          return `\u5DF2\u64A4\u9500: ${data.operation} ${data.path}`;
        }, void 0, "ai-daily-undo-bar-proxy");
      }
    } catch (e) {
    }
  }
  renderUndoBar() {
    this.messagesEl.querySelectorAll(".ai-daily-undo-bar").forEach((el) => el.remove());
    if (this.vaultTools) {
      const history = this.vaultTools.getUndoHistory();
      for (const entry of history.slice(-5).reverse()) {
        this.createUndoBarEl(entry.description, entry.path, async () => {
          return await this.vaultTools.undoById(entry.id) || "\u5DF2\u64A4\u9500";
        });
      }
      if (history.length > 0) return;
    }
    for (const entry of this.claudeCodeUndoHistory.slice(-5).reverse()) {
      this.createUndoBarEl(entry.description, entry.data.path, async () => {
        return await this.executeClaudeCodeUndo(entry.id);
      }, entry.data);
    }
  }
  updateToolCallsSummary(el, total, running) {
    el.empty();
    if (running > 0) {
      const iconSpan = el.createSpan({ cls: "ai-daily-tool-calls-summary-icon" });
      (0, import_obsidian13.setIcon)(iconSpan, "loader");
      el.createSpan({ text: ` ${total} \u4E2A\u5DE5\u5177\u8C03\u7528 (${running} \u8FDB\u884C\u4E2D)` });
    } else {
      const iconSpan = el.createSpan({ cls: "ai-daily-tool-calls-summary-icon ai-daily-tool-calls-summary-done" });
      (0, import_obsidian13.setIcon)(iconSpan, "check-circle");
      el.createSpan({ text: ` ${total} \u4E2A\u5DE5\u5177\u8C03\u7528\u5DF2\u5B8C\u6210` });
    }
  }
  createUndoBarEl(description, filePath, onUndo, undoData, extraCls) {
    const bar = this.messagesEl.createDiv({ cls: "ai-daily-undo-bar" + (extraCls ? ` ${extraCls}` : "") });
    const textSpan = bar.createSpan({ cls: "ai-daily-undo-text", text: description });
    textSpan.addEventListener("click", () => {
      this.app.workspace.openLinkText(filePath, "", false);
    });
    if ((undoData == null ? void 0 : undoData.previous) !== void 0 && undoData.tool !== "create_note") {
      const diffBtn = bar.createEl("button", { cls: "ai-daily-undo-diff-btn" });
      (0, import_obsidian13.setIcon)(diffBtn, "diff");
      diffBtn.setAttribute("aria-label", "\u67E5\u770B\u53D8\u66F4");
      diffBtn.setAttribute("title", "\u67E5\u770B\u53D8\u66F4");
      diffBtn.addEventListener("click", () => {
        const existingDiff = bar.querySelector(".ai-daily-undo-diff");
        if (existingDiff) {
          existingDiff.remove();
          return;
        }
        this.showDiffInBar(bar, filePath, undoData.previous);
      });
    }
    const undoBtn = bar.createEl("button", { cls: "ai-daily-undo-btn", text: "\u64A4\u9500" });
    const iconSpan = undoBtn.createSpan({ cls: "ai-daily-undo-btn-icon" });
    (0, import_obsidian13.setIcon)(iconSpan, "undo");
    undoBtn.prepend(iconSpan);
    undoBtn.addEventListener("click", async () => {
      undoBtn.disabled = true;
      undoBtn.setText("\u64A4\u9500\u4E2D...");
      try {
        const result = await onUndo();
        new import_obsidian13.Notice(result, 3e3);
      } catch (e) {
        new import_obsidian13.Notice(`\u64A4\u9500\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`, 4e3);
      }
      bar.remove();
      this.renderUndoBar();
    });
    this.scrollToBottomIfFollowing();
  }
  async showDiffInBar(bar, filePath, previous) {
    let current;
    try {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file && file instanceof import_obsidian13.TFile) {
        current = await this.app.vault.cachedRead(file);
      } else {
        const adapter = this.app.vault.adapter;
        const { join } = require("path");
        const { readFileSync } = require("fs");
        current = readFileSync(join(adapter.basePath || "", filePath), "utf-8");
      }
    } catch (e) {
      current = "(\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664)";
    }
    const diffEl = bar.createDiv({ cls: "ai-daily-undo-diff" });
    const diffHtml = simpleDiff(previous, current);
    diffEl.innerHTML = diffHtml;
    this.scrollToBottomIfFollowing();
  }
  pushClaudeCodeUndo(data) {
    const TOOL_LABELS = {
      append_to_note: "\u8FFD\u52A0\u5185\u5BB9",
      create_note: "\u521B\u5EFA\u7B14\u8BB0",
      edit_note: "\u7F16\u8F91\u7B14\u8BB0",
      rename_note: "\u91CD\u547D\u540D\u7B14\u8BB0",
      delete_note: "\u5220\u9664\u7B14\u8BB0",
      update_frontmatter: "\u66F4\u65B0\u5C5E\u6027"
    };
    const label = TOOL_LABELS[data.tool] || data.tool;
    const description = `${label}: ${data.path}`;
    this.claudeCodeUndoHistory.push({
      id: this.claudeCodeUndoCounter++,
      data,
      description
    });
    if (this.claudeCodeUndoHistory.length > 20) {
      this.claudeCodeUndoHistory.shift();
    }
  }
  async executeClaudeCodeUndo(id) {
    const idx = this.claudeCodeUndoHistory.findIndex((e) => e.id === id);
    if (idx === -1) return "\u64A4\u9500\u6761\u76EE\u4E0D\u5B58\u5728";
    const [entry] = this.claudeCodeUndoHistory.splice(idx, 1);
    const { data } = entry;
    const adapter = this.app.vault.adapter;
    const vaultPath = adapter.basePath || "";
    const { join } = require("path");
    const { writeFileSync, readFileSync, renameSync, mkdirSync } = require("fs");
    switch (data.tool) {
      case "create_note": {
        const abs = join(vaultPath, data.path);
        const trashDir = join(vaultPath, ".trash");
        try {
          mkdirSync(trashDir, { recursive: true });
        } catch (e) {
        }
        renameSync(abs, join(trashDir, data.path.split("/").pop()));
        return `\u5DF2\u64A4\u9500\u521B\u5EFA: ${data.path}`;
      }
      case "delete_note": {
        if (data.previous === void 0) return "\u65E0\u6CD5\u64A4\u9500: \u7F3A\u5C11\u539F\u59CB\u5185\u5BB9";
        const abs = join(vaultPath, data.path);
        const dir = join(vaultPath, data.path.substring(0, data.path.lastIndexOf("/")));
        try {
          mkdirSync(dir, { recursive: true });
        } catch (e) {
        }
        writeFileSync(abs, data.previous, "utf-8");
        return `\u5DF2\u6062\u590D: ${data.path}`;
      }
      case "rename_note": {
        if (!data.oldPath) return "\u65E0\u6CD5\u64A4\u9500: \u7F3A\u5C11\u539F\u8DEF\u5F84";
        const absNew = join(vaultPath, data.path);
        const absOld = join(vaultPath, data.oldPath);
        renameSync(absNew, absOld);
        return `\u5DF2\u64A4\u9500\u91CD\u547D\u540D: ${data.path} \u2192 ${data.oldPath}`;
      }
      case "append_to_note":
      case "edit_note":
      case "update_frontmatter": {
        if (data.previous === void 0) return "\u65E0\u6CD5\u64A4\u9500: \u7F3A\u5C11\u539F\u59CB\u5185\u5BB9";
        const abs = join(vaultPath, data.path);
        writeFileSync(abs, data.previous, "utf-8");
        return `\u5DF2\u6062\u590D: ${data.path}`;
      }
      default:
        return `\u4E0D\u652F\u6301\u7684\u64A4\u9500\u64CD\u4F5C: ${data.tool}`;
    }
  }
  startWithContext(context) {
    this.clearChat();
    this.harnessContext = context;
    this.updateMoreButtonVisibility();
    this.updateContextBtn();
    if (context) {
      const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
      if (welcome) welcome.remove();
      const banner = this.messagesEl.createDiv({ cls: "ai-daily-ctx-header" });
      let expanded = false;
      const row = banner.createDiv({ cls: "ai-daily-ctx-row" });
      const modeIcon = row.createDiv({ cls: "ai-daily-ctx-icon" });
      modeIcon.textContent = context.mode.emoji;
      const info = row.createDiv({ cls: "ai-daily-ctx-info" });
      info.createDiv({ cls: "ai-daily-ctx-mode", text: context.mode.label });
      if (context.workspace) {
        info.createDiv({ cls: "ai-daily-ctx-ws", text: context.workspace });
      }
      if (context.injectedFiles.length > 0) {
        const toggle = row.createSpan({
          cls: "ai-daily-ctx-toggle",
          text: `${context.injectedFiles.length} files \u2304`
        });
        toggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          expanded = !expanded;
          banner.toggleClass("ai-daily-ctx-expanded", expanded);
          toggle.textContent = expanded ? `${context.injectedFiles.length} files \u2303` : `${context.injectedFiles.length} files \u2304`;
        });
      }
      if (context.injectedFiles.length > 0) {
        const detail = banner.createDiv({ cls: "ai-daily-ctx-detail" });
        detail.createDiv({ cls: "ai-daily-ctx-detail-label", text: `\u5DF2\u6CE8\u5165 ${context.injectedFiles.length} \u4E2A\u6587\u4EF6` });
        const pills = detail.createDiv({ cls: "ai-daily-ctx-pills" });
        for (const f of context.injectedFiles) {
          const pill = pills.createSpan({ cls: "ai-daily-ctx-pill clickable" });
          const fIcon = pill.createSpan({ cls: "ai-daily-ctx-pill-icon" });
          (0, import_obsidian13.setIcon)(fIcon, "file-text");
          const displayName = f.path.replace(/^.*\//, "").replace(/\.md$/, "");
          pill.createSpan({ text: displayName });
          pill.setAttribute("title", f.path);
          pill.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this.app.workspace.openLinkText(f.path, "", false);
          });
        }
      }
      this.inputEl.focus();
    }
  }
  sendMessage(text) {
    this.inputEl.value = text;
    void this.handleSend();
  }
  sendClaudeCodeMessage(userText) {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setSendButtonState(true);
    const source = this.plugin.settings.cliBackend === "codex" ? "codex" : "claude-code";
    this.addMessage("user", userText, source);
    if (!this.sessionId) this.sessionId = newSessionId();
    if (source === "codex") {
      this.runCodexStream(userText, this.getMcpConfig(), this.codexSessionId, this.plugin.settings.codexModel);
    } else {
      this.runClaudeCodeStream(userText, this.getMcpConfig(), this.claudeCodeSessionId, this.plugin.settings.claudeCodeModel);
    }
  }
  runClaudeCodeStream(prompt, mcpConfig, sessionId, model) {
    const loadingEl = this.messagesEl.createDiv({ cls: "ai-daily-loading" });
    loadingEl.createSpan({ text: "Claude Code \u5904\u7406\u4E2D" });
    const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    let assistantEl = null;
    let streamTextEl = null;
    let accumulated = "";
    let rendered = 0;
    let typewriterTimer = null;
    let toolCallsEl = null;
    let toolCallsSummaryEl = null;
    const toolCallEls = /* @__PURE__ */ new Map();
    let toolTotal = 0;
    let toolRunning = 0;
    let thinkingEl = null;
    let thinkingContentEl = null;
    let thinkingText = "";
    const typewriterTick = () => {
      if (!streamTextEl) return;
      const buffered = accumulated.length - rendered;
      if (buffered <= 0) {
        typewriterTimer = null;
        return;
      }
      const chars = buffered > 60 ? 4 : buffered > 20 ? 2 : 1;
      const end = Math.min(rendered + chars, accumulated.length);
      streamTextEl.textContent = accumulated.slice(0, end);
      rendered = end;
      this.scrollToBottomIfFollowing();
      typewriterTimer = window.setTimeout(typewriterTick, 25);
    };
    const startTypewriter = () => {
      if (typewriterTimer !== null) return;
      if (streamTextEl) streamTextEl.addClass("ai-daily-stream-text");
      typewriterTimer = window.setTimeout(typewriterTick, 25);
    };
    const flushTypewriter = () => {
      if (typewriterTimer !== null) {
        window.clearTimeout(typewriterTimer);
        typewriterTimer = null;
      }
      if (streamTextEl && rendered < accumulated.length) {
        streamTextEl.textContent = accumulated;
        rendered = accumulated.length;
      }
      if (streamTextEl) streamTextEl.removeClass("ai-daily-stream-text");
    };
    const handle = spawnClaudeCode(prompt, { mcpConfig, sessionId, model, effort: this.plugin.settings.claudeCodeEffort }, {
      onText: (delta) => {
        if (this.closed) return;
        loadingEl.remove();
        if (!assistantEl) {
          assistantEl = this.messagesEl.createDiv({
            cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming"
          });
          streamTextEl = assistantEl.createEl("pre", {
            cls: "ai-daily-stream-text"
          });
        } else if (streamTextEl && !streamTextEl.hasClass("ai-daily-stream-text")) {
          streamTextEl.addClass("ai-daily-stream-text");
        }
        accumulated += delta;
        startTypewriter();
      },
      onToolCall: (id, name, input, status) => {
        if (this.closed) return;
        if (status === "running") {
          loadingEl.remove();
          flushTypewriter();
          if (!toolCallsEl) {
            const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
            const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
            toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
            toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
          }
          toolTotal++;
          toolRunning++;
          const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
          const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
          (0, import_obsidian13.setIcon)(iconSpan, "loader");
          el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
          toolCallEls.set(id, el);
          this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
          this.scrollToBottomIfFollowing();
        } else {
          const el = toolCallEls.get(id);
          if (el) {
            el.removeClass("ai-daily-tool-call-running");
            el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
            const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
            if (iconSpan) {
              iconSpan.empty();
              (0, import_obsidian13.setIcon)(iconSpan, status === "done" ? "check" : "x");
            }
          }
          toolRunning = Math.max(0, toolRunning - 1);
          this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
        }
      },
      onToolResult: (id, result, isError) => {
        if (this.closed) return;
        const el = toolCallEls.get(id);
        if (!el || !result) return;
        const details = el.createEl("details", { cls: "ai-daily-tool-result" });
        details.createEl("summary", { text: isError ? "\u9519\u8BEF" : "\u7ED3\u679C" });
        const pre = details.createEl("pre", { cls: "ai-daily-tool-result-content" });
        pre.createEl("code", { text: result.length > 2e3 ? result.slice(0, 2e3) + "\n\u2026(\u5DF2\u622A\u65AD)" : result });
      },
      onThinking: (text) => {
        if (this.closed) return;
        loadingEl.remove();
        thinkingText += text;
        if (!thinkingEl) {
          thinkingEl = this.messagesEl.createDiv({ cls: "ai-daily-thinking" });
          const details = thinkingEl.createEl("details", { cls: "ai-daily-thinking-details" });
          details.createEl("summary", { text: "\u{1F4AD} \u601D\u8003\u8FC7\u7A0B" });
          thinkingContentEl = details.createEl("pre", { cls: "ai-daily-thinking-content" });
        }
        if (thinkingContentEl) {
          thinkingContentEl.textContent = thinkingText;
        }
        this.scrollToBottomIfFollowing();
      },
      onUndoData: (data) => {
        this.pushClaudeCodeUndo(data);
      },
      onError: (error) => {
        if (this.closed) return;
        loadingEl.remove();
        if (typewriterTimer !== null) {
          window.clearTimeout(typewriterTimer);
          typewriterTimer = null;
        }
        if (assistantEl && accumulated) {
          assistantEl.empty();
          void import_obsidian13.MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(accumulated), assistantEl, "", this.plugin).then(() => {
            assistantEl.removeClass("ai-daily-msg-streaming");
            this.postProcessAssistantEl(assistantEl);
          });
          this.messages.push({ role: "assistant", content: accumulated, source: "claude-code" });
        } else if (assistantEl) {
          assistantEl.remove();
        }
        this.addMessage("assistant", `Claude Code \u51FA\u9519: ${error}`, "claude-code");
        this.isLoading = false;
        this.setSendButtonState(false);
        this.renderUndoBar();
      },
      onDone: (fullText) => {
        if (this.closed) return;
        loadingEl.remove();
        if (typewriterTimer !== null) {
          window.clearTimeout(typewriterTimer);
          typewriterTimer = null;
        }
        if (assistantEl) {
          assistantEl.empty();
          void import_obsidian13.MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(fullText), assistantEl, "", this.plugin).then(() => {
            assistantEl.removeClass("ai-daily-msg-streaming");
            this.postProcessAssistantEl(assistantEl);
          });
          this.messages.push({ role: "assistant", content: fullText, source: "claude-code" });
        } else if (fullText) {
          this.addMessage("assistant", fullText, "claude-code");
        }
        this.scrollToBottomIfFollowing();
        void this.persistSession();
        this.isLoading = false;
        this.setSendButtonState(false);
        this.renderUndoBar();
      },
      onSessionId: (id) => {
        this.claudeCodeSessionId = id;
        console.log("[ai-daily] Claude Code session:", id);
      }
    });
    this.claudeCodeAbort = handle.abort;
  }
  runCodexStream(prompt, mcpConfig, sessionId, model) {
    const loadingEl = this.messagesEl.createDiv({ cls: "ai-daily-loading" });
    loadingEl.createSpan({ text: "Codex \u5904\u7406\u4E2D" });
    const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    this.scrollToBottomIfFollowing();
    let assistantEl = null;
    let streamTextEl = null;
    let accumulated = "";
    let rendered = 0;
    let typewriterTimer = null;
    let toolCallsEl = null;
    let toolCallsSummaryEl = null;
    let toolTotal = 0;
    let toolRunning = 0;
    const toolCallEls = /* @__PURE__ */ new Map();
    let thinkingEl = null;
    let thinkingContentEl = null;
    let thinkingText = "";
    const startTypewriter = () => {
      if (typewriterTimer !== null) return;
      const tick = () => {
        if (!streamTextEl || rendered >= accumulated.length) {
          typewriterTimer = null;
          if (streamTextEl) streamTextEl.removeClass("ai-daily-stream-text");
          return;
        }
        const next = Math.min(rendered + 3, accumulated.length);
        streamTextEl.textContent = accumulated.slice(0, next);
        rendered = next;
        this.scrollToBottomIfFollowing();
        if (streamTextEl) streamTextEl.addClass("ai-daily-stream-text");
        typewriterTimer = window.setTimeout(tick, 25);
      };
      typewriterTimer = window.setTimeout(tick, 25);
    };
    const flushTypewriter = () => {
      if (typewriterTimer !== null) {
        window.clearTimeout(typewriterTimer);
        typewriterTimer = null;
      }
      if (streamTextEl && rendered < accumulated.length) {
        streamTextEl.textContent = accumulated;
        rendered = accumulated.length;
      }
      if (streamTextEl) streamTextEl.removeClass("ai-daily-stream-text");
    };
    const handle = spawnCodex(prompt, {
      mcpConfig,
      sessionId,
      model,
      codexPermissionMode: this.plugin.settings.codexPermissionMode,
      codexReasoningEffort: this.plugin.settings.codexReasoningEffort
    }, {
      onText: (delta) => {
        if (this.closed) return;
        loadingEl.remove();
        if (!assistantEl) {
          assistantEl = this.messagesEl.createDiv({
            cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming"
          });
          streamTextEl = assistantEl.createEl("pre", {
            cls: "ai-daily-stream-text"
          });
        } else if (streamTextEl && !streamTextEl.hasClass("ai-daily-stream-text")) {
          streamTextEl.addClass("ai-daily-stream-text");
        }
        accumulated += delta;
        startTypewriter();
      },
      onToolCall: (id, name, input, status) => {
        if (this.closed) return;
        if (status === "running") {
          loadingEl.remove();
          flushTypewriter();
          if (!toolCallsEl) {
            const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
            const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
            toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
            toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
          }
          toolTotal++;
          toolRunning++;
          const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
          const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
          (0, import_obsidian13.setIcon)(iconSpan, "loader");
          el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
          toolCallEls.set(id, el);
          this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
          this.scrollToBottomIfFollowing();
        } else {
          const el = toolCallEls.get(id);
          if (el) {
            el.removeClass("ai-daily-tool-call-running");
            el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
            const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
            if (iconSpan) {
              iconSpan.empty();
              (0, import_obsidian13.setIcon)(iconSpan, status === "done" ? "check" : "x");
            }
          }
          toolRunning = Math.max(0, toolRunning - 1);
          this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
        }
      },
      onToolResult: (id, result, isError) => {
        if (this.closed) return;
        const el = toolCallEls.get(id);
        if (!el || !result) return;
        const details = el.createEl("details", { cls: "ai-daily-tool-result" });
        details.createEl("summary", { text: isError ? "\u9519\u8BEF" : "\u7ED3\u679C" });
        const pre = details.createEl("pre", { cls: "ai-daily-tool-result-content" });
        pre.createEl("code", { text: result.length > 2e3 ? result.slice(0, 2e3) + "\n\u2026(\u5DF2\u622A\u65AD)" : result });
      },
      onThinking: (text) => {
        if (this.closed) return;
        loadingEl.remove();
        thinkingText += text;
        if (!thinkingEl) {
          thinkingEl = this.messagesEl.createDiv({ cls: "ai-daily-thinking" });
          const details = thinkingEl.createEl("details", { cls: "ai-daily-thinking-details" });
          details.createEl("summary", { text: "\u{1F4AD} \u601D\u8003\u8FC7\u7A0B" });
          thinkingContentEl = details.createEl("pre", { cls: "ai-daily-thinking-content" });
        }
        if (thinkingContentEl) {
          thinkingContentEl.textContent = thinkingText;
        }
        this.scrollToBottomIfFollowing();
      },
      onError: (error) => {
        if (this.closed) return;
        loadingEl.remove();
        if (typewriterTimer !== null) {
          window.clearTimeout(typewriterTimer);
          typewriterTimer = null;
        }
        if (assistantEl && accumulated) {
          assistantEl.empty();
          void import_obsidian13.MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(accumulated), assistantEl, "", this.plugin).then(() => {
            assistantEl.removeClass("ai-daily-msg-streaming");
            this.postProcessAssistantEl(assistantEl);
          });
          this.messages.push({ role: "assistant", content: accumulated, source: "codex" });
        } else if (assistantEl) {
          assistantEl.remove();
        }
        this.addMessage("assistant", `Codex \u51FA\u9519: ${error}`, "codex");
        this.isLoading = false;
        this.setSendButtonState(false);
      },
      onDone: (fullText) => {
        if (this.closed) return;
        loadingEl.remove();
        if (typewriterTimer !== null) {
          window.clearTimeout(typewriterTimer);
          typewriterTimer = null;
        }
        if (assistantEl) {
          assistantEl.empty();
          void import_obsidian13.MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(fullText), assistantEl, "", this.plugin).then(() => {
            assistantEl.removeClass("ai-daily-msg-streaming");
            this.postProcessAssistantEl(assistantEl);
          });
          this.messages.push({ role: "assistant", content: fullText, source: "codex" });
        } else if (fullText) {
          this.addMessage("assistant", fullText, "codex");
        }
        this.scrollToBottomIfFollowing();
        void this.persistSession();
        this.isLoading = false;
        this.setSendButtonState(false);
      },
      onSessionId: (id) => {
        this.codexSessionId = id;
        console.log("[ai-daily] Codex session:", id);
      }
    });
    this.codexAbort = handle.abort;
  }
  async handleDistillAsMessage() {
    if (this.messages.length < 2) {
      new import_obsidian13.Notice("\u5F53\u524D\u5BF9\u8BDD\u5185\u5BB9\u592A\u5C11\uFF0C\u65E0\u6CD5\u84B8\u998F", 3e3);
      return;
    }
    if (this.isLoading) {
      new import_obsidian13.Notice("\u8BF7\u7B49\u5F85\u5F53\u524D\u64CD\u4F5C\u5B8C\u6210", 2e3);
      return;
    }
    if (!this.plugin.getEffectiveApiKey()) {
      new import_obsidian13.Notice("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E API Key", 3e3);
      return;
    }
    this.isLoading = true;
    this.setSendButtonState(true);
    this.addMessage("user", "/distill");
    if (!this.sessionId) {
      this.sessionId = newSessionId();
    }
    const loadingEl = this.messagesEl.createDiv({ cls: "ai-daily-loading" });
    loadingEl.createSpan({ text: "\u84B8\u998F\u4E2D" });
    const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    const useStream = this.plugin.settings.chatStreamMode !== "off";
    let assistantEl = null;
    let streamingRenderTimer = null;
    let latestStreamingMarkdown = "";
    let streamingRenderQueue = Promise.resolve();
    const renderStreamingMarkdown = async (content) => {
      if (!assistantEl) return;
      assistantEl.empty();
      await import_obsidian13.MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(content), assistantEl, "", this.plugin);
      this.scrollToBottomIfFollowing();
    };
    const scheduleStreamingMarkdown = (content) => {
      latestStreamingMarkdown = content;
      if (streamingRenderTimer !== null) return;
      streamingRenderTimer = window.setTimeout(() => {
        streamingRenderTimer = null;
        const snapshot = latestStreamingMarkdown;
        streamingRenderQueue = streamingRenderQueue.then(
          () => renderStreamingMarkdown(snapshot)
        );
      }, STREAM_MARKDOWN_RENDER_INTERVAL_MS);
    };
    const flushStreamingMarkdown = async (content) => {
      latestStreamingMarkdown = content;
      if (streamingRenderTimer !== null) {
        window.clearTimeout(streamingRenderTimer);
        streamingRenderTimer = null;
      }
      await streamingRenderQueue;
      await renderStreamingMarkdown(content);
    };
    const cancelStreamingMarkdown = () => {
      if (streamingRenderTimer !== null) {
        window.clearTimeout(streamingRenderTimer);
        streamingRenderTimer = null;
      }
    };
    try {
      const { systemPrompt, userMessage } = await prepareDistillation(
        this.app,
        this.messages,
        {
          knowledgeFolders: this.plugin.settings.knowledgeFolders,
          targetFolder: this.plugin.settings.distillTargetFolder
        }
      );
      const distillClient = new ClaudeClient(
        this.plugin.getEffectiveApiKey(),
        this.plugin.settings.model,
        systemPrompt,
        { streamMode: this.plugin.settings.chatStreamMode, enableWebSearch: false }
      );
      const vaultTools = new VaultTools(this.app, this.plugin.settings.knowledgeFolders);
      let toolCallsEl = null;
      let toolCallsSummaryEl = null;
      const toolCallEls = /* @__PURE__ */ new Map();
      let toolCallCounter = 0;
      let toolTotal = 0;
      let toolRunning = 0;
      const onToolCall = (name, input, status) => {
        if (status === "start") {
          loadingEl.remove();
          if (!toolCallsEl) {
            const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
            const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
            toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
            toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
          }
          toolTotal++;
          toolRunning++;
          const key = `${name}-${toolCallCounter++}`;
          const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
          const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
          (0, import_obsidian13.setIcon)(iconSpan, "loader");
          el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
          toolCallEls.set(key, el);
          this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
          this.scrollToBottomIfFollowing();
        } else {
          const lastKey = `${name}-${toolCallCounter - 1}`;
          const el = toolCallEls.get(lastKey);
          if (el) {
            el.removeClass("ai-daily-tool-call-running");
            el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
            const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
            if (iconSpan) {
              iconSpan.empty();
              (0, import_obsidian13.setIcon)(iconSpan, status === "done" ? "check" : "x");
            }
            toolRunning--;
            this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
          }
        }
      };
      const reply = await distillClient.chat(
        userMessage,
        (name, input) => vaultTools.execute(name, input),
        useStream ? (_delta, accumulated) => {
          loadingEl.remove();
          if (!assistantEl) {
            assistantEl = this.messagesEl.createDiv({
              cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming"
            });
          }
          scheduleStreamingMarkdown(accumulated);
        } : void 0,
        void 0,
        onToolCall
      );
      loadingEl.remove();
      if (useStream && assistantEl) {
        await flushStreamingMarkdown(reply || "*(\u5DF2\u505C\u6B62)*");
        this.postProcessAssistantEl(assistantEl);
        assistantEl.removeClass("ai-daily-msg-streaming");
        this.messages.push({ role: "assistant", content: reply || "*(\u5DF2\u505C\u6B62)*", source: "api" });
      } else if (reply) {
        this.addMessage("assistant", reply, "api");
      }
      this.scrollToBottomIfFollowing();
      await this.persistSession();
      new import_obsidian13.Notice("\u77E5\u8BC6\u84B8\u998F\u5B8C\u6210", 3e3);
    } catch (e) {
      cancelStreamingMarkdown();
      loadingEl.remove();
      if (assistantEl && latestStreamingMarkdown) {
        assistantEl.removeClass("ai-daily-msg-streaming");
        this.messages.push({ role: "assistant", content: latestStreamingMarkdown });
      } else if (assistantEl) {
        assistantEl.remove();
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.addMessage("assistant", `\u84B8\u998F\u5931\u8D25: ${msg}`);
    } finally {
      this.isLoading = false;
      this.setSendButtonState(false);
    }
  }
  async handleDistill() {
    if (this.messages.length < 2) {
      new import_obsidian13.Notice("\u5F53\u524D\u5BF9\u8BDD\u5185\u5BB9\u592A\u5C11\uFF0C\u65E0\u6CD5\u84B8\u998F", 3e3);
      return;
    }
    if (this.isLoading) {
      new import_obsidian13.Notice("\u8BF7\u7B49\u5F85\u5F53\u524D\u64CD\u4F5C\u5B8C\u6210", 2e3);
      return;
    }
    if (!this.plugin.getEffectiveApiKey()) {
      new import_obsidian13.Notice("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E API Key", 3e3);
      return;
    }
    this.isLoading = true;
    const notice = new import_obsidian13.Notice("\u6B63\u5728\u84B8\u998F\u5BF9\u8BDD\u77E5\u8BC6...", 0);
    try {
      const result = await distillConversation(this.app, this.messages, {
        apiKey: this.plugin.getEffectiveApiKey(),
        model: this.plugin.settings.model,
        knowledgeFolders: this.plugin.settings.knowledgeFolders,
        targetFolder: this.plugin.settings.distillTargetFolder
      });
      notice.hide();
      this.addMessage("assistant", result);
      await this.persistSession();
      new import_obsidian13.Notice("\u77E5\u8BC6\u84B8\u998F\u5B8C\u6210", 3e3);
    } catch (e) {
      notice.hide();
      const msg = e instanceof Error ? e.message : String(e);
      new import_obsidian13.Notice(`\u84B8\u998F\u5931\u8D25: ${msg}`, 5e3);
    } finally {
      this.isLoading = false;
    }
  }
  addHealthCheckReport(report, fixableResult) {
    this.addMessage("assistant", report);
    if (fixableResult) {
      const bar = this.messagesEl.createDiv({ cls: "ai-daily-health-fix-bar" });
      const btn = bar.createEl("button", {
        cls: "ai-daily-health-fix-btn",
        text: "\u4E00\u952E\u4FEE\u590D"
      });
      (0, import_obsidian13.setIcon)(btn.createSpan({ cls: "ai-daily-health-fix-icon" }), "wrench");
      btn.addEventListener("click", () => {
        bar.remove();
        this.handleHealthFix(fixableResult);
      });
    }
  }
  async handleHealthFix(result) {
    if (this.isLoading) {
      new import_obsidian13.Notice("\u8BF7\u7B49\u5F85\u5F53\u524D\u64CD\u4F5C\u5B8C\u6210", 2e3);
      return;
    }
    if (!this.plugin.getEffectiveApiKey()) {
      new import_obsidian13.Notice("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E API Key", 3e3);
      return;
    }
    this.isLoading = true;
    this.setSendButtonState(true);
    this.addMessage("user", "\u4FEE\u590D\u77E5\u8BC6\u5E93\u95EE\u9898");
    if (!this.sessionId) {
      this.sessionId = newSessionId();
    }
    const loadingEl = this.messagesEl.createDiv({ cls: "ai-daily-loading" });
    loadingEl.createSpan({ text: "\u4FEE\u590D\u4E2D" });
    const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    dotsEl.createEl("span");
    const useStream = this.plugin.settings.chatStreamMode !== "off";
    let assistantEl = null;
    let streamingRenderTimer = null;
    let latestStreamingMarkdown = "";
    let streamingRenderQueue = Promise.resolve();
    const renderStreamingMarkdown = async (content) => {
      if (!assistantEl) return;
      assistantEl.empty();
      await import_obsidian13.MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(content), assistantEl, "", this.plugin);
      this.scrollToBottomIfFollowing();
    };
    const scheduleStreamingMarkdown = (content) => {
      latestStreamingMarkdown = content;
      if (streamingRenderTimer !== null) return;
      streamingRenderTimer = window.setTimeout(() => {
        streamingRenderTimer = null;
        const snapshot = latestStreamingMarkdown;
        streamingRenderQueue = streamingRenderQueue.then(
          () => renderStreamingMarkdown(snapshot)
        );
      }, STREAM_MARKDOWN_RENDER_INTERVAL_MS);
    };
    const flushStreamingMarkdown = async (content) => {
      latestStreamingMarkdown = content;
      if (streamingRenderTimer !== null) {
        window.clearTimeout(streamingRenderTimer);
        streamingRenderTimer = null;
      }
      await streamingRenderQueue;
      await renderStreamingMarkdown(content);
    };
    const cancelStreamingMarkdown = () => {
      if (streamingRenderTimer !== null) {
        window.clearTimeout(streamingRenderTimer);
        streamingRenderTimer = null;
      }
    };
    try {
      const { systemPrompt, userMessage } = prepareHealthFix(
        result,
        this.plugin.settings.knowledgeFolders
      );
      const fixClient = new ClaudeClient(
        this.plugin.getEffectiveApiKey(),
        this.plugin.settings.model,
        systemPrompt,
        { streamMode: this.plugin.settings.chatStreamMode, enableWebSearch: false }
      );
      const vaultTools = new VaultTools(this.app, this.plugin.settings.knowledgeFolders);
      let toolCallsEl = null;
      let toolCallsSummaryEl = null;
      const toolCallEls = /* @__PURE__ */ new Map();
      let toolCallCounter = 0;
      let toolTotal = 0;
      let toolRunning = 0;
      const onToolCall = (name, input, status) => {
        if (status === "start") {
          loadingEl.remove();
          if (!toolCallsEl) {
            const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
            const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
            toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
            toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
          }
          toolTotal++;
          toolRunning++;
          const key = `${name}-${toolCallCounter++}`;
          const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
          const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
          (0, import_obsidian13.setIcon)(iconSpan, "loader");
          el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
          toolCallEls.set(key, el);
          this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
          this.scrollToBottomIfFollowing();
        } else {
          const lastKey = `${name}-${toolCallCounter - 1}`;
          const el = toolCallEls.get(lastKey);
          if (el) {
            el.removeClass("ai-daily-tool-call-running");
            el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
            const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
            if (iconSpan) {
              iconSpan.empty();
              (0, import_obsidian13.setIcon)(iconSpan, status === "done" ? "check" : "x");
            }
            toolRunning--;
            this.updateToolCallsSummary(toolCallsSummaryEl, toolTotal, toolRunning);
          }
        }
      };
      const reply = await fixClient.chat(
        userMessage,
        (name, input) => vaultTools.execute(name, input),
        useStream ? (_delta, accumulated) => {
          loadingEl.remove();
          if (!assistantEl) {
            assistantEl = this.messagesEl.createDiv({
              cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming"
            });
          }
          scheduleStreamingMarkdown(accumulated);
        } : void 0,
        void 0,
        onToolCall
      );
      loadingEl.remove();
      if (useStream && assistantEl) {
        await flushStreamingMarkdown(reply || "*(\u4FEE\u590D\u5B8C\u6210)*");
        this.postProcessAssistantEl(assistantEl);
        assistantEl.removeClass("ai-daily-msg-streaming");
        this.messages.push({ role: "assistant", content: reply || "*(\u4FEE\u590D\u5B8C\u6210)*", source: "api" });
      } else if (reply) {
        this.addMessage("assistant", reply, "api");
      }
      this.renderUndoBar();
      this.scrollToBottomIfFollowing();
      await this.persistSession();
      new import_obsidian13.Notice("\u77E5\u8BC6\u5E93\u4FEE\u590D\u5B8C\u6210", 3e3);
    } catch (e) {
      cancelStreamingMarkdown();
      loadingEl.remove();
      if (assistantEl && latestStreamingMarkdown) {
        assistantEl.removeClass("ai-daily-msg-streaming");
        this.messages.push({ role: "assistant", content: latestStreamingMarkdown });
      } else if (assistantEl) {
        assistantEl.remove();
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.addMessage("assistant", `\u4FEE\u590D\u5931\u8D25: ${msg}`);
    } finally {
      this.isLoading = false;
      this.setSendButtonState(false);
    }
  }
  async forkAtMessage(assistantMsgIdx) {
    var _a;
    if (this.isLoading) return;
    if (assistantMsgIdx < 1) return;
    const assistantMsg = this.messages[assistantMsgIdx];
    const userMsg = this.messages[assistantMsgIdx - 1];
    if ((assistantMsg == null ? void 0 : assistantMsg.role) !== "assistant" || (userMsg == null ? void 0 : userMsg.role) !== "user") return;
    const removedCount = this.messages.length - (assistantMsgIdx - 1);
    const rewoundUserText = userMsg.content;
    this.messages.splice(assistantMsgIdx - 1);
    (_a = this.client) == null ? void 0 : _a.clearProxySessionId();
    this.claudeCodeSessionId = void 0;
    this.codexSessionId = void 0;
    if (this.client) {
      const keepCount = this.messages.filter((m) => m.source === "api" || m.source === "proxy").length;
      while (this.client.getMessagesSnapshot().length > keepCount) {
        if (!this.client.rewindLastTurn()) break;
      }
    }
    const msgEls = this.messagesEl.querySelectorAll(".ai-daily-msg");
    const allEls = Array.from(this.messagesEl.children);
    const remainingMsgCount = this.messages.length;
    if (msgEls.length > remainingMsgCount) {
      const firstToRemove = msgEls[remainingMsgCount];
      const startIdx = allEls.indexOf(firstToRemove);
      if (startIdx >= 0) {
        for (let i = allEls.length - 1; i >= startIdx; i--) {
          allEls[i].remove();
        }
      }
    }
    this.cachedTokenCount = this.messages.reduce(
      (sum, m) => sum + estimateTextTokens(m.content),
      0
    );
    this.updateTokenBar();
    this.updateForkButtons();
    this.inputEl.value = rewoundUserText;
    this.inputEl.focus();
    await this.persistSession();
    const turnsRemoved = Math.floor(removedCount / 2);
    new import_obsidian13.Notice(`\u5DF2\u5206\u53C9\uFF0C\u79FB\u9664 ${turnsRemoved} \u8F6E\u5BF9\u8BDD\uFF0C\u4E0B\u6B21\u53D1\u9001\u5C06\u521B\u5EFA\u65B0\u4F1A\u8BDD`, 3e3);
  }
  async saveSessionAsNote() {
    var _a;
    if (!this.sessionId || this.messages.length === 0) return;
    const lines = [];
    for (const m of this.messages) {
      lines.push(m.role === "user" ? `**User:**
${m.content}` : `**Assistant:**
${m.content}`);
      lines.push("");
    }
    const content = lines.join("\n");
    const title = titleFromMessages(this.messages.map((m) => ({ role: m.role, content: m.content })));
    const ws = (_a = this.harnessContext) == null ? void 0 : _a.workspace;
    const folder = ws ? `${this.plugin.settings.harnessProjectsFolder}/${ws}` : this.plugin.settings.knowledgeFolders[0] || "Raw";
    const fileName = `${folder}/${title}.md`;
    try {
      const existing = this.app.vault.getAbstractFileByPath(fileName);
      if (existing) {
        new import_obsidian13.Notice(`\u7B14\u8BB0\u5DF2\u5B58\u5728: ${fileName}`, 3e3);
        return;
      }
      await this.app.vault.create(fileName, content);
      new import_obsidian13.Notice(`\u5DF2\u4FDD\u5B58\u4E3A\u7B14\u8BB0: ${fileName}`, 3e3);
    } catch (e) {
      new import_obsidian13.Notice(`\u4FDD\u5B58\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`, 5e3);
    }
  }
  copySessionText() {
    if (this.messages.length === 0) return;
    const lines = [];
    for (const m of this.messages) {
      lines.push(m.role === "user" ? `**User:**
${m.content}` : `**Assistant:**
${m.content}`);
      lines.push("");
    }
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      new import_obsidian13.Notice("\u5DF2\u590D\u5236\u5168\u6587", 2e3);
    });
  }
  renameCurrentSession() {
    if (!this.sessionId) return;
    const currentTitle = titleFromMessages(this.messages.map((m) => ({ role: m.role, content: m.content })));
    const modal = new RenameModal(this.app, currentTitle, async (newTitle) => {
      if (!this.sessionId) return;
      await renameSession(
        this.app.vault,
        this.plugin.settings.chatHistoryFolder,
        this.sessionId,
        newTitle
      );
      new import_obsidian13.Notice(`\u5DF2\u91CD\u547D\u540D\u4E3A\u300C${newTitle}\u300D`, 2e3);
    });
    modal.open();
  }
  async togglePinCurrentSession() {
    if (!this.sessionId) return;
    const pinned = await togglePinSession(
      this.app.vault,
      this.plugin.settings.chatHistoryFolder,
      this.sessionId
    );
    new import_obsidian13.Notice(pinned ? "\u5DF2\u7F6E\u9876" : "\u5DF2\u53D6\u6D88\u7F6E\u9876", 2e3);
  }
  deleteCurrentSession() {
    if (!this.sessionId) return;
    const title = titleFromMessages(this.messages.map((m) => ({ role: m.role, content: m.content })));
    new ConfirmModal(
      this.app,
      `\u786E\u5B9A\u5220\u9664\u5BF9\u8BDD\u300C${title}\u300D\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`,
      async () => {
        if (!this.sessionId) return;
        await deleteChatSessionFile(
          this.app.vault,
          this.plugin.settings.chatHistoryFolder,
          this.sessionId
        );
        this.clearChat();
        new import_obsidian13.Notice("\u5BF9\u8BDD\u5DF2\u5220\u9664", 2e3);
      }
    ).open();
  }
  clearChat() {
    var _a;
    (_a = this.client) == null ? void 0 : _a.abort();
    this.sessionId = null;
    this.messages = [];
    this.cachedTokenCount = 0;
    this.client = null;
    this.vaultTools = null;
    this.harnessContext = null;
    this.claudeCodeSessionId = void 0;
    this.codexSessionId = void 0;
    this.claudeCodeUndoHistory = [];
    this.restoredProxySessionIds = {};
    this.restoredProxyTaskIds = {};
    this.lastMode = null;
    this.attachedFiles = [];
    this.pendingImages = [];
    this.renderAttachBar();
    this.messagesEl.empty();
    this.showWelcome();
    this.updateMoreButtonVisibility();
    this.updateContextBtn();
    this.updateSendBtnActive();
  }
  updateHistoryOverlayInset() {
    var _a, _b, _c, _d, _e, _f;
    if (!this.historyOverlay || !this.chatContainerEl) return;
    const topInset = (_b = (_a = this.headerEl) == null ? void 0 : _a.offsetHeight) != null ? _b : 0;
    const bottomInset = ((_d = (_c = this.tokenBarEl) == null ? void 0 : _c.offsetHeight) != null ? _d : 0) + ((_f = (_e = this.inputAreaEl) == null ? void 0 : _e.offsetHeight) != null ? _f : 0);
    this.historyOverlay.setAttribute(
      "style",
      `inset:${topInset}px 0 ${bottomInset}px 0;`
    );
  }
  closeHistoryOverlay() {
    if (this.historyOverlay) {
      this.historyOverlay.remove();
      this.historyOverlay = null;
    }
    if (this.historyOverlayResizeCleanup) {
      this.historyOverlayResizeCleanup();
      this.historyOverlayResizeCleanup = null;
    }
  }
  getWorkspaceColor(ws) {
    if (this.workspaceColorMap.has(ws)) return this.workspaceColorMap.get(ws);
    const idx = this.workspaceColorMap.size % _ChatView.WORKSPACE_COLORS.length;
    const color = _ChatView.WORKSPACE_COLORS[idx];
    this.workspaceColorMap.set(ws, color);
    return color;
  }
  formatHistoryTime(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const now = /* @__PURE__ */ new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 6e4);
    if (diffMins < 60) return `${diffMins} \u5206\u949F\u524D`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24 && d.getDate() === now.getDate()) {
      const h = d.getHours();
      const m = d.getMinutes().toString().padStart(2, "0");
      const period = h >= 12 ? "\u4E0B\u5348" : "\u4E0A\u5348";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${period} ${h12.toString().padStart(2, "0")}:${m}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) {
      return "\u6628\u5929";
    }
    const diffDays = Math.floor(diffMs / 864e5);
    if (diffDays < 7) return `${diffDays} \u5929\u524D`;
    return `${d.getMonth() + 1}\u6708${d.getDate()}\u65E5`;
  }
  getTimeGroup(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "\u66F4\u65E9";
    const now = /* @__PURE__ */ new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d >= todayStart) return "\u4ECA\u5929";
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    if (d >= yesterdayStart) return "\u6628\u5929";
    const weekAgo = new Date(todayStart);
    weekAgo.setDate(weekAgo.getDate() - 7);
    if (d >= weekAgo) return "\u672C\u5468";
    return "\u66F4\u65E9";
  }
  async openHistoryPanel() {
    var _a, _b;
    if (this.historyOverlay) {
      this.closeHistoryOverlay();
      return;
    }
    const { chatHistoryFolder } = this.plugin.settings;
    let sessions = await listChatSessions(this.app.vault, chatHistoryFolder);
    const overlay = this.chatContainerEl.createDiv({
      cls: "ai-daily-history-overlay"
    });
    this.historyOverlay = overlay;
    this.updateHistoryOverlayInset();
    const onViewportResize = () => this.updateHistoryOverlayInset();
    window.addEventListener("resize", onViewportResize);
    (_a = window.visualViewport) == null ? void 0 : _a.addEventListener("resize", onViewportResize);
    (_b = window.visualViewport) == null ? void 0 : _b.addEventListener("scroll", onViewportResize);
    this.historyOverlayResizeCleanup = () => {
      var _a2, _b2;
      window.removeEventListener("resize", onViewportResize);
      (_a2 = window.visualViewport) == null ? void 0 : _a2.removeEventListener("resize", onViewportResize);
      (_b2 = window.visualViewport) == null ? void 0 : _b2.removeEventListener("scroll", onViewportResize);
    };
    const head = overlay.createDiv({ cls: "ai-daily-history-head" });
    const backBtn = head.createDiv({ cls: "ai-daily-history-back" });
    (0, import_obsidian13.setIcon)(backBtn, "chevron-left");
    backBtn.addEventListener("click", () => this.closeHistoryOverlay());
    head.createEl("span", { text: "\u5386\u53F2", cls: "ai-daily-history-title" });
    const headActions = head.createDiv({ cls: "ai-daily-history-head-actions" });
    const clearAllBtn = headActions.createSpan({ cls: "ai-daily-history-clear-all" });
    (0, import_obsidian13.setIcon)(clearAllBtn, "trash-2");
    clearAllBtn.setAttribute("title", "\u6E05\u7A7A\u5168\u90E8");
    clearAllBtn.addEventListener("click", () => {
      if (sessions.length === 0) return;
      new ConfirmModal(
        this.app,
        `\u786E\u5B9A\u5220\u9664\u5168\u90E8 ${sessions.length} \u6761\u5386\u53F2\u5BF9\u8BDD\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`,
        async () => {
          for (const s of sessions) {
            await deleteChatSessionFile(this.app.vault, chatHistoryFolder, s.id);
          }
          if (this.sessionId && sessions.some((s) => s.id === this.sessionId)) {
            this.clearChat();
          }
          sessions = [];
          renderList([]);
          new import_obsidian13.Notice("\u5DF2\u6E05\u7A7A\u6240\u6709\u5386\u53F2\u5BF9\u8BDD", 3e3);
        }
      ).open();
    });
    const searchWrap = overlay.createDiv({ cls: "ai-daily-history-search-wrap" });
    const searchIcon = searchWrap.createSpan({ cls: "ai-daily-history-search-icon" });
    (0, import_obsidian13.setIcon)(searchIcon, "search");
    const search = searchWrap.createEl("input", {
      cls: "ai-daily-history-search",
      type: "search",
      attr: { placeholder: "\u641C\u7D22\u5386\u53F2\u5BF9\u8BDD..." }
    });
    let groupByMode = false;
    const toggleWrap = overlay.createDiv({ cls: "ai-daily-history-toggle-wrap" });
    toggleWrap.createSpan({ cls: "ai-daily-history-toggle-label", text: "\u5206\u7EC4" });
    const toggleGroup = toggleWrap.createDiv({ cls: "ai-daily-history-toggle-group" });
    const btnTime = toggleGroup.createSpan({ cls: "ai-daily-history-toggle-btn is-active", text: "\u65F6\u95F4" });
    const btnMode = toggleGroup.createSpan({ cls: "ai-daily-history-toggle-btn", text: "\u6A21\u5F0F" });
    const setGroupMode = (byMode) => {
      groupByMode = byMode;
      btnTime.toggleClass("is-active", !byMode);
      btnMode.toggleClass("is-active", byMode);
      const q = search.value.trim().toLowerCase();
      const filtered = q ? sessions.filter((s) => matchSession(s, q)) : sessions;
      renderList(filtered);
    };
    btnTime.addEventListener("click", () => setGroupMode(false));
    btnMode.addEventListener("click", () => setGroupMode(true));
    const listEl = overlay.createDiv({ cls: "ai-daily-history-list" });
    const renderList = (items) => {
      var _a2, _b2, _c, _d, _e;
      listEl.empty();
      if (items.length === 0) {
        listEl.createDiv({ cls: "ai-daily-history-empty", text: "\u6682\u65E0\u5386\u53F2\u4F1A\u8BDD" });
        return;
      }
      const pinned = items.filter((s) => s.pinned);
      const unpinned = items.filter((s) => !s.pinned);
      if (pinned.length > 0) {
        renderGroup("\u7F6E\u9876", pinned, true);
      }
      if (groupByMode) {
        const modeGroups = /* @__PURE__ */ new Map();
        for (const s of unpinned) {
          const mode = (_a2 = s.harnessContext) == null ? void 0 : _a2.mode;
          const key = (_b2 = mode == null ? void 0 : mode.id) != null ? _b2 : "__free__";
          const existing = modeGroups.get(key);
          if (existing) {
            existing.items.push(s);
          } else {
            modeGroups.set(key, {
              emoji: (_c = mode == null ? void 0 : mode.emoji) != null ? _c : "\u{1F4AC}",
              label: (_d = mode == null ? void 0 : mode.label) != null ? _d : "\u81EA\u7531\u5BF9\u8BDD",
              items: [s]
            });
          }
        }
        for (const [, group] of modeGroups) {
          renderModeGroup(group.emoji, group.label, group.items);
        }
      } else {
        const timeGroups = /* @__PURE__ */ new Map();
        const groupOrder = ["\u4ECA\u5929", "\u6628\u5929", "\u672C\u5468", "\u66F4\u65E9"];
        for (const s of unpinned) {
          const g = this.getTimeGroup(s.updated);
          const arr = (_e = timeGroups.get(g)) != null ? _e : [];
          arr.push(s);
          timeGroups.set(g, arr);
        }
        for (const g of groupOrder) {
          const arr = timeGroups.get(g);
          if (arr && arr.length > 0) renderGroup(g, arr, false);
        }
      }
    };
    const renderGroup = (label, items, isPinned) => {
      const groupEl = listEl.createDiv({ cls: "ai-daily-history-group" });
      groupEl.createDiv({ cls: "ai-daily-history-group-label", text: label });
      for (const s of items) renderSession(s, groupEl, isPinned);
    };
    const renderModeGroup = (emoji, label, items) => {
      const groupEl = listEl.createDiv({ cls: "ai-daily-history-group" });
      const header = groupEl.createDiv({ cls: "ai-daily-history-mode-header" });
      header.createSpan({ cls: "ai-daily-history-mode-emoji", text: emoji });
      header.createSpan({ cls: "ai-daily-history-mode-label", text: label });
      header.createSpan({ cls: "ai-daily-history-mode-count", text: String(items.length) });
      for (const s of items) renderSession(s, groupEl, false);
    };
    const renderSession = (s, parent, isPinned) => {
      var _a2, _b2, _c;
      const ws = s.workspace || ((_a2 = s.harnessContext) == null ? void 0 : _a2.workspace) || "";
      const color = ws ? this.getWorkspaceColor(ws) : "var(--text-faint)";
      const row = parent.createDiv({
        cls: `ai-daily-history-row${isPinned ? " ai-daily-history-row--pinned" : ""}`
      });
      const dot = row.createSpan({ cls: "ai-daily-history-row-dot" });
      dot.style.background = color;
      if (isPinned) {
        dot.style.background = "var(--interactive-accent)";
        const pinIcon = row.createSpan({ cls: "ai-daily-history-row-pin-icon" });
        (0, import_obsidian13.setIcon)(pinIcon, "pin");
      }
      const info = row.createDiv({ cls: "ai-daily-history-row-info" });
      info.createDiv({
        cls: "ai-daily-history-row-title",
        text: s.title || s.id
      });
      const metaParts = [ws, this.formatHistoryTime(s.updated)].filter(Boolean).join(" \xB7 ");
      info.createDiv({
        cls: "ai-daily-history-row-meta",
        text: metaParts
      });
      const modeLabel = (_c = (_b2 = s.harnessContext) == null ? void 0 : _b2.mode) == null ? void 0 : _c.label;
      if (modeLabel) {
        const chip = row.createSpan({ cls: "ai-daily-history-row-chip" });
        chip.textContent = modeLabel;
      }
      const delBtn = row.createSpan({ cls: "ai-daily-history-row-delete" });
      (0, import_obsidian13.setIcon)(delBtn, "x");
      delBtn.setAttribute("title", "\u5220\u9664\u6B64\u5BF9\u8BDD");
      const confirmDelete = () => {
        new ConfirmModal(
          this.app,
          `\u786E\u5B9A\u5220\u9664\u5BF9\u8BDD\u300C${s.title || s.id}\u300D\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`,
          async () => {
            await deleteChatSessionFile(this.app.vault, chatHistoryFolder, s.id);
            sessions = sessions.filter((x) => x.id !== s.id);
            if (this.sessionId === s.id) this.clearChat();
            const q = search.value.trim().toLowerCase();
            renderList(q ? sessions.filter((x) => matchSession(x, q)) : sessions);
            new import_obsidian13.Notice("\u5DF2\u5220\u9664\u5BF9\u8BDD", 2e3);
          }
        ).open();
      };
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        confirmDelete();
      });
      let longPressTimer = null;
      let longPressed = false;
      row.addEventListener("touchstart", (ev) => {
        longPressed = false;
        longPressTimer = setTimeout(() => {
          longPressed = true;
          row.addClass("ai-daily-history-row--show-delete");
          const dismiss = (e) => {
            if (!row.contains(e.target) || e.target === row || info.contains(e.target)) {
              row.removeClass("ai-daily-history-row--show-delete");
            }
            document.removeEventListener("touchstart", dismiss, true);
          };
          setTimeout(() => document.addEventListener("touchstart", dismiss, true), 50);
        }, 500);
      }, { passive: true });
      row.addEventListener("touchend", () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
      row.addEventListener("touchmove", () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
      row.addEventListener("click", () => {
        if (longPressed) {
          longPressed = false;
          return;
        }
        void this.loadSession(s.id);
        this.closeHistoryOverlay();
      });
    };
    const matchSession = (s, q) => {
      var _a2, _b2;
      if (s.title.toLowerCase().includes(q)) return true;
      if (s.id.toLowerCase().includes(q)) return true;
      if ((s.workspace || "").toLowerCase().includes(q)) return true;
      if ((((_b2 = (_a2 = s.harnessContext) == null ? void 0 : _a2.mode) == null ? void 0 : _b2.label) || "").toLowerCase().includes(q)) return true;
      return false;
    };
    renderList(sessions);
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      if (!q) {
        renderList(sessions);
        return;
      }
      renderList(sessions.filter((s) => matchSession(s, q)));
    });
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) this.closeHistoryOverlay();
    });
    sessions = await listChatSessions(this.app.vault, chatHistoryFolder);
    renderList(sessions);
  }
  async loadSession(id) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const { chatHistoryFolder } = this.plugin.settings;
    const data = await loadChatSession(this.app.vault, chatHistoryFolder, id);
    if (!data || !((_a = data.messages) == null ? void 0 : _a.length)) {
      new import_obsidian13.Notice("\u65E0\u6CD5\u52A0\u8F7D\u8BE5\u4F1A\u8BDD");
      return;
    }
    this.sessionId = data.id;
    this.claudeCodeSessionId = data.claudeCodeSessionId;
    this.codexSessionId = data.codexSessionId;
    this.restoredProxySessionIds = {
      "claude-code": data.claudeCodeProxySessionId,
      codex: data.codexProxySessionId
    };
    this.restoredProxyTaskIds = {
      "claude-code": data.claudeCodeProxyTaskId,
      codex: data.codexProxyTaskId
    };
    if (data.proxySessionId && data.proxySessionBackend) {
      (_d = (_b = this.restoredProxySessionIds)[_c = data.proxySessionBackend]) != null ? _d : _b[_c] = data.proxySessionId;
    }
    if (data.proxyTaskId && data.proxySessionBackend) {
      (_g = (_e = this.restoredProxyTaskIds)[_f = data.proxySessionBackend]) != null ? _g : _e[_f] = data.proxyTaskId;
    }
    this.harnessContext = data.harnessContext ? { ...data.harnessContext, mode: { ...data.harnessContext.mode, actions: (_h = data.harnessContext.mode.actions) != null ? _h : [] } } : null;
    this.lastMode = (_i = data.lastMode) != null ? _i : null;
    this.messages = data.messages.map((m) => ({
      role: m.role,
      content: m.content,
      source: m.source
    }));
    this.cachedTokenCount = this.messages.reduce(
      (sum, m) => sum + estimateTextTokens(m.content),
      0
    );
    this.client = null;
    this.vaultTools = null;
    this.messagesEl.empty();
    const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
    if (welcome) welcome.remove();
    this.updateMoreButtonVisibility();
    if (this.harnessContext) {
      const ctx = this.harnessContext;
      const banner = this.messagesEl.createDiv({ cls: "ai-daily-ctx-header" });
      const row = banner.createDiv({ cls: "ai-daily-ctx-row" });
      const modeIcon = row.createDiv({ cls: "ai-daily-ctx-icon" });
      modeIcon.textContent = ctx.mode.emoji;
      const info = row.createDiv({ cls: "ai-daily-ctx-info" });
      info.createDiv({ cls: "ai-daily-ctx-mode", text: ctx.mode.label });
      if (ctx.workspace) {
        info.createDiv({ cls: "ai-daily-ctx-ws", text: ctx.workspace });
      }
      if (ctx.injectedFiles.length > 0) {
        let expanded = false;
        const toggle = row.createSpan({
          cls: "ai-daily-ctx-toggle",
          text: `${ctx.injectedFiles.length} files \u2304`
        });
        toggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          expanded = !expanded;
          banner.toggleClass("ai-daily-ctx-expanded", expanded);
          toggle.textContent = expanded ? `${ctx.injectedFiles.length} files \u2303` : `${ctx.injectedFiles.length} files \u2304`;
        });
        const detail = banner.createDiv({ cls: "ai-daily-ctx-detail" });
        detail.createDiv({ cls: "ai-daily-ctx-detail-label", text: `\u5DF2\u6CE8\u5165 ${ctx.injectedFiles.length} \u4E2A\u6587\u4EF6` });
        const pills = detail.createDiv({ cls: "ai-daily-ctx-pills" });
        for (const f of ctx.injectedFiles) {
          const pill = pills.createSpan({ cls: "ai-daily-ctx-pill clickable" });
          const fIcon = pill.createSpan({ cls: "ai-daily-ctx-pill-icon" });
          (0, import_obsidian13.setIcon)(fIcon, "file-text");
          const displayName = f.path.replace(/^.*\//, "").replace(/\.md$/, "");
          pill.createSpan({ text: displayName });
          pill.setAttribute("title", f.path);
          pill.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this.app.workspace.openLinkText(f.path, "", false);
          });
        }
      }
    }
    for (const m of this.messages) {
      const msgEl = this.messagesEl.createDiv({
        cls: `ai-daily-msg ai-daily-msg-${m.role}`
      });
      if (m.role === "assistant") {
        await import_obsidian13.MarkdownRenderer.render(
          this.app,
          normalizeMarkdownForObsidian(m.content),
          msgEl,
          "",
          this.plugin
        );
        this.postProcessAssistantEl(msgEl);
      } else {
        msgEl.setText(m.content);
      }
    }
    await this.initClient();
    this.restoreProxyHandlesToClient();
    this.client.setHistoryFromStrings(
      this.messages.map((m) => ({
        role: m.role,
        content: m.content
      }))
    );
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    this.updateTokenBar();
    new import_obsidian13.Notice("\u5DF2\u6062\u590D\u5386\u53F2\u5BF9\u8BDD", 3e3);
    if (this.plugin.settings.proxyEnabled && this.plugin.settings.proxyUrl) {
      const backend = this.plugin.settings.cliBackend;
      const taskId = this.client.getProxyTaskId(backend);
      if (taskId) void this.recoverProxyTask(taskId, backend);
    }
  }
  restoreProxyHandlesToClient() {
    if (!this.client) return;
    for (const backend of ["claude-code", "codex"]) {
      const sessionId = this.restoredProxySessionIds[backend];
      const taskId = this.restoredProxyTaskIds[backend];
      if (sessionId) this.client.setProxySessionId(backend, sessionId);
      if (taskId) this.client.setProxyTaskId(backend, taskId);
    }
    this.restoredProxySessionIds = {};
    this.restoredProxyTaskIds = {};
  }
  async recoverProxyTask(taskId, backend) {
    var _a;
    const proxyUrl = (_a = this.plugin.settings.proxyUrl) == null ? void 0 : _a.trim();
    const baseUrl = proxyUrl && !/^https?:\/\//i.test(proxyUrl) ? `https://${proxyUrl}` : proxyUrl;
    if (!baseUrl || !this.plugin.settings.proxyToken) return;
    try {
      const resp = await fetch(`${baseUrl}/task/${taskId}`, {
        headers: { Authorization: `Bearer ${this.plugin.settings.proxyToken}` }
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.sessionId && this.client) {
        this.client.setProxySessionId(backend, data.sessionId);
      }
      if (data.status === "done" && data.result) {
        const lastMsg = this.messages[this.messages.length - 1];
        if ((lastMsg == null ? void 0 : lastMsg.role) === "user" || (lastMsg == null ? void 0 : lastMsg.role) === "assistant" && lastMsg.content !== data.result) {
          if ((lastMsg == null ? void 0 : lastMsg.role) === "assistant") {
            this.messages.pop();
            const lastEl = this.messagesEl.querySelector(".ai-daily-msg-assistant:last-child");
            if (lastEl) lastEl.remove();
          }
          this.addMessage("assistant", data.result, "proxy");
          this.scrollToBottomIfFollowing();
          await this.persistSession();
          new import_obsidian13.Notice("\u5DF2\u6062\u590D\u4EE3\u7406\u4EFB\u52A1\u7684\u5B8C\u6574\u56DE\u590D", 4e3);
        }
      } else if (data.status === "running") {
        new import_obsidian13.Notice("\u4EE3\u7406\u4EFB\u52A1\u4ECD\u5728\u8FD0\u884C\u4E2D\uFF0C\u8BF7\u7A0D\u540E\u5237\u65B0", 4e3);
      }
    } catch (e) {
      console.warn("[ai-daily] proxy task recovery failed:", e);
    }
  }
  async onClose() {
    var _a;
    this.closed = true;
    if (this.claudeCodeAbort) {
      this.claudeCodeAbort();
      this.claudeCodeAbort = null;
    }
    if (this.codexAbort) {
      this.codexAbort();
      this.codexAbort = null;
    }
    (_a = this.client) == null ? void 0 : _a.abort();
    this.closeHistoryOverlay();
    this.closeTemplatePopup();
    this.closeMentionPopup();
  }
};
_ChatView.MAX_IMAGES_PER_TURN = 5;
_ChatView.WORKSPACE_COLORS = [
  "#e07a3a",
  "#5b9bd5",
  "#6bc26b",
  "#c25b8e",
  "#9b7ed8",
  "#d4a843",
  "#4abfbf",
  "#d45b5b"
];
var ChatView = _ChatView;

// src/feed-generator.ts
var import_obsidian14 = require("obsidian");
var FEED_SYSTEM_PROMPT = `\u4F60\u662F\u4E00\u4E2A AI/ML \u9886\u57DF\u7684\u8D44\u6DF1\u6280\u672F\u7F16\u8F91\uFF0C\u8BFB\u8005\u662F\u6709\u7ECF\u9A8C\u7684\u5F00\u53D1\u8005\u548C\u7814\u7A76\u8005\u3002
\u4F60\u7684\u4EFB\u52A1\u662F\u57FA\u4E8E\u591A\u6765\u6E90\u6293\u53D6\u7684\u6587\u7AE0\uFF08RSS\u3001Hacker News\u3001Reddit\u3001GitHub Trending\u3001\u6280\u672F\u535A\u5BA2\u3001\u64AD\u5BA2\uFF09\u548C\u7528\u6237\u7B14\u8BB0\u5E93\u4E2D\u7684\u76F8\u5173\u5185\u5BB9\uFF0C\u751F\u6210\u4E00\u4EFD\u6709\u6DF1\u5EA6\u7684\u4E2D\u6587\u6280\u672F Feed\u3002

## \u5185\u5BB9\u7B5B\u9009\u539F\u5219
- **\u5DE5\u7A0B\u5B9E\u8DF5\u4F18\u5148**\uFF1A\u4F18\u5148\u5448\u73B0\u5DE5\u7A0B\u7ECF\u9A8C\u5206\u4EAB\u3001\u751F\u4EA7\u73AF\u5883\u6848\u4F8B\u3001\u7CFB\u7EDF\u8BBE\u8BA1\u3001\u67B6\u6784\u6F14\u8FDB\u3001\u8E29\u5751\u590D\u76D8\u7B49\u5B9E\u6218\u5185\u5BB9
- **\u4F18\u5148\u5448\u73B0\u6B63\u5728\u88AB\u793E\u533A\u70ED\u8BAE\u7684\u5185\u5BB9**\uFF1A\u5173\u6CE8\u793E\u4EA4\u70ED\u5EA6\uFF08points\u3001upvotes\u3001stars today\uFF09\u548C\u8BC4\u8BBA\u6570\uFF0C\u8FD9\u4E9B\u662F trending \u7684\u5173\u952E\u4FE1\u53F7
- \u591A\u4E2A\u6765\u6E90\u540C\u65F6\u63D0\u5230\u540C\u4E00\u8BDD\u9898 = \u91CD\u8981\u8D8B\u52BF\uFF0C\u5FC5\u987B\u91CD\u70B9\u62A5\u9053
- \u4F18\u5148\u9009\u62E9\uFF1A\u5DE5\u7A0B\u5B9E\u8DF5\u3001\u6280\u672F\u65B9\u6848\u3001\u5F00\u6E90\u5DE5\u5177\u3001\u67B6\u6784\u8BBE\u8BA1\u3001\u5B9E\u6218\u7ECF\u9A8C\u3001\u70ED\u95E8\u8BA8\u8BBA
- \u8BBA\u6587\u7C7B\u5185\u5BB9\uFF1A\u53EA\u9009\u6709\u5B9E\u9645\u5E94\u7528\u4EF7\u503C\u6216\u793E\u533A\u9AD8\u5EA6\u5173\u6CE8\u7684\uFF0C\u7EAF\u7406\u8BBA\u8BBA\u6587\u964D\u4F4E\u4F18\u5148\u7EA7
- \u964D\u4F4E\u4F18\u5148\u7EA7\uFF1A\u4F01\u4E1A\u5408\u4F5C\u65B0\u95FB\u3001\u4EA7\u54C1\u53D1\u5E03\u516C\u544A\u3001\u878D\u8D44\u6D88\u606F\u3001\u7EAF\u5B66\u672F\u8BBA\u6587
- \u5982\u679C\u4E00\u6761\u5185\u5BB9\u53EA\u662F"XX\u516C\u53F8\u505A\u4E86XX"\u800C\u6CA1\u6709\u6280\u672F\u7EC6\u8282\uFF0C\u53EF\u4EE5\u8DF3\u8FC7\u6216\u5408\u5E76\u5230\u7B80\u8BAF\u4E2D
- **\u64AD\u5BA2\u5185\u5BB9**\uFF1A\u6807\u6CE8 \u{1F399}\uFE0F\uFF0C\u7A81\u51FA\u5609\u5BBE\u8EAB\u4EFD\u3001\u6838\u5FC3\u8BA8\u8BBA\u8981\u70B9\u3001\u65F6\u957F\uFF0C\u64AD\u5BA2\u9002\u5408\u4E0E\u6587\u7AE0\u7C7B\u5185\u5BB9\u4EA4\u53C9\u5BF9\u6BD4

## \u8F93\u51FA\u683C\u5F0F
\u6309\u4E3B\u9898\u5206\u7EC4\u8F93\u51FA Markdown\u3002\u6BCF\u4E2A\u4E3B\u9898\u4E0B\u5206\u4E09\u4E2A\u6765\u6E90\uFF1A

### \u{1F525} \u4E3B\u9898\u540D\uFF08\u5982\u679C\u662F\u591A\u6E90\u4EA4\u53C9\u70ED\u70B9\uFF0C\u6807\u6CE8\u300CTrending\u300D\uFF09

#### \u6765\u81EA\u7B14\u8BB0\u5E93
- \u5982\u679C\u6709\u76F8\u5173\u7B14\u8BB0\uFF0C\u7528 [[\u7B14\u8BB0\u8DEF\u5F84]] \u683C\u5F0F\u5F15\u7528\uFF0C\u7B80\u8981\u8BF4\u660E\u5173\u8054
- \u5982\u679C\u6CA1\u6709\u76F8\u5173\u7B14\u8BB0\uFF0C\u5199"\u6682\u65E0\u76F8\u5173\u7B14\u8BB0"

#### \u6700\u65B0\u52A8\u6001
- \u7528 3-5 \u53E5\u8BDD\u6DF1\u5165\u89E3\u8BFB\u6587\u7AE0\u6280\u672F\u8981\u70B9
- \u6807\u6CE8\u6765\u6E90\u94FE\u63A5
- \u5982\u6709\u793E\u533A\u8BA8\u8BBA\u4EAE\u70B9\uFF08\u9AD8\u8D5E\u8BC4\u8BBA\u89C2\u70B9\u7B49\uFF09\uFF0C\u7B80\u8981\u63D0\u53CA

#### AI \u5206\u6790
- \u7EFC\u5408\u4EE5\u4E0A\u4FE1\u606F\uFF0C\u5206\u6790\u8D8B\u52BF\u548C\u8981\u70B9

## \u5176\u4ED6\u8981\u6C42
- \u503C\u5F97\u6DF1\u5165\u9605\u8BFB\u7684\u6807\u6CE8\u300C\u2B50 \u63A8\u8350\u7CBE\u8BFB\u300D
- \u793E\u533A\u70ED\u5EA6\u7279\u522B\u9AD8\uFF08500+ points/upvotes\uFF09\u7684\u6807\u6CE8\u300C\u{1F525} \u70ED\u95E8\u300D
- \u7EAF\u884C\u4E1A\u52A8\u6001\u653E\u5230\u672B\u5C3E\u300C\u{1F4CB} \u884C\u4E1A\u7B80\u8BAF\u300D\u533A\u57DF\uFF0C\u6BCF\u6761\u4E00\u53E5\u8BDD
- \u8F93\u51FA\u7EAF Markdown \u683C\u5F0F
- \u5B81\u53EF\u5C11\u9009\u51E0\u7BC7\u6DF1\u5165\u89E3\u8BFB\uFF0C\u4E5F\u4E0D\u8981\u5806\u780C\u5927\u91CF\u6D45\u5C42\u6458\u8981`;
async function searchVaultForTopics(app, topics, knowledgeFolders, excludeFolder) {
  if (topics.length === 0) return "";
  const results = [];
  const files = app.vault.getMarkdownFiles().filter(
    (f) => knowledgeFolders.some((folder) => f.path.startsWith(folder)) && !(excludeFolder && f.path.startsWith(excludeFolder))
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
  if (results.length === 0) return "\u672A\u627E\u5230\u76F8\u5173\u7B14\u8BB0\u3002";
  return results.map((r) => `**[[${r.path}]]**
${r.snippet}`).join("\n\n");
}
async function callClaude(apiKey, model, userMessage) {
  const result = await callClaudeSimple({
    apiKey,
    model,
    systemPrompt: FEED_SYSTEM_PROMPT,
    userMessage
  });
  return result || "Feed \u751F\u6210\u5931\u8D25\u3002";
}
var URL_PATTERN = /https?:\/\/[^\s\])>"']+/g;
async function getRecentFeedUrls(app, feedFolder, days = 3, prefixes = ["Feed"]) {
  const urls = /* @__PURE__ */ new Set();
  const today = /* @__PURE__ */ new Date();
  for (let i = 1; i <= days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    for (const prefix of prefixes) {
      const filePath = `${feedFolder}/${prefix}-${dateStr}.md`;
      const file = app.vault.getAbstractFileByPath(filePath);
      if (file instanceof import_obsidian14.TFile) {
        const content = await app.vault.cachedRead(file);
        for (const match of content.matchAll(URL_PATTERN)) {
          urls.add(match[0]);
        }
      }
    }
  }
  return urls;
}
function getTodayFeedPath(feedFolder) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return `${feedFolder}/Feed-${today}.md`;
}
async function checkExistingFeed(app, feedFolder) {
  const filePath = getTodayFeedPath(feedFolder);
  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing instanceof import_obsidian14.TFile) {
    const content = await app.vault.read(existing);
    return { file: existing, content };
  }
  return null;
}
async function generateFeed(app, settings, onProgress, existingContent) {
  const { apiKey, model, feedSources, knowledgeFolders } = settings;
  const feedFolder = "Feed";
  const feedTopics = [];
  const feedMaxArticles = 20;
  if (!apiKey) throw new Error("\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E API Key");
  onProgress == null ? void 0 : onProgress({ stage: "rss", message: "\u6B63\u5728\u6293\u53D6 RSS \u6E90..." });
  const articles = await fetchAllFeeds({
    feeds: feedSources,
    userTopics: feedTopics,
    maxArticles: feedMaxArticles,
    onProgress: (msg) => onProgress == null ? void 0 : onProgress({ stage: "rss", message: msg })
  });
  if (articles.length === 0) {
    onProgress == null ? void 0 : onProgress({ stage: "rss", message: "\u672A\u6293\u53D6\u5230\u4EFB\u4F55\u6587\u7AE0" });
  }
  onProgress == null ? void 0 : onProgress({ stage: "dedup", message: "\u6B63\u5728\u53BB\u91CD\uFF08\u6392\u9664\u8FD1\u671F\u5DF2\u62A5\u9053\u5185\u5BB9\uFF09..." });
  const recentUrls = await getRecentFeedUrls(app, feedFolder, 3, ["Feed", "Podcast"]);
  const beforeCount = articles.length;
  const dedupedArticles = articles.filter((a) => !recentUrls.has(a.url));
  if (beforeCount > dedupedArticles.length) {
    onProgress == null ? void 0 : onProgress({
      stage: "dedup",
      message: `\u5DF2\u8FC7\u6EE4 ${beforeCount - dedupedArticles.length} \u7BC7\u8FD1\u671F\u5DF2\u62A5\u9053\u7684\u6587\u7AE0`
    });
  }
  onProgress == null ? void 0 : onProgress({ stage: "vault", message: "\u6B63\u5728\u641C\u7D22\u7B14\u8BB0\u5E93..." });
  const vaultContext = await searchVaultForTopics(app, feedTopics, knowledgeFolders, feedFolder);
  onProgress == null ? void 0 : onProgress({ stage: "ai", message: "\u6B63\u5728\u8BA9 AI \u751F\u6210 Feed..." });
  const articlesText = dedupedArticles.map(
    (a) => {
      let text = `\u6807\u9898: ${a.title}
\u6765\u6E90: ${a.source}
\u7C7B\u578B: ${a.category}
\u76F8\u5173\u5EA6: ${a.relevanceScore}
\u94FE\u63A5: ${a.url}`;
      if (a.socialScore > 0 || a.commentCount > 0) {
        text += `
\u70ED\u5EA6: ${a.socialScore} points, ${a.commentCount} comments`;
      }
      text += `
\u6458\u8981: ${a.summary || "\u65E0"}`;
      return text;
    }
  ).join("\n\n");
  const topicsStr = feedTopics.length > 0 ? `\u7528\u6237\u5173\u6CE8\u7684\u4E3B\u9898: ${feedTopics.join(", ")}

` : "";
  let deduplicationNote = "";
  if (existingContent) {
    deduplicationNote = `## \u26A0\uFE0F \u91CD\u8981\uFF1A\u4EE5\u4E0B\u662F\u4ECA\u5929\u5DF2\u751F\u6210\u7684 Feed \u5185\u5BB9\uFF0C\u8BF7\u52FF\u91CD\u590D\u62A5\u9053\u76F8\u540C\u7684\u6587\u7AE0\u6216\u4E3B\u9898

${existingContent}

\u8BF7\u53EA\u5173\u6CE8\u4E0A\u9762\u5C1A\u672A\u8986\u76D6\u7684\u65B0\u5185\u5BB9\u3002\u5982\u679C\u6240\u6709\u6587\u7AE0\u90FD\u5DF2\u5728\u4E0A\u6B21 Feed \u4E2D\u62A5\u9053\u8FC7\uFF0C\u8BF7\u660E\u786E\u544A\u77E5"\u672C\u6B21\u65E0\u65B0\u589E\u5185\u5BB9"\u3002

`;
  }
  const userMessage = `${topicsStr}${deduplicationNote}## \u7528\u6237\u7B14\u8BB0\u5E93\u4E2D\u7684\u76F8\u5173\u5185\u5BB9

${vaultContext}

## RSS \u6293\u53D6\u5230\u7684\u6587\u7AE0\uFF08\u5171 ${dedupedArticles.length} \u7BC7\uFF09

${articlesText}`;
  let aiContent;
  if (dedupedArticles.length === 0 && vaultContext === "\u672A\u627E\u5230\u76F8\u5173\u7B14\u8BB0\u3002") {
    aiContent = "\u4ECA\u5929\u6682\u65E0\u65B0\u7684 Feed \u5185\u5BB9\u3002\u8BF7\u68C0\u67E5 RSS \u6E90\u914D\u7F6E\u6216\u7F51\u7EDC\u8FDE\u63A5\u3002";
  } else {
    aiContent = await callClaude(apiKey, model, userMessage);
  }
  onProgress == null ? void 0 : onProgress({ stage: "write", message: "\u6B63\u5728\u5199\u5165\u7B14\u8BB0..." });
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const topicsYaml = feedTopics.length > 0 ? `topics: [${feedTopics.join(", ")}]
` : "";
  const filePath = `${feedFolder}/Feed-${today}.md`;
  const existingFile = app.vault.getAbstractFileByPath(filePath);
  const folderExists = app.vault.getAbstractFileByPath(feedFolder);
  if (!folderExists) {
    await app.vault.createFolder(feedFolder);
  }
  let file;
  if (existingFile instanceof import_obsidian14.TFile && existingContent) {
    const now = /* @__PURE__ */ new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const appendContent = `

---

# AI Feed \u66F4\u65B0 - ${today} ${timeStr}

${aiContent}
`;
    const updatedContent = existingContent + appendContent;
    await app.vault.modify(existingFile, updatedContent);
    file = existingFile;
  } else if (existingFile instanceof import_obsidian14.TFile) {
    const noteContent = `---
type: feed
${topicsYaml}date: ${today}
---

# AI Feed - ${today}

${aiContent}
`;
    await app.vault.modify(existingFile, noteContent);
    file = existingFile;
  } else {
    const noteContent = `---
type: feed
${topicsYaml}date: ${today}
---

# AI Feed - ${today}

${aiContent}
`;
    file = await app.vault.create(filePath, noteContent);
  }
  onProgress == null ? void 0 : onProgress({ stage: "done", message: `Feed \u5DF2\u751F\u6210: ${filePath}` });
  return file;
}
var PODCAST_FEED_SYSTEM_PROMPT = `\u4F60\u662F\u4E00\u4E2A\u64AD\u5BA2\u5185\u5BB9\u5206\u6790\u4E13\u5BB6\uFF0C\u5E2E\u52A9\u7528\u6237\u5FEB\u901F\u4E86\u89E3\u5404\u64AD\u5BA2\u6700\u65B0\u4E00\u671F\u7684\u6838\u5FC3\u5185\u5BB9\u3002
\u8BFB\u8005\u662F\u6709\u7ECF\u9A8C\u7684\u5F00\u53D1\u8005\u548C\u7EC8\u8EAB\u5B66\u4E60\u8005\uFF0C\u5173\u6CE8 AI/\u6280\u672F\u524D\u6CBF\u3001\u5546\u4E1A\u601D\u7EF4\u3001\u79D1\u5B66\u63A2\u7D22\u3002

## \u8F93\u51FA\u683C\u5F0F

\u6309\u64AD\u5BA2\u9010\u4E2A\u6574\u7406\uFF0C\u6BCF\u4E2A\u64AD\u5BA2\u4E00\u4E2A\u533A\u5757\uFF1A

### \u{1F399}\uFE0F \u64AD\u5BA2\u540D\u79F0 \u2014 \u672C\u671F\u6807\u9898
- **\u5609\u5BBE**: \uFF08\u5982\u6709\uFF09
- **\u65F6\u957F**: X \u5206\u949F
- **\u6838\u5FC3\u89C2\u70B9**:
  1. \u7B2C\u4E00\u4E2A\u8981\u70B9\uFF082-3 \u53E5\u6DF1\u5165\u89E3\u8BFB\uFF09
  2. \u7B2C\u4E8C\u4E2A\u8981\u70B9
  3. ...
- **\u503C\u5F97\u5173\u6CE8\u7684\u91D1\u53E5/\u6570\u636E**: \uFF08\u5982\u6709\u7279\u522B\u6709\u542F\u53D1\u7684\u8868\u8FF0\uFF09
- **\u4E0E\u5176\u4ED6\u64AD\u5BA2\u7684\u4EA4\u53C9\u8BDD\u9898**: \uFF08\u5982\u679C\u591A\u4E2A\u64AD\u5BA2\u8BA8\u8BBA\u4E86\u76F8\u4F3C\u8BDD\u9898\uFF0C\u6807\u6CE8\u5173\u8054\uFF09
- \u{1F517} [\u6536\u542C\u94FE\u63A5](url)

## \u6700\u540E\u52A0\u4E00\u4E2A\u603B\u7ED3\u533A\u5757

### \u{1F4CA} \u672C\u5468\u64AD\u5BA2\u8D8B\u52BF
- \u591A\u4E2A\u64AD\u5BA2\u5171\u540C\u5173\u6CE8\u7684\u8BDD\u9898
- \u503C\u5F97\u6DF1\u5165\u4E86\u89E3\u7684\u65B0\u6982\u5FF5\u6216\u8D8B\u52BF

## \u8981\u6C42
- \u7528\u4E2D\u6587\u8F93\u51FA
- \u5982\u679C\u6709 transcript \u5185\u5BB9\uFF0C\u6DF1\u5165\u63D0\u70BC\u6838\u5FC3\u89C2\u70B9\uFF0C\u4E0D\u8981\u53EA\u662F\u6D45\u5C42\u6458\u8981
- \u5982\u679C\u53EA\u6709\u63CF\u8FF0\u4FE1\u606F\uFF0C\u636E\u6B64\u6574\u7406\u8981\u70B9\u5E76\u6807\u6CE8"\uFF08\u57FA\u4E8E\u8282\u76EE\u7B80\u4ECB\uFF09"
- \u6309\u4FE1\u606F\u5BC6\u5EA6\u548C\u8BDD\u9898\u91CD\u8981\u6027\u6392\u5E8F\uFF0C\u6700\u6709\u4EF7\u503C\u7684\u653E\u524D\u9762
- \u7EAF\u95F2\u804A/\u5A31\u4E50\u7C7B\u5185\u5BB9\u7B80\u8981\u5E26\u8FC7\u5373\u53EF`;
function getTodayPodcastFeedPath(feedFolder) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return `${feedFolder}/Podcast-${today}.md`;
}
async function checkExistingPodcastFeed(app, feedFolder) {
  const filePath = getTodayPodcastFeedPath(feedFolder);
  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing instanceof import_obsidian14.TFile) {
    const content = await app.vault.read(existing);
    return { file: existing, content };
  }
  return null;
}
async function generatePodcastFeed(app, settings, onProgress, existingContent) {
  const { apiKey, model, feedSources } = settings;
  const feedFolder = "Feed";
  if (!apiKey) throw new Error("\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E API Key");
  const podcastSources = feedSources.filter((s) => s.type === "podcast");
  if (podcastSources.length === 0) {
    throw new Error("\u6CA1\u6709\u914D\u7F6E\u64AD\u5BA2\u6E90\uFF0C\u8BF7\u5728 Feed \u8BBE\u7F6E\u4E2D\u6DFB\u52A0\u64AD\u5BA2\u8BA2\u9605");
  }
  onProgress == null ? void 0 : onProgress({ stage: "rss", message: `\u6B63\u5728\u6293\u53D6 ${podcastSources.length} \u4E2A\u64AD\u5BA2\u6E90...` });
  const fetchResults = await Promise.allSettled(
    podcastSources.map((source) => fetchPodcastRss(source.url, source.name))
  );
  const items = [];
  const failedSources = [];
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1e3);
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
          transcript: null
        });
      }
    } else {
      failedSources.push(podcastSources[i].name);
    }
  }
  if (failedSources.length > 0) {
    onProgress == null ? void 0 : onProgress({ stage: "rss", message: `\u26A0\uFE0F ${failedSources.length} \u4E2A\u64AD\u5BA2\u6E90\u6293\u53D6\u5931\u8D25: ${failedSources.join(", ")}` });
  }
  onProgress == null ? void 0 : onProgress({ stage: "rss", message: `\u5171\u83B7\u53D6 ${items.length} \u4E2A\u64AD\u5BA2\u6700\u65B0\u5267\u96C6` });
  if (items.length === 0) {
    throw new Error("\u672A\u80FD\u6293\u53D6\u5230\u4EFB\u4F55\u64AD\u5BA2\u5267\u96C6");
  }
  const recentUrls = await getRecentFeedUrls(app, feedFolder, 3, ["Podcast", "Feed"]);
  const beforeCount = items.length;
  const dedupedItems = items.filter((it) => !recentUrls.has(it.link));
  if (beforeCount > dedupedItems.length) {
    onProgress == null ? void 0 : onProgress({ stage: "dedup", message: `\u5DF2\u8FC7\u6EE4 ${beforeCount - dedupedItems.length} \u4E2A\u8FD1\u671F\u5DF2\u62A5\u9053\u7684\u5267\u96C6` });
  }
  onProgress == null ? void 0 : onProgress({ stage: "transcript", message: "\u6B63\u5728\u63D0\u53D6\u64AD\u5BA2 transcript..." });
  const transcriptResults = await Promise.allSettled(
    dedupedItems.map(async (item) => {
      const episode = {
        title: item.episodeTitle,
        link: item.link,
        published: item.published,
        description: item.description,
        contentEncoded: "",
        duration: item.duration,
        audioUrl: item.link,
        episodeNumber: "",
        podcastName: item.podcastName
      };
      return extractTranscript(episode);
    })
  );
  for (let i = 0; i < transcriptResults.length; i++) {
    const result = transcriptResults[i];
    if (result.status === "fulfilled" && result.value !== "(No transcript available)") {
      dedupedItems[i].transcript = result.value.slice(0, 8e3);
    }
  }
  const withTranscript = dedupedItems.filter((it) => it.transcript).length;
  onProgress == null ? void 0 : onProgress({ stage: "transcript", message: `${withTranscript}/${dedupedItems.length} \u4E2A\u5267\u96C6\u83B7\u53D6\u5230 transcript` });
  onProgress == null ? void 0 : onProgress({ stage: "ai", message: "\u6B63\u5728\u8BA9 AI \u751F\u6210\u64AD\u5BA2 Feed..." });
  const episodesText = dedupedItems.map((item) => {
    const durationStr = item.duration ? `${Math.floor(item.duration / 60)} \u5206\u949F` : "\u672A\u77E5";
    const dateStr = item.published ? item.published.toISOString().slice(0, 10) : "\u672A\u77E5";
    let text = `\u64AD\u5BA2: ${item.podcastName}
\u6807\u9898: ${item.episodeTitle}
\u65E5\u671F: ${dateStr}
\u65F6\u957F: ${durationStr}
\u94FE\u63A5: ${item.link}
\u63CF\u8FF0: ${item.description}`;
    if (item.transcript) {
      text += `

Transcript\uFF08\u8282\u9009\uFF09:
${item.transcript}`;
    }
    return text;
  }).join("\n\n---\n\n");
  let deduplicationNote = "";
  if (existingContent) {
    deduplicationNote = `## \u26A0\uFE0F \u91CD\u8981\uFF1A\u4EE5\u4E0B\u662F\u4ECA\u5929\u5DF2\u751F\u6210\u7684\u64AD\u5BA2 Feed\uFF0C\u8BF7\u52FF\u91CD\u590D

${existingContent}

`;
  }
  const userMessage = `${deduplicationNote}## \u6700\u65B0\u64AD\u5BA2\u5267\u96C6\uFF08\u5171 ${dedupedItems.length} \u671F\uFF09

${episodesText}`;
  let aiContent;
  if (dedupedItems.length === 0) {
    aiContent = "\u4ECA\u5929\u6682\u65E0\u65B0\u7684\u64AD\u5BA2\u5185\u5BB9\u3002";
  } else {
    const result = await callClaudeSimple({
      apiKey,
      model,
      systemPrompt: PODCAST_FEED_SYSTEM_PROMPT,
      userMessage
    });
    aiContent = result || "\u64AD\u5BA2 Feed \u751F\u6210\u5931\u8D25\u3002";
  }
  onProgress == null ? void 0 : onProgress({ stage: "write", message: "\u6B63\u5728\u5199\u5165\u7B14\u8BB0..." });
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const filePath = `${feedFolder}/Podcast-${today}.md`;
  const existingFile = app.vault.getAbstractFileByPath(filePath);
  const folderExists = app.vault.getAbstractFileByPath(feedFolder);
  if (!folderExists) {
    await app.vault.createFolder(feedFolder);
  }
  let file;
  if (existingFile instanceof import_obsidian14.TFile && existingContent) {
    const now = /* @__PURE__ */ new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const appendContent = `

---

# \u64AD\u5BA2 Feed \u66F4\u65B0 - ${today} ${timeStr}

${aiContent}
`;
    await app.vault.modify(existingFile, existingContent + appendContent);
    file = existingFile;
  } else if (existingFile instanceof import_obsidian14.TFile) {
    const noteContent = `---
type: podcast-feed
date: ${today}
---

# \u64AD\u5BA2 Feed - ${today}

${aiContent}
`;
    await app.vault.modify(existingFile, noteContent);
    file = existingFile;
  } else {
    const noteContent = `---
type: podcast-feed
date: ${today}
---

# \u64AD\u5BA2 Feed - ${today}

${aiContent}
`;
    file = await app.vault.create(filePath, noteContent);
  }
  onProgress == null ? void 0 : onProgress({ stage: "done", message: `\u64AD\u5BA2 Feed \u5DF2\u751F\u6210: ${filePath}` });
  return file;
}

// src/auto-tagger.ts
var import_obsidian15 = require("obsidian");
var DEBOUNCE_MS = 5e3;
var AUTO_TAG_MARKER = "auto-tagged";
var AutoTagger = class {
  constructor(app, options) {
    this.pending = /* @__PURE__ */ new Map();
    this.processing = /* @__PURE__ */ new Set();
    this.app = app;
    this.options = options;
  }
  updateOptions(options) {
    Object.assign(this.options, options);
  }
  handleFileEvent(file) {
    if (!file.path.endsWith(".md")) return;
    if (!this.isInWatchedFolder(file.path)) return;
    if (this.processing.has(file.path)) return;
    const existing = this.pending.get(file.path);
    if (existing) clearTimeout(existing);
    this.pending.set(
      file.path,
      setTimeout(() => {
        this.pending.delete(file.path);
        this.processFile(file);
      }, DEBOUNCE_MS)
    );
  }
  destroy() {
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
  }
  isInWatchedFolder(path) {
    return this.options.folders.some(
      (f) => path.startsWith(f + "/") || path === f
    );
  }
  async processFile(file) {
    var _a, _b, _c, _d;
    const abstract = this.app.vault.getAbstractFileByPath(file.path);
    if (!(abstract instanceof import_obsidian15.TFile)) return;
    this.processing.add(file.path);
    try {
      const content = await this.app.vault.cachedRead(abstract);
      const { frontmatter } = parseFrontmatter(content);
      if (frontmatter[AUTO_TAG_MARKER] === true) return;
      if (content.replace(/^---[\s\S]*?---\n?/, "").trim().length < 50) return;
      const existingTags = this.collectVaultTags();
      const result = await this.callTaggingAPI(content, existingTags);
      if (!result) return;
      const freshContent = await this.app.vault.cachedRead(abstract);
      const { frontmatter: freshFm, body } = parseFrontmatter(freshContent);
      if (freshFm[AUTO_TAG_MARKER] === true) return;
      const updated = { ...freshFm };
      if (result.tags && result.tags.length > 0) {
        updated.tags = result.tags;
      }
      if (result.summary) {
        updated.summary = result.summary;
      }
      updated[AUTO_TAG_MARKER] = true;
      const newContent = serializeFrontmatter(updated) + body;
      await this.app.vault.modify(abstract, newContent);
      (_b = (_a = this.options).onTagged) == null ? void 0 : _b.call(_a, file.path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      (_d = (_c = this.options).onError) == null ? void 0 : _d.call(_c, file.path, msg);
    } finally {
      this.processing.delete(file.path);
    }
  }
  collectVaultTags() {
    var _a, _b;
    const tagCounts = /* @__PURE__ */ new Map();
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!((_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a.tags)) continue;
      const raw = cache.frontmatter.tags;
      const tags = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(",").map((t) => t.trim()).filter(Boolean) : [];
      for (const tag of tags) {
        const normalized = tag.toLowerCase().replace(/^#/, "");
        tagCounts.set(normalized, ((_b = tagCounts.get(normalized)) != null ? _b : 0) + 1);
      }
    }
    return [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([tag]) => tag);
  }
  async callTaggingAPI(noteContent, existingTags) {
    const truncated = noteContent.slice(0, 8e3);
    const tagHint = existingTags.length > 0 ? `

\u5DF2\u6709\u6807\u7B7E\u4F53\u7CFB\uFF08\u4F18\u5148\u590D\u7528\uFF09\uFF1A${existingTags.join(", ")}` : "";
    const systemPrompt = this.options.customPrompt || "\u4F60\u662F\u4E00\u4E2A\u77E5\u8BC6\u5E93\u6807\u6CE8\u52A9\u624B\u3002\u6839\u636E\u7B14\u8BB0\u5185\u5BB9\u751F\u6210\u5408\u9002\u7684\u6807\u7B7E\u548C\u6458\u8981\u3002";
    const userMessage = `\u8BF7\u4E3A\u4EE5\u4E0B\u7B14\u8BB0\u751F\u6210\u6807\u7B7E\u548C\u6458\u8981\u3002

\u8981\u6C42\uFF1A
1. \u6807\u7B7E 3-6 \u4E2A\uFF0C\u5C0F\u5199\u82F1\u6587\u6216\u4E2D\u6587\u77ED\u8BED\uFF0C\u4F18\u5148\u590D\u7528\u5DF2\u6709\u6807\u7B7E
2. \u6458\u8981 1-2 \u53E5\u8BDD\uFF0C\u4E2D\u6587
3. \u4E25\u683C\u6309 JSON \u683C\u5F0F\u8FD4\u56DE\uFF1A{"tags": ["tag1", "tag2"], "summary": "\u6458\u8981"}
4. \u53EA\u8FD4\u56DE JSON\uFF0C\u4E0D\u8981\u5176\u4ED6\u5185\u5BB9${tagHint}

\u7B14\u8BB0\u5185\u5BB9\uFF1A
${truncated}`;
    const response = await callClaudeSimple({
      apiKey: this.options.apiKey,
      model: this.options.model,
      systemPrompt,
      userMessage,
      maxTokens: 512
    });
    return parseTaggingResponse(response);
  }
};
function parseTaggingResponse(response) {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === "string" && t.length > 0) : [];
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    if (tags.length === 0 && !summary) return null;
    return { tags, summary };
  } catch (e) {
    return null;
  }
}

// src/plugin-api-server.ts
var PluginApiServer = class {
  constructor(app, port, knowledgeFolders = [], feedSources = []) {
    this.server = null;
    this.app = app;
    this.port = port;
    this.vaultTools = new VaultTools(app, knowledgeFolders);
    this.podcastTools = new PodcastTools();
    this.feedTools = new FeedTools(feedSources);
  }
  async start() {
    const http = require("http");
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.port, "127.0.0.1", () => {
      console.log(`[Cortex] Plugin API server listening on 127.0.0.1:${this.port}`);
    });
    this.server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`[Cortex] Port ${this.port} in use, API server not started`);
      } else {
        console.error("[Cortex] API server error:", err);
      }
    });
  }
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      console.log("[Cortex] Plugin API server stopped");
    }
  }
  async handleRequest(req, res) {
    var _a;
    res.setHeader("Content-Type", "application/json");
    const url = new URL((_a = req.url) != null ? _a : "/", `http://localhost:${this.port}`);
    const path = url.pathname;
    if (path === "/api/health" && req.method === "GET") {
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    let body;
    try {
      body = await this.readBody(req);
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }
    try {
      const result = await this.route(path, body);
      res.end(JSON.stringify({ result }));
    } catch (e) {
      res.statusCode = 500;
      const message = e instanceof Error ? e.message : String(e);
      res.end(JSON.stringify({ error: message }));
    }
  }
  async route(path, body) {
    switch (path) {
      case "/api/read_note":
      case "/api/search_vault":
      case "/api/append_to_note":
      case "/api/list_notes":
      case "/api/create_note":
      case "/api/edit_note":
      case "/api/rename_note":
      case "/api/delete_note":
      case "/api/get_links":
      case "/api/update_frontmatter": {
        const toolName = path.replace("/api/", "");
        return this.vaultTools.execute(toolName, body);
      }
      case "/api/read_image":
        return this.handleReadImage(body);
      case "/api/podcast_search":
      case "/api/podcast_episodes":
      case "/api/podcast_transcript": {
        const toolName = path.replace("/api/", "");
        return this.podcastTools.execute(toolName, body);
      }
      case "/api/fetch_feeds":
      case "/api/fetch_rss": {
        const toolName = path.replace("/api/", "");
        return this.feedTools.execute(toolName, body);
      }
      default:
        throw new Error(`Unknown endpoint: ${path}`);
    }
  }
  async handleReadImage(input) {
    const path = typeof input.path === "string" ? input.path : "";
    if (!path) return "Error: path is required";
    const ref = { raw: `![[${path}]]`, path };
    const { images, skipped } = await prepareLocalImages(this.app, [ref]);
    if (skipped.length > 0) {
      return `Error: ${skipped[0].reason}`;
    }
    if (images.length === 0) {
      return "Error: image not found";
    }
    return JSON.stringify({
      mediaType: images[0].mediaType,
      base64: images[0].base64
    });
  }
  readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf-8");
          resolve(text ? JSON.parse(text) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });
  }
};

// src/main.ts
var FeedConfirmModal = class extends import_obsidian16.Modal {
  constructor(app) {
    super(app);
    this.resolved = false;
    this.resolve = () => {
    };
  }
  open() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", {
      text: "\u4ECA\u5929\u5DF2\u7ECF\u751F\u6210\u8FC7 Feed\uFF0C\u518D\u6B21\u751F\u6210\u4F1A\u5C06\u65B0\u5185\u5BB9\u8FFD\u52A0\u5230\u73B0\u6709\u6587\u4EF6\u4E2D\uFF08\u4E0D\u4F1A\u8986\u76D6\uFF09\u3002AI \u4F1A\u81EA\u52A8\u907F\u514D\u91CD\u590D\u5DF2\u6709\u7684\u5185\u5BB9\u3002"
    });
    contentEl.createEl("p", {
      text: "\u662F\u5426\u7EE7\u7EED\u751F\u6210\uFF1F",
      cls: "ai-daily-confirm-question"
    });
    const btnRow = contentEl.createDiv({ cls: "ai-daily-confirm-btns" });
    const confirmBtn = btnRow.createEl("button", {
      text: "\u7EE7\u7EED\u751F\u6210",
      cls: "mod-cta"
    });
    const cancelBtn = btnRow.createEl("button", { text: "\u53D6\u6D88" });
    confirmBtn.addEventListener("click", () => {
      this.resolved = true;
      this.resolve(true);
      this.close();
    });
    cancelBtn.addEventListener("click", () => {
      this.resolved = true;
      this.resolve(false);
      this.close();
    });
  }
  onClose() {
    if (!this.resolved) this.resolve(false);
    this.contentEl.empty();
  }
};
var AIDailyChat = class extends import_obsidian16.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.autoTagger = null;
    this.apiServer = null;
  }
  getEffectiveApiKey() {
    return this.settings.enableApi ? this.settings.apiKey : "";
  }
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.registerView(HARNESS_VIEW_TYPE, (leaf) => new HarnessView(leaf, this));
    this.addRibbonIcon("brain", "Cortex", () => {
      this.activateView();
    });
    this.addCommand({
      id: "open-chat",
      name: "\u6253\u5F00 Cortex",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "open-harness",
      name: "\u6253\u5F00 Harness",
      callback: () => this.activateHarnessView()
    });
    this.addCommand({
      id: "chat-current-note",
      name: "\u5BF9\u8BDD\u5F53\u524D\u7B14\u8BB0",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        this.chatAboutCurrentNote();
        return true;
      }
    });
    this.addCommand({
      id: "generate-feed",
      name: "\u751F\u6210 AI Feed",
      callback: () => this.generateFeed()
    });
    this.addCommand({
      id: "generate-podcast-feed",
      name: "\u751F\u6210\u64AD\u5BA2 Feed",
      callback: () => this.generatePodcastFeed()
    });
    this.addCommand({
      id: "organize-knowledge",
      name: "\u6574\u7406\u77E5\u8BC6\u5E93",
      callback: () => this.organizeKnowledge()
    });
    this.addCommand({
      id: "wiki-health-check",
      name: "Wiki \u5065\u5EB7\u68C0\u67E5",
      callback: () => this.runWikiHealthCheck()
    });
    this.addSettingTab(new AIDailyChatSettingTab(this.app, this));
    this.setupAutoTagger();
    if (import_obsidian16.Platform.isDesktop) {
      this.apiServer = new PluginApiServer(this.app, 27080, this.settings.knowledgeFolders, this.settings.feedSources);
      this.apiServer.start();
      this.register(() => {
        var _a;
        return (_a = this.apiServer) == null ? void 0 : _a.stop();
      });
    }
    if (import_obsidian16.Platform.isMobile) {
      this.app.workspace.onLayoutReady(() => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf && this.isLeafInSidebar(leaf)) {
          leaf.detach();
        }
      });
    }
  }
  async chatAboutCurrentNote() {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (leaf) {
      const view = leaf.view;
      view.sendMessage("\u8BF7\u603B\u7ED3\u8FD9\u7BC7\u7B14\u8BB0\u7684\u8981\u70B9\uFF0C\u5E76\u6307\u51FA\u6700\u503C\u5F97\u6DF1\u5165\u4E86\u89E3\u7684\u90E8\u5206\u3002");
    }
  }
  isLeafInSidebar(leaf) {
    return leaf.getRoot() !== this.app.workspace.rootSplit;
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (leaf && import_obsidian16.Platform.isMobile && this.isLeafInSidebar(leaf)) {
      leaf.detach();
      leaf = void 0;
    }
    if (!leaf) {
      if (import_obsidian16.Platform.isMobile) {
        leaf = workspace.getLeaf(true);
      } else {
        const rightLeaf = workspace.getRightLeaf(false);
        if (rightLeaf) leaf = rightLeaf;
      }
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
  async activateHarnessView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(HARNESS_VIEW_TYPE)[0];
    if (leaf && import_obsidian16.Platform.isMobile && this.isLeafInSidebar(leaf)) {
      leaf.detach();
      leaf = void 0;
    }
    if (!leaf) {
      if (import_obsidian16.Platform.isMobile) {
        leaf = workspace.getLeaf(true);
      } else {
        const rightLeaf = workspace.getRightLeaf(false);
        if (rightLeaf) leaf = rightLeaf;
      }
      if (leaf) {
        await leaf.setViewState({ type: HARNESS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
  async startChatWithContext(context) {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) return;
    const view = leaf.view;
    view.startWithContext(context);
  }
  async generateFeed() {
    const existing = await checkExistingFeed(this.app, "Feed");
    if (existing) {
      const confirmed = await new FeedConfirmModal(this.app).open();
      if (!confirmed) return;
    }
    const notice = new import_obsidian16.Notice("\u6B63\u5728\u751F\u6210 AI Feed...", 0);
    try {
      const file = await generateFeed(
        this.app,
        { ...this.settings, apiKey: this.getEffectiveApiKey() },
        (progress) => {
          notice.setMessage(progress.message);
        },
        existing == null ? void 0 : existing.content
      );
      notice.hide();
      new import_obsidian16.Notice(`Feed \u5DF2\u751F\u6210: ${file.path}`, 5e3);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (e) {
      notice.hide();
      const msg = e instanceof Error ? e.message : String(e);
      new import_obsidian16.Notice(`Feed \u751F\u6210\u5931\u8D25: ${msg}`, 8e3);
    }
  }
  async generatePodcastFeed() {
    const existing = await checkExistingPodcastFeed(this.app, "Feed");
    if (existing) {
      const confirmed = await new FeedConfirmModal(this.app).open();
      if (!confirmed) return;
    }
    const notice = new import_obsidian16.Notice("\u6B63\u5728\u751F\u6210\u64AD\u5BA2 Feed...", 0);
    try {
      const file = await generatePodcastFeed(
        this.app,
        { ...this.settings, apiKey: this.getEffectiveApiKey() },
        (progress) => {
          notice.setMessage(progress.message);
        },
        existing == null ? void 0 : existing.content
      );
      notice.hide();
      new import_obsidian16.Notice(`\u64AD\u5BA2 Feed \u5DF2\u751F\u6210: ${file.path}`, 5e3);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (e) {
      notice.hide();
      const msg = e instanceof Error ? e.message : String(e);
      new import_obsidian16.Notice(`\u64AD\u5BA2 Feed \u751F\u6210\u5931\u8D25: ${msg}`, 8e3);
    }
  }
  async organizeKnowledge() {
    console.log("[ai-daily] organizeKnowledge called");
    const useClaudeCode = await isClaudeCodeAvailable();
    console.log("[ai-daily] useClaudeCode =", useClaudeCode);
    if (!useClaudeCode && !this.getEffectiveApiKey()) {
      new import_obsidian16.Notice("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u914D\u7F6E Anthropic API Key\uFF0C\u6216\u5B89\u88C5 Claude Code\u3002", 5e3);
      return;
    }
    const sourceFolder = this.settings.autoTagFolders[0] || "Raw";
    const unorganized = await findUnorganizedNotes(this.app, sourceFolder);
    if (unorganized.length === 0) {
      new import_obsidian16.Notice("\u6CA1\u6709\u627E\u5230\u5F85\u6574\u7406\u7684\u7B14\u8BB0", 3e3);
      return;
    }
    const batch = unorganized.slice(0, MAX_NOTES_PER_RUN);
    const targetFolder = this.settings.distillTargetFolder;
    const noteList = batch.map((f) => `- [[${f.basename}]] (${f.path})`).join("\n");
    const message = [
      `\u8BF7\u5E2E\u6211\u6574\u7406\u4EE5\u4E0B ${batch.length} \u7BC7\u7B14\u8BB0\uFF08\u5171 ${unorganized.length} \u7BC7\u5F85\u6574\u7406\uFF09\u5230 ${targetFolder}/ \u6587\u4EF6\u5939\uFF1A`,
      "",
      noteList,
      "",
      "\u6574\u7406\u6D41\u7A0B\uFF1A",
      "1. \u5148\u7528 list_notes \u6D4F\u89C8\u76EE\u6807\u6587\u4EF6\u5939\u7684\u5DF2\u6709\u6761\u76EE\u548C\u7ED3\u6784",
      "2. \u9010\u7BC7\u7528 read_note \u9605\u8BFB\u7B14\u8BB0\u5185\u5BB9\uFF0C\u63D0\u53D6\u6838\u5FC3\u89C2\u70B9\u548C\u5173\u952E\u6982\u5FF5",
      `3. \u7528 search_vault \u5728 ${targetFolder}/ \u4E2D\u641C\u7D22\u76F8\u5173\u7684\u5DF2\u6709\u6761\u76EE`,
      "4. \u6709\u76F8\u5173\u6761\u76EE \u2192 edit_note \u8865\u5145\u65B0\u4FE1\u606F\uFF0C\u4FDD\u6301\u539F\u6709\u7ED3\u6784\uFF1B\u6CA1\u6709 \u2192 create_note \u521B\u5EFA\u65B0\u6761\u76EE",
      "5. \u65B0\u6761\u76EE\u9700\u5305\u542B frontmatter\uFF08tags\u3001summary\uFF09\u548C\u6307\u5411\u539F\u7B14\u8BB0\u7684 wiki-link",
      "6. \u4E3B\u52A8\u6DFB\u52A0 [[wiki-link]] \u5173\u8054\u76F8\u5173\u6761\u76EE\uFF0C\u590D\u7528\u5DF2\u6709 tags \u907F\u514D\u540C\u4E49\u91CD\u590D",
      "7. \u6BCF\u7BC7\u6574\u7406\u5B8C\u540E\u7528 update_frontmatter \u6807\u8BB0 organized: true",
      "",
      "\u8BF7\u9010\u7BC7\u5904\u7406\uFF0C\u6BCF\u7BC7\u5B8C\u6210\u540E\u544A\u8BC9\u6211\u505A\u4E86\u4EC0\u4E48\u3002"
    ].join("\n");
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) return;
    const view = leaf.view;
    if (useClaudeCode) {
      new import_obsidian16.Notice("\u4F7F\u7528 Claude Code \u6574\u7406\uFF08Max plan \u989D\u5EA6\uFF09", 3e3);
      view.sendClaudeCodeMessage(message);
    } else {
      view.sendMessage(message);
    }
  }
  async runWikiHealthCheck() {
    const notice = new import_obsidian16.Notice("\u6B63\u5728\u68C0\u67E5\u77E5\u8BC6\u5E93\u5065\u5EB7\u72B6\u6001...", 0);
    try {
      const result = await wikiHealthCheck(this.app, this.settings.knowledgeFolders);
      const report = formatHealthCheckReport(result);
      notice.hide();
      await this.activateView();
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) return;
      const view = leaf.view;
      view.addHealthCheckReport(report, hasFixableIssues(result) ? result : void 0);
    } catch (e) {
      notice.hide();
      const msg = e instanceof Error ? e.message : String(e);
      new import_obsidian16.Notice(`\u5065\u5EB7\u68C0\u67E5\u5931\u8D25: ${msg}`, 5e3);
    }
  }
  setupAutoTagger() {
    var _a;
    (_a = this.autoTagger) == null ? void 0 : _a.destroy();
    this.autoTagger = null;
    if (!this.settings.enableAutoTagging || !this.getEffectiveApiKey()) return;
    this.autoTagger = new AutoTagger(this.app, {
      apiKey: this.getEffectiveApiKey(),
      model: this.settings.model,
      folders: this.settings.autoTagFolders,
      customPrompt: this.settings.autoTagPrompt || void 0,
      onTagged: (path) => {
        new import_obsidian16.Notice(`\u5DF2\u81EA\u52A8\u6807\u6CE8: ${path}`, 3e3);
      },
      onError: (path, error) => {
        console.warn(`[ai-daily] auto-tag failed for ${path}:`, error);
      }
    });
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        var _a2;
        if (file instanceof import_obsidian16.TFile) (_a2 = this.autoTagger) == null ? void 0 : _a2.handleFileEvent(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        var _a2;
        if (file instanceof import_obsidian16.TFile) (_a2 = this.autoTagger) == null ? void 0 : _a2.handleFileEvent(file);
      })
    );
  }
  onunload() {
    var _a;
    (_a = this.autoTagger) == null ? void 0 : _a.destroy();
  }
  get backupPath() {
    return `${this.manifest.dir}/data.backup.json`;
  }
  async loadSettings() {
    var _a;
    let raw = (_a = await this.loadData()) != null ? _a : {};
    if (Object.keys(raw).length === 0) {
      const restored = await this.restoreFromBackup();
      if (restored) {
        raw = restored;
        new import_obsidian16.Notice("\u8BBE\u7F6E\u5DF2\u4ECE\u5907\u4EFD\u6062\u590D\uFF08data.json \u53EF\u80FD\u4E22\u5931\u6216\u635F\u574F\uFF09", 8e3);
        console.warn("[ai-daily] data.json was empty/missing, restored from backup");
      }
    }
    if ("chatStreaming" in raw && !("chatStreamMode" in raw)) {
      raw.chatStreamMode = raw.chatStreaming === false ? "off" : "auto";
      delete raw.chatStreaming;
    }
    if (raw.codexModel === "o4-mini") raw.codexModel = "";
    const migratedCodexPermissionMode = !("codexPermissionMode" in raw);
    if (migratedCodexPermissionMode) raw.codexPermissionMode = "vault-write";
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
    if (migratedCodexPermissionMode) await this.saveData(this.settings);
    if (Array.isArray(raw.feedSources)) {
      const existingNames = new Set(
        this.settings.feedSources.map((s) => s.name)
      );
      let added = false;
      for (const defaultSource of DEFAULT_FEEDS) {
        if (!existingNames.has(defaultSource.name)) {
          this.settings.feedSources.push(defaultSource);
          added = true;
        }
      }
      if (added) {
        await this.saveData(this.settings);
      }
    }
    await this.writeBackup();
  }
  async saveSettings() {
    await this.saveData(this.settings);
    await this.writeBackup();
  }
  async writeBackup() {
    try {
      const json = JSON.stringify(this.settings, null, "	");
      await this.app.vault.adapter.write(this.backupPath, json);
    } catch (e) {
    }
  }
  async restoreFromBackup() {
    try {
      const exists = await this.app.vault.adapter.exists(this.backupPath);
      if (!exists) return null;
      const content = await this.app.vault.adapter.read(this.backupPath);
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && parsed.apiKey !== void 0) {
        await this.saveData(parsed);
        return parsed;
      }
    } catch (e) {
    }
    return null;
  }
};
