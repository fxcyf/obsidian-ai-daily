import { App, TFile, Notice } from "obsidian";
import { ClaudeClient, buildToolsArray } from "./claude";
import { VaultTools, parseFrontmatter } from "./vault-tools";

const MAX_NOTES_PER_RUN = 5;
const ORGANIZED_MARKER = "organized";

interface KnowledgeAgentOptions {
	apiKey: string;
	model: string;
	knowledgeFolders: string[];
	sourceFolder: string;
	targetFolder: string;
	onProgress?: (message: string) => void;
}

export async function runKnowledgeOrganizer(
	app: App,
	options: KnowledgeAgentOptions
): Promise<{ processed: number; total: number }> {
	const { apiKey, model, knowledgeFolders, sourceFolder, targetFolder, onProgress } = options;

	const unorganized = await findUnorganizedNotes(app, sourceFolder);
	if (unorganized.length === 0) {
		return { processed: 0, total: 0 };
	}

	const batch = unorganized.slice(0, MAX_NOTES_PER_RUN);
	const total = unorganized.length;

	onProgress?.(`找到 ${total} 篇待整理笔记，本次处理 ${batch.length} 篇`);

	const vaultTools = new VaultTools(app, knowledgeFolders);
	let processed = 0;

	for (const file of batch) {
		onProgress?.(`[${processed + 1}/${batch.length}] 正在整理: ${file.path}`);

		try {
			await organizeNote(app, file, vaultTools, {
				apiKey,
				model,
				knowledgeFolders,
				targetFolder,
			});
			processed++;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error(`[ai-daily] organize failed for ${file.path}:`, msg);
			onProgress?.(`整理失败: ${file.path} — ${msg}`);
		}
	}

	return { processed, total };
}

async function findUnorganizedNotes(app: App, folder: string): Promise<TFile[]> {
	return app.vault.getMarkdownFiles().filter((f) => {
		if (!f.path.startsWith(folder + "/") && f.path !== folder) return false;
		const cache = app.metadataCache.getFileCache(f);
		if (cache?.frontmatter?.[ORGANIZED_MARKER] === true) return false;
		return true;
	});
}

async function organizeNote(
	app: App,
	file: TFile,
	vaultTools: VaultTools,
	opts: { apiKey: string; model: string; knowledgeFolders: string[]; targetFolder: string }
): Promise<void> {
	const content = await app.vault.cachedRead(file);
	const { frontmatter } = parseFrontmatter(content);

	if (content.replace(/^---[\s\S]*?---\n?/, "").trim().length < 50) {
		return;
	}

	const allFolders = opts.knowledgeFolders.join("、");
	const systemPrompt = `你是一个知识库整理 Agent。你的任务是将 Raw/ 文件夹中的笔记整理到 ${opts.targetFolder}/ 文件夹中。

你可以使用工具来搜索、读取、创建和编辑笔记。

整理流程：
1. 仔细阅读笔记内容，提取核心观点和关键概念
2. 使用 search_vault 在 ${opts.targetFolder}/ 中搜索相关的已有 Wiki 条目
3. 如果找到相关 Wiki 条目：用 edit_note 补充新信息，添加指向原笔记的 wiki-link
4. 如果没有相关条目：用 create_note 在 ${opts.targetFolder}/ 中创建新条目
5. 新建的 Wiki 条目必须包含：
   - frontmatter: tags、summary
   - 正文中引用原始笔记的 wiki-link（如 [[${file.basename}]]）
   - 结构清晰的 Markdown 内容
6. 最后用 update_frontmatter 将原笔记标记为 organized: true

知识库文件夹: ${allFolders}
目标文件夹: ${opts.targetFolder}

重要约束：
- 只整理内容，不要删除原笔记
- Wiki 条目标题要简洁、概念化
- 优先复用已有标签体系
- 所有操作用中文`;

	const userMessage = `请整理以下笔记：

文件路径: ${file.path}
${frontmatter.tags ? `标签: ${Array.isArray(frontmatter.tags) ? frontmatter.tags.join(", ") : frontmatter.tags}` : ""}
${frontmatter.summary ? `摘要: ${frontmatter.summary}` : ""}

内容:
${content.slice(0, 8000)}`;

	const client = new ClaudeClient(opts.apiKey, opts.model, systemPrompt, {
		streamMode: "off",
		enableWebSearch: false,
	});

	await client.chat(
		userMessage,
		(name, input) => vaultTools.execute(name, input)
	);
}

export async function distillConversation(
	app: App,
	messages: { role: string; content: string }[],
	opts: {
		apiKey: string;
		model: string;
		knowledgeFolders: string[];
		targetFolder: string;
	}
): Promise<string> {
	const vaultTools = new VaultTools(app, opts.knowledgeFolders);
	const allFolders = opts.knowledgeFolders.join("、");

	const systemPrompt = `你是一个知识蒸馏 Agent。你的任务是从对话历史中提取有价值的事实性知识，保存为 Wiki 条目。

你可以使用工具来搜索、读取、创建和编辑笔记。

蒸馏流程：
1. 分析对话历史，识别有价值的事实性知识（排除闲聊、问候等）
2. 对每个知识点，用 search_vault 搜索 ${opts.targetFolder}/ 中是否已有相关条目
3. 已有条目：用 edit_note 补充新知识
4. 没有条目：用 create_note 在 ${opts.targetFolder}/ 中创建新条目
5. 每个条目必须有 frontmatter（tags、summary）和 wiki-link 关联

知识库文件夹: ${allFolders}
目标文件夹: ${opts.targetFolder}

重要约束：
- 只提取事实性、可复用的知识，跳过纯闲聊
- Wiki 条目标题简洁、概念化
- 内容用中文，结构清晰`;

	const conversationText = messages
		.filter((m) => m.content.length > 0)
		.map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
		.join("\n\n");

	const userMessage = `请从以下对话中提取知识并保存为 Wiki 条目：

${conversationText.slice(0, 12000)}

完成后，请简要说明你提取了哪些知识、创建或更新了哪些条目。`;

	const client = new ClaudeClient(opts.apiKey, opts.model, systemPrompt, {
		streamMode: "off",
		enableWebSearch: false,
	});

	return client.chat(
		userMessage,
		(name, input) => vaultTools.execute(name, input)
	);
}
