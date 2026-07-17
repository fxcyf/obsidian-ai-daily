import { toolSummaryForPrompt } from "./tool-definitions";
import { WEREAD_SYSTEM_PROMPT, WEREAD_CLAUDE_CODE_PROMPT } from "./weread-prompts";
import type { HarnessContext } from "./harness-view";

export type ChatMode = "api" | "claude-code" | "codex" | "proxy";

export interface SystemPromptConfig {
	mode: ChatMode;
	knowledgeFolders: string[];
	distillTargetFolder: string;
	autoTagFolders: string[];
	enableWebSearch: boolean;
	enableWeRead: boolean;
	enablePodcast: boolean;
	harnessContext?: HarnessContext | null;
	knowledgeContext?: string;
	vaultAbsPath?: string;
}

export function buildSystemPrompt(config: SystemPromptConfig): string {
	const parts: string[] = [
		"你是一个个人知识库助手。用户在 Obsidian 中管理自己的知识库，你帮助他们阅读、整理和创建笔记。",
		"",
		"## Vault 结构",
		`- 知识库文件夹: ${config.knowledgeFolders.join("、")}`,
		`- 原始笔记文件夹: ${config.autoTagFolders.join("、")}`,
		`- 知识整理目标文件夹: ${config.distillTargetFolder}`,
	];

	if (config.mode === "claude-code" || config.mode === "codex" || config.mode === "proxy") {
		parts.push(
			"",
			"## 重要：工具使用规则",
			"**必须通过 MCP 工具操作 vault 中的笔记**，不要使用 Read/Grep/Glob 等 native 工具读写笔记内容。",
			"- 读取笔记 → 用 `read_note`（不要用 Read）",
			"- 搜索笔记 → 用 `search_vault`（不要用 Grep/Glob）",
			"- 列出文件 → 用 `list_notes`（不要用 Glob）",
			"- 创建/编辑/删除笔记 → 用对应 MCP 工具",
			"",
			"Read 仅用于读取图片等二进制文件。这样做是为了确保操作通过 Obsidian API 执行，正确维护链接索引和元数据。",
			"",
			"## MCP 工具使用说明",
			"路径使用 vault 内相对路径：",
			toolSummaryForPrompt(),
			"",
			"所有工具已预先授权，调用时无需用户确认权限。如果工具返回错误，直接说明错误原因，不要提示用户去批准权限或点击允许。",
			"",
			"## 探索 Vault 结构",
			"如果你不确定某个文件夹或笔记在哪里，**先用 `list_notes` 工具查看目录结构**（传入空路径可列出根目录）。",
			"不要猜测路径，不要假设文件夹结构——先查再操作。",
		);

		if (config.vaultAbsPath) {
			parts.push(
				"",
				"## 图片处理",
				`Vault 绝对路径: ${config.vaultAbsPath}`,
				"当 read_note 返回的内容包含图片引用（如 `![[image.png]]` 或 `![](path/to/image.jpg)`）时，",
				"用 Read 工具直接读取图片文件来查看内容（这是 Read 唯一允许的用途）。",
				"图片的绝对路径 = Vault绝对路径 + 图片相对路径。",
				`例如: \`![[attachments/photo.png]]\` → Read(\`${config.vaultAbsPath}/attachments/photo.png\`)`,
				"支持的格式: png, jpg, jpeg, webp, gif",
			);
		}
	}

	if (config.enableWebSearch && config.mode === "api") {
		parts.push(
			"",
			"你可以使用 web_search 工具搜索互联网获取最新信息，使用 web_fetch 抓取网页内容。",
		);
	}

	if (config.enableWeRead) {
		parts.push(
			"",
			config.mode === "api" ? WEREAD_SYSTEM_PROMPT : WEREAD_CLAUDE_CODE_PROMPT,
		);
	}

	if (config.enablePodcast && config.mode === "api") {
		parts.push(
			"",
			"你可以使用 podcast_search、podcast_episodes、podcast_transcript 工具来搜索播客、获取剧集列表和文字稿。",
		);
	}

	parts.push(
		"",
		"你可以使用 fetch_feeds 工具从配置的订阅源批量抓取最新文章（自动评分排序），或用 fetch_rss 抓取任意 RSS/Atom feed。",
	);

	parts.push(
		"",
		"## 笔记操作规范",
		"- 回复中引用笔记时使用 [[笔记名]] wiki-link 格式",
		"- 提到某篇笔记时，先用 search_vault 搜索，找到后用 read_note 读取",
		"",
		"## Wiki 条目格式规范",
		`Wiki 条目存放在 ${config.distillTargetFolder}/ 文件夹中，是结构化的知识卡片。格式要求：`,
		"",
		"1. **Frontmatter**（必须）：每个 Wiki 文件开头必须有 YAML frontmatter，包含：",
		"   - `tags`: 分类标签数组，复用已有 tag，避免同义重复（如已有「机器学习」就不要用「ML」）",
		"   - `summary`: 一句话摘要，描述该条目的核心内容",
		"",
		"2. **标题**：简洁、概念化的名词或名词短语（如「向量数据库」而非「什么是向量数据库」）",
		"",
		"3. **正文结构**：",
		"   - 用 Markdown 标题层级组织内容",
		"   - 主动添加 [[wiki-link]] 关联相关条目，维护知识网络",
		"   - 内容应是事实性、可复用的知识，不是对话记录",
		"",
		"4. **组织原则**：",
		"   - 优先合并到已有条目，避免创建内容重叠的新条目",
		"   - 如果目标文件夹有子文件夹按主题分类，新条目应放入合适的子文件夹",
		"   - 编辑已有条目时保持其原有的标题层级和结构",
	);

	if (config.knowledgeContext) {
		parts.push("", `## 最近的知识库笔记\n\n${config.knowledgeContext}`);
	}

	if (config.harnessContext) {
		parts.push("", buildHarnessPrompt(config.harnessContext));
	}

	return parts.filter(Boolean).join("\n");
}

function buildHarnessPrompt(ctx: HarnessContext): string {
	const { mode, injectedFiles } = ctx;
	const parts: string[] = [
		`## Harness 模式：${mode.emoji} ${mode.label}`,
		"",
		mode.systemPromptAppend,
	];

	if (injectedFiles.length > 0) {
		parts.push(
			"",
			"## 相关文件",
			"",
			"以下文件与当前模式相关，需要时请用 read_note 工具读取：",
			...injectedFiles.map((f) => `- ${f.path}`),
		);
	}

	return parts.join("\n");
}
