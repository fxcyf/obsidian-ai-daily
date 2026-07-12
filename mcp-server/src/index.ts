#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VaultOps, containsTraversal } from "./vault-ops.js";
import { VaultOpsApi } from "./vault-ops-api.js";

// ── Backend selection ──────────────────────────────────────────────
// Prefer Obsidian plugin HTTP API; fall back to filesystem if unavailable.

const obsidianApiUrl = process.env.OBSIDIAN_API_URL || "http://127.0.0.1:27080";
const vaultRoot = process.env.VAULT_PATH || "";

interface VaultBackend {
	readNote(path: string): Promise<string>;
	searchVault(query: string, folder?: string, tag?: string): Promise<string>;
	appendToNote(path: string, content: string): Promise<string>;
	listNotes(folder?: string, limit?: number): Promise<string>;
	createNote(path: string, content: string, frontmatter?: Record<string, unknown>): Promise<string>;
	editNote(path: string, mode: string, target: unknown, replacement: string): Promise<string>;
	renameNote(path: string, newPath: string): Promise<string>;
	deleteNote(path: string, confirmed: boolean): Promise<string>;
	getLinks(path: string): Promise<string>;
	updateFrontmatter(path: string, set?: Record<string, unknown>, del?: string[]): Promise<string>;
}

let vault: VaultBackend;
let apiBackend: VaultOpsApi | null = null;
let backendName: string;

const knowledgeFolders = (process.env.KNOWLEDGE_FOLDERS || "Raw,Wiki")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

async function initBackend(): Promise<void> {
	const api = new VaultOpsApi(obsidianApiUrl);
	if (await api.healthCheck()) {
		vault = api;
		apiBackend = api;
		backendName = `obsidian-api (${obsidianApiUrl})`;
		console.error(`[MCP] Using Obsidian API backend: ${obsidianApiUrl}`);
	} else if (vaultRoot) {
		vault = new VaultOps(vaultRoot, knowledgeFolders);
		backendName = `filesystem (${vaultRoot})`;
		console.error(`[MCP] Obsidian API not available, falling back to filesystem: ${vaultRoot}`);
	} else {
		console.error("Error: Neither Obsidian API nor VAULT_PATH available");
		process.exit(1);
	}
}

const server = new McpServer({
	name: "obsidian-vault",
	version: "0.2.0",
});

function pathGuard(p: string): string | null {
	if (!p) return "Error: path is required";
	if (containsTraversal(p)) return "Error: invalid path";
	return null;
}

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

// ── Vault tools ────────────────────────────────────────────────────

server.tool(
	"read_note",
	"读取 vault 中指定路径的笔记全文。可用于读取日报、采集的文章（Raw/）、整理的知识条目（Wiki/）等。",
	{ path: z.string().describe("笔记路径，如 Raw/some-article.md 或 Wiki/concept.md") },
	async ({ path }) => {
		const err = pathGuard(path);
		if (err) return textResult(err);
		return textResult(await vault.readNote(path));
	}
);

server.tool(
	"search_vault",
	"在 vault 中搜索笔记。支持关键词全文搜索，可按文件夹和标签过滤。用于在知识库中查找相关内容。",
	{
		query: z.string().describe("搜索关键词"),
		folder: z.string().optional().describe("限定搜索的文件夹路径，如 Raw、Wiki"),
		tag: z.string().optional().describe("按标签过滤，如 ai、rag（匹配 frontmatter 中的 tags）"),
	},
	async ({ query, folder, tag }) => {
		if (!query) return textResult("Error: query is required");
		return textResult(await vault.searchVault(query, folder, tag));
	}
);

server.tool(
	"append_to_note",
	"将内容追加到指定笔记末尾。用于将洞察、总结写回笔记。",
	{
		path: z.string().describe("笔记路径"),
		content: z.string().describe("要追加的 Markdown 内容"),
	},
	async ({ path, content }) => {
		const err = pathGuard(path);
		if (err) return textResult(err);
		return textResult(await vault.appendToNote(path, content));
	}
);

server.tool(
	"list_notes",
	"列出指定文件夹中的笔记，按修改时间排序。不指定文件夹则列出所有知识库文件夹的笔记。",
	{
		folder: z.string().optional().describe("文件夹路径，如 Raw、Wiki"),
		limit: z.number().optional().default(20).describe("返回最近几篇（默认 20）"),
	},
	async ({ folder, limit }) => textResult(await vault.listNotes(folder, limit))
);

server.tool(
	"create_note",
	"创建一篇新笔记。支持传入 frontmatter 对象，自动生成 YAML 头。会自动创建中间目录。路径已存在则报错。",
	{
		path: z.string().describe("笔记路径，如 Wiki/concept.md"),
		content: z.string().describe("笔记正文内容（Markdown）"),
		frontmatter: z.record(z.string(), z.unknown()).optional().describe("可选的 frontmatter 对象，如 {tags: ['ai'], summary: '...'}"),
	},
	async ({ path, content, frontmatter }) => {
		const err = pathGuard(path);
		if (err) return textResult(err);
		return textResult(await vault.createNote(path, content, frontmatter));
	}
);

server.tool(
	"edit_note",
	"编辑笔记中的指定部分。支持三种定位模式：search_replace（按原文匹配替换）、heading（替换整个标题 section）、line_range（按行号范围替换）。",
	{
		path: z.string().describe("笔记路径"),
		mode: z.enum(["heading", "line_range", "search_replace"]).describe("定位模式"),
		target: z.union([z.string(), z.object({ start: z.number(), end: z.number() })]).describe("search_replace/heading 传字符串，line_range 传 {start, end} 行号（从 1 开始）"),
		replacement: z.string().describe("替换后的新内容"),
	},
	async ({ path, mode, target, replacement }) => {
		const err = pathGuard(path);
		if (err) return textResult(err);
		return textResult(await vault.editNote(path, mode, target, replacement));
	}
);

server.tool(
	"rename_note",
	"重命名或移动笔记到新路径。通过 Obsidian API 时会自动更新所有反向链接引用。目标路径不能已存在。",
	{
		path: z.string().describe("当前笔记路径"),
		new_path: z.string().describe("新路径，如 Wiki/new-name.md"),
	},
	async ({ path, new_path }) => {
		const err = pathGuard(path);
		if (err) return textResult(err);
		const err2 = pathGuard(new_path);
		if (err2) return textResult(err2);
		return textResult(await vault.renameNote(path, new_path));
	}
);

server.tool(
	"delete_note",
	"删除笔记（两步确认）。第一次调用返回预览和确认提示，带 confirmed: true 再次调用才执行删除。文件移到回收站。",
	{
		path: z.string().describe("笔记路径"),
		confirmed: z.boolean().optional().default(false).describe("设为 true 确认删除"),
	},
	async ({ path, confirmed }) => {
		const err = pathGuard(path);
		if (err) return textResult(err);
		return textResult(await vault.deleteNote(path, confirmed));
	}
);

server.tool(
	"get_links",
	"获取笔记的双向链接关系。返回 outlinks（该笔记链接到的）和 backlinks（链接到该笔记的）。",
	{ path: z.string().describe("笔记路径，如 Wiki/concept.md") },
	async ({ path }) => {
		const err = pathGuard(path);
		if (err) return textResult(err);
		return textResult(await vault.getLinks(path));
	}
);

server.tool(
	"update_frontmatter",
	"修改笔记的 YAML frontmatter。支持设置（set）和删除（delete）字段。没有 frontmatter 则自动创建。",
	{
		path: z.string().describe("笔记路径"),
		set: z.record(z.string(), z.unknown()).optional().describe("要设置/覆盖的字段，如 {tags: ['ai'], summary: '...'}"),
		delete: z.array(z.string()).optional().describe("要删除的字段名列表，如 ['draft', 'temp']"),
	},
	async ({ path, set, delete: del }) => {
		const err = pathGuard(path);
		if (err) return textResult(err);
		if (!set && !del) return textResult("Error: at least one of set or delete is required");
		return textResult(await vault.updateFrontmatter(path, set, del));
	}
);

// ── Image tool (API backend only) ─────────────────────────────────

server.tool(
	"read_image",
	"读取 vault 中的图片文件并返回图片内容（自动压缩）。当笔记中包含图片引用（如 ![[photo.png]]）时使用。支持 png/jpg/jpeg/webp/gif。需要 Obsidian API 后端。",
	{ path: z.string().describe("图片在 vault 中的相对路径，如 attachments/photo.png") },
	async ({ path }) => {
		if (!apiBackend) return textResult("Error: read_image requires Obsidian API backend (not available in filesystem mode)");
		return textResult(await apiBackend.readImage(path));
	}
);

// ── Podcast tools (API backend only) ──────────────────────────────

server.tool(
	"podcast_search",
	"搜索播客。输入关键词，返回匹配的播客列表（名称、作者、Feed URL）。需要 Obsidian API 后端。",
	{
		query: z.string().describe("搜索关键词，如 'AI news' 或 '硬地骇客'"),
		limit: z.number().optional().default(10).describe("返回结果数量（默认 10）"),
	},
	async ({ query, limit }) => {
		if (!apiBackend) return textResult("Error: podcast_search requires Obsidian API backend");
		return textResult(await apiBackend.podcastSearch(query, limit));
	}
);

server.tool(
	"podcast_episodes",
	"获取播客最近的剧集列表。传入 RSS feed URL，返回最近的剧集信息。需要 Obsidian API 后端。",
	{
		url: z.string().describe("播客 RSS feed URL"),
		limit: z.number().optional().default(5).describe("返回剧集数量（默认 5）"),
	},
	async ({ url, limit }) => {
		if (!apiBackend) return textResult("Error: podcast_episodes requires Obsidian API backend");
		return textResult(await apiBackend.podcastEpisodes(url, limit));
	}
);

server.tool(
	"podcast_transcript",
	"获取播客剧集的文字稿。支持 YouTube URL（直接提取字幕）或 RSS feed URL（提取指定剧集的 transcript）。需要 Obsidian API 后端。",
	{
		url: z.string().describe("YouTube 视频 URL 或播客 RSS feed URL"),
		episode_index: z.number().optional().default(0).describe("RSS feed 中的剧集索引（0=最新，默认 0）"),
	},
	async ({ url, episode_index }) => {
		if (!apiBackend) return textResult("Error: podcast_transcript requires Obsidian API backend");
		return textResult(await apiBackend.podcastTranscript(url, episode_index));
	}
);

// ── Feed tools (API backend only) ───────────────────────────────────

server.tool(
	"fetch_feeds",
	"从配置的订阅源（RSS/HN/Reddit/GitHub Trending/Podcast）批量抓取最新文章，自动评分排序去重。返回结构化文章列表。需要 Obsidian API 后端。",
	{
		topics: z.string().optional().describe("关注主题（逗号分隔），用于相关性评分"),
		max_articles: z.number().optional().default(20).describe("返回最大文章数（默认 20）"),
		category: z.string().optional().describe("按分类筛选：research/engineering/community/tools/podcast/newsletter/industry"),
	},
	async ({ topics, max_articles, category }) => {
		if (!apiBackend) return textResult("Error: fetch_feeds requires Obsidian API backend");
		return textResult(await apiBackend.fetchFeeds(topics, max_articles, category));
	}
);

server.tool(
	"fetch_rss",
	"抓取指定 URL 的 RSS/Atom feed，返回文章列表。可用于抓取任意 RSS 源（不限于配置的订阅源）。需要 Obsidian API 后端。",
	{
		url: z.string().describe("RSS/Atom feed URL"),
		name: z.string().optional().describe("源名称（用于显示）"),
		limit: z.number().optional().default(10).describe("返回最大条目数（默认 10）"),
	},
	async ({ url, name, limit }) => {
		if (!apiBackend) return textResult("Error: fetch_rss requires Obsidian API backend");
		return textResult(await apiBackend.fetchRss(url, name, limit));
	}
);

// ── WeRead API gateway ──────────────────────────────────────────────

const WEREAD_API_KEY = process.env.WEREAD_API_KEY || "";
const WEREAD_GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const WEREAD_SKILL_VERSION = "1.0.3";
const MAX_WEREAD_CHARS = 20_000;

if (WEREAD_API_KEY) {
	server.tool(
		"weread_api",
		"调用微信读书 API。搜索书籍、获取书架、查看笔记划线、书评、阅读统计、推荐等。通过 api_name 指定接口，其余参数平铺传入。",
		{
			api_name: z.string().describe("API 路径，如 /store/search, /shelf/sync, /user/notebooks, /book/bookmarklist, /readdata/detail 等"),
			params: z.record(z.string(), z.unknown()).optional().describe("接口业务参数，如 {keyword: '三体', count: 10}"),
		},
		async ({ api_name, params }) => {
			try {
				const body = JSON.stringify({
					api_name,
					skill_version: WEREAD_SKILL_VERSION,
					...(params || {}),
				});
				const resp = await fetch(WEREAD_GATEWAY, {
					method: "POST",
					headers: {
						"Authorization": `Bearer ${WEREAD_API_KEY}`,
						"Content-Type": "application/json",
					},
					body,
				});
				const json = await resp.json();
				if (json?.errcode && json.errcode !== 0) {
					return textResult(`WeRead API error (${json.errcode}): ${json.errmsg || JSON.stringify(json)}`);
				}
				let text = JSON.stringify(json, null, 2);
				if (text.length > MAX_WEREAD_CHARS) {
					text = text.slice(0, MAX_WEREAD_CHARS) + `\n...(truncated, ${text.length} chars total)`;
				}
				return textResult(text);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return textResult(`Error calling WeRead API ${api_name}: ${msg}`);
			}
		}
	);
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
	await initBackend();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
