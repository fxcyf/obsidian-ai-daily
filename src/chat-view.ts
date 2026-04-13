/**
 * Chat sidebar view — mobile-first UI.
 */

import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon, Platform } from "obsidian";
import type AIDailyChat from "./main";
import { ClaudeClient } from "./claude";
import { VaultTools } from "./vault-tools";

export const VIEW_TYPE = "ai-daily-chat";

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

export class ChatView extends ItemView {
	plugin: AIDailyChat;
	private messages: ChatMessage[] = [];
	private client: ClaudeClient | null = null;
	private vaultTools: VaultTools | null = null;
	private messagesEl: HTMLElement = null!;
	private inputEl: HTMLTextAreaElement = null!;
	private isLoading = false;

	constructor(leaf: WorkspaceLeaf, plugin: AIDailyChat) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "AI Daily Chat";
	}

	getIcon(): string {
		return "message-circle";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("ai-daily-chat-container");

		// Header with buttons
		const header = container.createDiv({ cls: "ai-daily-header" });

		const feedBtn = header.createDiv({ cls: "ai-daily-header-btn" });
		feedBtn.setText("生成 Feed");
		feedBtn.addEventListener("click", () => this.plugin.generateFeed());

		const newChatBtn = header.createDiv({ cls: "ai-daily-header-btn" });
		newChatBtn.setText("新对话");
		newChatBtn.addEventListener("click", () => this.clearChat());

		// Messages area
		this.messagesEl = container.createDiv({ cls: "ai-daily-messages" });

		// Input area
		const inputArea = container.createDiv({ cls: "ai-daily-input-area" });

		this.inputEl = inputArea.createEl("textarea", {
			cls: "ai-daily-input",
			attr: { placeholder: "问点什么...", rows: "2" },
		});

		const sendBtn = inputArea.createEl("button", {
			cls: "ai-daily-send-btn",
		});
		setIcon(sendBtn, "send");

		// Events
		sendBtn.addEventListener("click", () => this.handleSend());
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				if (Platform.isMobile) {
					// Mobile: Enter = newline, only button sends
					return;
				}
				// PC: Enter sends, Shift+Enter = newline
				if (!e.shiftKey) {
					e.preventDefault();
					this.handleSend();
				}
			}
		});

		this.showWelcome();
	}

	private showWelcome(): void {
		const activeFile = this.app.workspace.getActiveFile();
		const { dailyFolder, knowledgeFolders } = this.plugin.settings;
		const allFolders = [dailyFolder, ...knowledgeFolders];

		let hint = "打开任意笔记，或直接提问来探索你的知识库。";
		if (activeFile) {
			const inKnowledge = allFolders.some((f) => activeFile.path.startsWith(f));
			if (inKnowledge) {
				hint = `已加载: ${activeFile.basename}。直接提问吧！`;
			} else {
				hint = `当前笔记: ${activeFile.basename}。可以对它提问。`;
			}
		}

		const welcomeEl = this.messagesEl.createDiv({
			cls: "ai-daily-welcome",
		});
		welcomeEl.innerHTML = `
			<div class="ai-daily-welcome-title">AI Knowledge Chat v0.2.0</div>
			<div class="ai-daily-welcome-hint">${hint}</div>
			<div class="ai-daily-welcome-examples">
				<div class="ai-daily-example">总结一下这篇文章的要点</div>
				<div class="ai-daily-example">帮我在知识库里搜索 RAG 相关内容</div>
				<div class="ai-daily-example">最近收藏了哪些文章？</div>
			</div>
		`;

		// Clickable examples
		welcomeEl.querySelectorAll(".ai-daily-example").forEach((el) => {
			el.addEventListener("click", () => {
				this.inputEl.value = el.textContent || "";
				this.handleSend();
			});
		});
	}

	private async handleSend(): Promise<void> {
		const text = this.inputEl.value.trim();
		if (!text || this.isLoading) return;

		if (!this.plugin.settings.apiKey) {
			this.addMessage(
				"assistant",
				"请先在插件设置中配置 Anthropic API Key。"
			);
			return;
		}

		this.inputEl.value = "";
		this.addMessage("user", text);

		// Initialize client on first message
		if (!this.client) {
			await this.initClient();
		}

		this.isLoading = true;
		const loadingEl = this.messagesEl.createDiv({
			cls: "ai-daily-loading",
		});
		loadingEl.setText("思考中...");

		try {
			const reply = await this.client!.chat(
				text,
				(name, input) => this.vaultTools!.execute(name, input)
			);
			loadingEl.remove();
			this.addMessage("assistant", reply);
		} catch (e) {
			loadingEl.remove();
			const msg = e instanceof Error ? e.message : String(e);
			this.addMessage("assistant", `出错了: ${msg}`);
		} finally {
			this.isLoading = false;
		}
	}

	private async initClient(): Promise<void> {
		const { apiKey, model, dailyFolder, knowledgeFolders, contextDays } =
			this.plugin.settings;

		this.vaultTools = new VaultTools(this.app, dailyFolder, knowledgeFolders);

		// Load contexts
		const recentContext =
			await this.vaultTools.loadRecentContext(contextDays);
		const knowledgeContext =
			await this.vaultTools.loadKnowledgeContext(5);

		const activeFile = this.app.workspace.getActiveFile();
		let currentNote = "";
		if (activeFile) {
			currentNote = await this.app.vault.cachedRead(activeFile);
		}

		const allFolders = [dailyFolder, ...knowledgeFolders].join("、");

		const systemPrompt = [
			"你是一个个人知识库助手。用户在 Obsidian 中管理自己的知识库，包括采集的原始文章（Raw/）、整理的知识条目（Wiki/）和每日笔记。",
			`知识库文件夹: ${allFolders}`,
			"你可以使用工具来读取、搜索、列出和写入 vault 中的笔记。支持按文件夹和标签（frontmatter tags）筛选搜索。",
			"回答用中文，简洁有深度。如果用户想保存洞察，用 append_to_note 工具写回笔记。",
			"",
			currentNote
				? `## 当前打开的笔记\n\n文件: ${activeFile!.path}\n\n${currentNote}`
				: "",
			recentContext
				? `## 最近的日报\n\n${recentContext}`
				: "",
			knowledgeContext
				? `## 最近的知识库笔记\n\n${knowledgeContext}`
				: "",
		]
			.filter(Boolean)
			.join("\n\n");

		this.client = new ClaudeClient(apiKey, model, systemPrompt);
	}

	private addMessage(role: "user" | "assistant", content: string): void {
		// Remove welcome if present
		const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
		if (welcome) welcome.remove();

		this.messages.push({ role, content });

		const msgEl = this.messagesEl.createDiv({
			cls: `ai-daily-msg ai-daily-msg-${role}`,
		});

		if (role === "assistant") {
			MarkdownRenderer.render(
				this.app,
				content,
				msgEl,
				"",
				this.plugin
			);
		} else {
			msgEl.setText(content);
		}

		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	/** Programmatically send a message (used by commands). */
	sendMessage(text: string): void {
		this.inputEl.value = text;
		this.handleSend();
	}

	private clearChat(): void {
		this.messages = [];
		this.client = null;
		this.messagesEl.empty();
		this.showWelcome();
	}

	async onClose(): Promise<void> {
		// cleanup
	}
}
