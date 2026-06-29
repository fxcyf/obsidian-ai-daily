export interface ToolParam {
	type: string;
	description: string;
	enum?: string[];
	items?: { type: string };
}

export interface ToolDef {
	name: string;
	description: string;
	parameters: Record<string, ToolParam & { required?: boolean }>;
}

// ── Vault tools ────────────────────────────────────────────────────

export const TOOL_DEFS: ToolDef[] = [
	{
		name: "read_note",
		description: "读取 vault 中指定路径的笔记全文。可用于读取日报、采集的文章（Raw/）、整理的知识条目（Wiki/）等。",
		parameters: {
			path: { type: "string", description: "笔记路径，如 Raw/some-article.md 或 Wiki/concept.md", required: true },
		},
	},
	{
		name: "search_vault",
		description: "在 vault 中搜索笔记。支持关键词全文搜索，可按文件夹和标签过滤。用于在知识库中查找相关内容。",
		parameters: {
			query: { type: "string", description: "搜索关键词", required: true },
			folder: { type: "string", description: "限定搜索的文件夹路径，如 Raw、Wiki（可选）" },
			tag: { type: "string", description: "按标签过滤，如 ai、rag（匹配 frontmatter 中的 tags）" },
		},
	},
	{
		name: "append_to_note",
		description: "将内容追加到指定笔记末尾。用于将对话中的洞察、总结写回笔记。",
		parameters: {
			path: { type: "string", description: "笔记路径", required: true },
			content: { type: "string", description: "要追加的 Markdown 内容", required: true },
		},
	},
	{
		name: "list_notes",
		description: "列出指定文件夹中的笔记，按修改时间排序。不指定文件夹则列出所有知识库文件夹的笔记。",
		parameters: {
			folder: { type: "string", description: "文件夹路径，如 Raw、Wiki（可选）" },
			limit: { type: "number", description: "返回最近几篇（默认 20）" },
		},
	},
	{
		name: "create_note",
		description: "创建一篇新笔记。支持传入 frontmatter 对象，自动生成 YAML 头。会自动创建中间目录。路径已存在则报错。",
		parameters: {
			path: { type: "string", description: "笔记路径，如 Wiki/concept.md", required: true },
			content: { type: "string", description: "笔记正文内容（Markdown）", required: true },
			frontmatter: { type: "object", description: "可选的 frontmatter 对象，如 {tags: ['ai'], summary: '...'}" },
		},
	},
	{
		name: "edit_note",
		description: "编辑笔记中的指定部分。支持三种定位模式：search_replace（按原文匹配替换，最精确）、heading（替换整个标题 section）、line_range（按行号范围替换）。",
		parameters: {
			path: { type: "string", description: "笔记路径", required: true },
			mode: { type: "string", description: "定位模式", enum: ["heading", "line_range", "search_replace"], required: true },
			target: { type: "string", description: "search_replace/heading 模式传字符串，line_range 模式传 {start, end} 行号对象（从 1 开始）", required: true },
			replacement: { type: "string", description: "替换后的新内容", required: true },
		},
	},
	{
		name: "rename_note",
		description: "重命名或移动笔记到新路径。Obsidian 会自动更新所有反向链接引用。目标路径不能已存在。",
		parameters: {
			path: { type: "string", description: "当前笔记路径", required: true },
			new_path: { type: "string", description: "新路径，如 Wiki/new-name.md", required: true },
		},
	},
	{
		name: "delete_note",
		description: "删除笔记（两步确认）。第一次调用返回笔记预览和确认提示，需要带 confirmed: true 再次调用才会执行删除。文件会被移到系统回收站。",
		parameters: {
			path: { type: "string", description: "笔记路径", required: true },
			confirmed: { type: "boolean", description: "设为 true 确认删除" },
		},
	},
	{
		name: "get_links",
		description: "获取笔记的双向链接关系。返回 outlinks（该笔记链接到的）和 backlinks（链接到该笔记的）。用于理解笔记间的关系和知识图谱结构。",
		parameters: {
			path: { type: "string", description: "笔记路径，如 Wiki/concept.md", required: true },
		},
	},
	{
		name: "update_frontmatter",
		description: "修改笔记的 YAML frontmatter。支持设置（set）和删除（delete）字段。没有 frontmatter 则自动创建。",
		parameters: {
			path: { type: "string", description: "笔记路径", required: true },
			set: { type: "object", description: "要设置/覆盖的字段，如 {tags: ['ai', 'rag'], summary: '...'}" },
			delete: { type: "array", description: "要删除的字段名列表，如 ['draft', 'temp']", items: { type: "string" } },
		},
	},
	{
		name: "read_image",
		description: "读取 vault 中的图片文件并返回图片内容（自动压缩）。当笔记中包含图片引用（如 ![[photo.png]]）时使用。支持 png/jpg/jpeg/webp/gif 格式。每轮对话最多读取 5 张图片。",
		parameters: {
			path: { type: "string", description: "图片在 vault 中的相对路径，如 attachments/photo.png", required: true },
		},
	},
];

export const PODCAST_TOOL_DEFS: ToolDef[] = [
	{
		name: "podcast_search",
		description: "搜索播客节目。通过 iTunes API 搜索，返回播客名称、作者和 RSS feed URL。",
		parameters: {
			query: { type: "string", description: "搜索关键词，如 'AI agents' 或 'Lex Fridman'", required: true },
			limit: { type: "number", description: "返回结果数量，默认 10" },
		},
	},
	{
		name: "podcast_episodes",
		description: "获取播客最新剧集列表。输入 RSS feed URL，返回最近几期的标题、日期、时长和链接。",
		parameters: {
			url: { type: "string", description: "播客 RSS feed URL", required: true },
			limit: { type: "number", description: "返回剧集数量，默认 5" },
		},
	},
	{
		name: "podcast_transcript",
		description: "获取播客某一期的文字稿/transcript。支持 RSS feed URL（默认最新一期）或直接传入 YouTube 视频链接。优先从 RSS 内容提取，其次尝试 YouTube 字幕。",
		parameters: {
			url: { type: "string", description: "播客 RSS feed URL 或 YouTube 视频链接", required: true },
			episode_index: { type: "number", description: "剧集索引（0 = 最新一期），仅在 url 为 RSS feed 时有效" },
		},
	},
];

export const WEB_FETCH_TOOL_DEF: ToolDef = {
	name: "web_fetch",
	description: "抓取指定 URL 的网页内容，返回纯文本。用于阅读搜索结果中的具体页面、文章或文档。",
	parameters: {
		url: { type: "string", description: "要抓取的完整 URL", required: true },
	},
};

export const WEREAD_TOOL_DEF: ToolDef = {
	name: "weread_api",
	description: "调用微信读书 API。搜索书籍、获取书架、查看笔记划线、书评、阅读统计、推荐等。通过 api_name 指定接口，其余参数平铺传入。",
	parameters: {
		api_name: { type: "string", description: "API 路径，如 /store/search, /shelf/sync, /user/notebooks, /book/bookmarklist, /readdata/detail 等", required: true },
	},
};

// ── Converters ─────────────────────────────────────────────────────

export function toAnthropicTool(def: ToolDef): Record<string, unknown> {
	const properties: Record<string, Record<string, unknown>> = {};
	const required: string[] = [];
	for (const [key, param] of Object.entries(def.parameters)) {
		const { required: isReq, ...rest } = param;
		properties[key] = rest;
		if (isReq) required.push(key);
	}
	return {
		name: def.name,
		description: def.description,
		input_schema: {
			type: "object" as const,
			properties,
			required,
			...(def.name === "weread_api" ? { additionalProperties: true } : {}),
		},
	};
}

export function toClaudeCodeDescription(def: ToolDef): string {
	const params = Object.entries(def.parameters)
		.map(([k, v]) => `${k}: ${v.description}`)
		.join("，");
	return `- ${def.name}: ${def.description.split("。")[0]}（${params}）`;
}

export function toolSummaryForPrompt(): string {
	return TOOL_DEFS.map(d => toClaudeCodeDescription(d)).join("\n");
}
