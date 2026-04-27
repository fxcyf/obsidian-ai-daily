import { App, TFile } from "obsidian";
import { ClaudeClient } from "./claude";
import { VaultTools } from "./vault-tools";

export const MAX_NOTES_PER_RUN = 5;
const ORGANIZED_MARKER = "organized";

export async function findUnorganizedNotes(app: App, folder: string): Promise<TFile[]> {
	return app.vault.getMarkdownFiles().filter((f) => {
		if (!f.path.startsWith(folder + "/") && f.path !== folder) return false;
		const cache = app.metadataCache.getFileCache(f);
		if (cache?.frontmatter?.[ORGANIZED_MARKER] === true) return false;
		return true;
	});
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
