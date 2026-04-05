/**
 * Chat sidebar view — mobile-first UI.
 */

import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon } from "obsidian";
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
			// Ctrl/Cmd+Enter to send (mobile-friendly: don't hijack plain Enter)
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.handleSend();
			}
		});

		// New chat button in header
		const newChatBtn = container.createDiv({ cls: "ai-daily-new-chat" });
		newChatBtn.setText("新对话");
		newChatBtn.addEventListener("click", () => this.clearChat());

		this.showWelcome();
	}

	private showWelcome(): void {
		const activeFile = this.app.workspace.getActiveFile();
		const dailyFolder = this.plugin.settings.dailyFolder;

		let hint = "打开一篇日报后，可以直接提问。";
		if (activeFile?.path.startsWith(dailyFolder)) {
			hint = `已加载: ${activeFile.basename}。直接提问吧！`;
		}

		const welcomeEl = this.messagesEl.createDiv({
			cls: "ai-daily-welcome",
		});
		welcomeEl.innerHTML = `
			<div class="ai-daily-welcome-title">AI Daily Chat v0.1.1</div>
			<div class="ai-daily-welcome-hint">${hint}</div>
			<div class="ai-daily-welcome-examples">
				<div class="ai-daily-example">今天有什么值得关注的？</div>
				<div class="ai-daily-example">帮我总结最近一周的日报</div>
				<div class="ai-daily-example">RAG 相关的内容帮我梳理一下</div>
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
		const { apiKey, model, dailyFolder, contextDays } =
			this.plugin.settings;

		this.vaultTools = new VaultTools(this.app, dailyFolder);

		// Build system prompt with recent daily context
		const recentContext =
			await this.vaultTools.loadRecentContext(contextDays);

		const activeFile = this.app.workspace.getActiveFile();
		let currentNote = "";
		if (activeFile) {
			currentNote = await this.app.vault.cachedRead(activeFile);
		}

		const systemPrompt = [
			"你是一个 AI 日报阅读助手。用户正在 Obsidian 中阅读 AI 领域的日报。",
			"你可以使用工具来读取、搜索和写入 vault 中的笔记。",
			"回答用中文，简洁有深度。如果用户想保存某些内容，用 append_to_note 工具写回笔记。",
			"",
			currentNote
				? `## 当前打开的笔记\n\n文件: ${activeFile!.path}\n\n${currentNote}`
				: "",
			recentContext
				? `## 最近的日报\n\n${recentContext}`
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
