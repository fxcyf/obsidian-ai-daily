import { toolSummaryForPrompt } from "./tool-definitions";
import { WEREAD_SYSTEM_PROMPT, WEREAD_CLAUDE_CODE_PROMPT } from "./weread-prompts";
import type { HarnessContext } from "./harness-view";

export type ChatMode = "api" | "claude-code" | "proxy";

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

	if (config.mode === "claude-code" || config.mode === "proxy") {
		parts.push(
			"",
			"## MCP 工具使用说明",
			"你可以通过 MCP 工具操作 vault 中的笔记，路径使用 vault 内相对路径：",
			toolSummaryForPrompt(),
			"",
			"所有工具已预先授权，调用时无需用户确认权限。如果工具返回错误，直接说明错误原因，不要提示用户去批准权限或点击允许。",
		);

		if (config.vaultAbsPath) {
			parts.push(
				"",
				"## 图片处理",
				`Vault 绝对路径: ${config.vaultAbsPath}`,
				"当 read_note 返回的内容包含图片引用（如 `![[image.png]]` 或 `![](path/to/image.jpg)`）时，",
				"用 ReadFile 工具直接读取图片文件来查看内容。图片的绝对路径 = Vault绝对路径 + 图片相对路径。",
				`例如: \`![[attachments/photo.png]]\` → ReadFile(\`${config.vaultAbsPath}/attachments/photo.png\`)`,
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
		"回复中引用笔记时，请使用 [[笔记名]] 的 wiki-link 格式，以便用户可以直接点击跳转。",
		"当用户提到某篇笔记时，先用 search_vault 搜索，找到后用 read_note 读取。",
		"创建或编辑 Wiki 条目时，维护组织结构：复用已有 tags 避免同义重复，主动添加 [[wiki-link]] 关联相关条目，优先合并到已有条目而非创建重叠内容。",
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
