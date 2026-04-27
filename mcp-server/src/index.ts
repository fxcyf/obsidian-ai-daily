#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VaultOps, containsTraversal } from "./vault-ops.js";

const vaultRoot = process.env.VAULT_PATH;
if (!vaultRoot) {
	console.error("Error: VAULT_PATH environment variable is required");
	process.exit(1);
}

const knowledgeFolders = (process.env.KNOWLEDGE_FOLDERS || "Raw,Wiki")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

const vault = new VaultOps(vaultRoot, knowledgeFolders);
const server = new McpServer({
	name: "obsidian-vault",
	version: "0.1.0",
});

function pathGuard(p: string): string | null {
	if (!p) return "Error: path is required";
	if (containsTraversal(p)) return "Error: invalid path";
	return null;
}

server.tool(
	"read_note",
	"读取 vault 中指定路径的笔记全文。可用于读取日报、采集的文章（Raw/）、整理的知识条目（Wiki/）等。",
	{ path: z.string().describe("笔记路径，如 Raw/some-article.md 或 Wiki/concept.md") },
	async ({ path }) => {
		const err = pathGuard(path);
		if (err) return { content: [{ type: "text", text: err }] };
		const result = await vault.readNote(path);
		return { content: [{ type: "text", text: result }] };
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
		if (!query) return { content: [{ type: "text", text: "Error: query is required" }] };
		const result = await vault.searchVault(query, folder, tag);
		return { content: [{ type: "text", text: result }] };
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
		if (err) return { content: [{ type: "text", text: err }] };
		const result = await vault.appendToNote(path, content);
		return { content: [{ type: "text", text: result }] };
	}
);

server.tool(
	"list_notes",
	"列出指定文件夹中的笔记，按修改时间排序。不指定文件夹则列出所有知识库文件夹的笔记。",
	{
		folder: z.string().optional().describe("文件夹路径，如 Raw、Wiki"),
		limit: z.number().optional().default(20).describe("返回最近几篇（默认 20）"),
	},
	async ({ folder, limit }) => {
		const result = await vault.listNotes(folder, limit);
		return { content: [{ type: "text", text: result }] };
	}
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
		if (err) return { content: [{ type: "text", text: err }] };
		const result = await vault.createNote(path, content, frontmatter);
		return { content: [{ type: "text", text: result }] };
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
		if (err) return { content: [{ type: "text", text: err }] };
		const result = await vault.editNote(path, mode, target, replacement);
		return { content: [{ type: "text", text: result }] };
	}
);

server.tool(
	"rename_note",
	"重命名或移动笔记到新路径。目标路径不能已存在。",
	{
		path: z.string().describe("当前笔记路径"),
		new_path: z.string().describe("新路径，如 Wiki/new-name.md"),
	},
	async ({ path, new_path }) => {
		const err = pathGuard(path);
		if (err) return { content: [{ type: "text", text: err }] };
		const err2 = pathGuard(new_path);
		if (err2) return { content: [{ type: "text", text: err2 }] };
		const result = await vault.renameNote(path, new_path);
		return { content: [{ type: "text", text: result }] };
	}
);

server.tool(
	"delete_note",
	"删除笔记（两步确认）。第一次调用返回预览和确认提示，带 confirmed: true 再次调用才执行删除。文件移到 .trash 文件夹。",
	{
		path: z.string().describe("笔记路径"),
		confirmed: z.boolean().optional().default(false).describe("设为 true 确认删除"),
	},
	async ({ path, confirmed }) => {
		const err = pathGuard(path);
		if (err) return { content: [{ type: "text", text: err }] };
		const result = await vault.deleteNote(path, confirmed);
		return { content: [{ type: "text", text: result }] };
	}
);

server.tool(
	"get_links",
	"获取笔记的双向链接关系。返回 outlinks（该笔记链接到的）和 backlinks（链接到该笔记的）。",
	{
		path: z.string().describe("笔记路径，如 Wiki/concept.md"),
	},
	async ({ path }) => {
		const err = pathGuard(path);
		if (err) return { content: [{ type: "text", text: err }] };
		const result = await vault.getLinks(path);
		return { content: [{ type: "text", text: result }] };
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
		if (err) return { content: [{ type: "text", text: err }] };
		if (!set && !del) return { content: [{ type: "text", text: "Error: at least one of set or delete is required" }] };
		const result = await vault.updateFrontmatter(path, set, del);
		return { content: [{ type: "text", text: result }] };
	}
);

async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
