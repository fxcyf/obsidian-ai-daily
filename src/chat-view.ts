/**
 * Chat sidebar view — mobile-first UI.
 */

import {
	ItemView,
	WorkspaceLeaf,
	MarkdownRenderer,
	setIcon,
	Platform,
	Notice,
} from "obsidian";
import type AIDailyChat from "./main";
import { ClaudeClient, estimateTextTokens } from "./claude";
import { VaultTools } from "./vault-tools";
import {
	newSessionId,
	titleFromMessages,
	saveChatSession,
	loadChatSession,
	listChatSessions,
	pruneOldSessions,
	type ChatSessionFile,
	type PersistedMessage,
} from "./chat-session";

export const VIEW_TYPE = "ai-daily-chat";

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

function formatTokenK(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(Math.round(n));
}

export class ChatView extends ItemView {
	plugin: AIDailyChat;
	private messages: ChatMessage[] = [];
	private client: ClaudeClient | null = null;
	private vaultTools: VaultTools | null = null;
	private messagesEl: HTMLElement = null!;
	private inputEl: HTMLTextAreaElement = null!;
	private tokenBarEl: HTMLElement = null!;
	private historyOverlay: HTMLElement | null = null;
	private isLoading = false;
	/** Current vault session file id (filename stem). */
	private sessionId: string | null = null;

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
		const {
			chatHistoryFolder,
			chatHistoryRetentionDays,
		} = this.plugin.settings;
		try {
			await pruneOldSessions(
				this.app.vault,
				chatHistoryFolder,
				chatHistoryRetentionDays
			);
		} catch {
			/* ignore */
		}

		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("ai-daily-chat-container");

		const header = container.createDiv({ cls: "ai-daily-header" });

		const feedBtn = header.createDiv({ cls: "ai-daily-header-btn" });
		feedBtn.setText("生成 Feed");
		feedBtn.addEventListener("click", () => this.plugin.generateFeed());

		const historyBtn = header.createDiv({ cls: "ai-daily-header-btn" });
		historyBtn.setText("历史");
		historyBtn.addEventListener("click", () => this.openHistoryPanel());

		const newChatBtn = header.createDiv({ cls: "ai-daily-header-btn" });
		newChatBtn.setText("新对话");
		newChatBtn.addEventListener("click", () => this.clearChat());

		this.messagesEl = container.createDiv({ cls: "ai-daily-messages" });

		this.tokenBarEl = container.createDiv({ cls: "ai-daily-token-bar" });
		this.updateTokenBar();

		const inputArea = container.createDiv({ cls: "ai-daily-input-area" });

		this.inputEl = inputArea.createEl("textarea", {
			cls: "ai-daily-input",
			attr: { placeholder: "问点什么...", rows: "2" },
		});

		const sendBtn = inputArea.createEl("button", {
			cls: "ai-daily-send-btn",
		});
		setIcon(sendBtn, "send");

		sendBtn.addEventListener("click", () => this.handleSend());
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				if (Platform.isMobile) return;
				if (!e.shiftKey) {
					e.preventDefault();
					this.handleSend();
				}
			}
		});

		this.showWelcome();
	}

	private updateTokenBar(): void {
		const budget = this.plugin.settings.chatContextBudgetTokens;
		let used = 0;
		if (this.client) {
			used = this.client.estimateContextTokens();
		} else {
			for (const m of this.messages) {
				used += estimateTextTokens(m.content);
			}
		}
		const pct = Math.min(100, budget > 0 ? (used / budget) * 100 : 0);
		this.tokenBarEl.empty();
		this.tokenBarEl.createDiv({
			cls: "ai-daily-token-bar-inner",
			attr: {
				style: `--ai-token-pct:${pct}%;`,
			},
		});
		this.tokenBarEl.createSpan({
			cls: "ai-daily-token-bar-label",
			text: `约 ${formatTokenK(used)} / ${formatTokenK(budget)} tokens（估算）`,
		});
	}

	private showWelcome(): void {
		const activeFile = this.app.workspace.getActiveFile();
		const { dailyFolder, knowledgeFolders } = this.plugin.settings;
		const allFolders = [dailyFolder, ...knowledgeFolders];

		let hint = "打开任意笔记，或直接提问来探索你的知识库。";
		if (activeFile) {
			const inKnowledge = allFolders.some((f) =>
				activeFile.path.startsWith(f)
			);
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

		welcomeEl.querySelectorAll(".ai-daily-example").forEach((el) => {
			el.addEventListener("click", () => {
				this.inputEl.value = el.textContent || "";
				this.handleSend();
			});
		});
		this.updateTokenBar();
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

		if (!this.sessionId) {
			this.sessionId = newSessionId();
		}

		if (!this.client) {
			await this.initClient();
		}

		this.isLoading = true;
		const loadingEl = this.messagesEl.createDiv({
			cls: "ai-daily-loading",
		});
		loadingEl.setText("思考中...");

		const useStream = this.plugin.settings.chatStreaming;

		let assistantEl: HTMLElement | null = null;
		if (useStream) {
			assistantEl = this.messagesEl.createDiv({
				cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming",
			});
		}

		try {
			const reply = await this.client!.chat(
				text,
				(name, input) => this.vaultTools!.execute(name, input),
				useStream && assistantEl
					? (_delta, accumulated) => {
							loadingEl.remove();
							// Show plain text while streaming; full Markdown rendered at the end.
							assistantEl!.setText(accumulated);
							this.messagesEl.scrollTop =
								this.messagesEl.scrollHeight;
						}
					: undefined
			);

			loadingEl.remove();

			if (useStream && assistantEl) {
				// Final render as Markdown.
				assistantEl.empty();
				await MarkdownRenderer.render(
					this.app,
					reply,
					assistantEl,
					"",
					this.plugin
				);
				assistantEl.removeClass("ai-daily-msg-streaming");
				this.messages.push({ role: "assistant", content: reply });
			} else {
				this.addMessage("assistant", reply);
			}
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

			await this.persistSession();
			this.updateTokenBar();
		} catch (e) {
			loadingEl.remove();
			if (assistantEl) assistantEl.remove();
			const msg = e instanceof Error ? e.message : String(e);
			this.addMessage("assistant", `出错了: ${msg}`);
		} finally {
			this.isLoading = false;
			this.updateTokenBar();
		}
	}

	private async initClient(): Promise<void> {
		const {
			apiKey,
			model,
			dailyFolder,
			knowledgeFolders,
			contextDays,
			chatStreaming,
			chatCompressThresholdEst,
		} = this.plugin.settings;

		this.vaultTools = new VaultTools(this.app, dailyFolder, knowledgeFolders);

		const recentContext = await this.vaultTools.loadRecentContext(contextDays);
		const knowledgeContext = await this.vaultTools.loadKnowledgeContext(5);

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
			recentContext ? `## 最近的日报\n\n${recentContext}` : "",
			knowledgeContext ? `## 最近的知识库笔记\n\n${knowledgeContext}` : "",
		]
			.filter(Boolean)
			.join("\n\n");

		this.client = new ClaudeClient(apiKey, model, systemPrompt, {
			stream: chatStreaming,
			compressThresholdEst: chatCompressThresholdEst,
			onCompress: (detail) => {
				new Notice(detail, 6000);
			},
		});
	}

	private async persistSession(): Promise<void> {
		if (!this.sessionId) {
			console.debug("[ai-daily] persist skipped (no sessionId)");
			return;
		}
		const { chatHistoryFolder, model } = this.plugin.settings;
		const now = new Date().toISOString();
		const persisted: PersistedMessage[] = this.messages.map((m) => ({
			role: m.role,
			content: m.content,
		}));
		const existing = await loadChatSession(
			this.app.vault,
			chatHistoryFolder,
			this.sessionId
		);
		const file: ChatSessionFile = {
			id: this.sessionId,
			title: titleFromMessages(persisted),
			model,
			created: existing?.created ?? now,
			updated: now,
			messages: persisted,
		};
		const relPath = `${chatHistoryFolder}/${this.sessionId}.json`;
		try {
			await saveChatSession(this.app.vault, chatHistoryFolder, file);
			console.info(
				`[ai-daily] chat session saved (${persisted.length} messages) → ${relPath}`
			);
		} catch (e) {
			console.error("[ai-daily] persist session failed", e);
			new Notice(
				`对话存档失败: ${e instanceof Error ? e.message : String(e)}`,
				6000
			);
		}
	}

	private addMessage(role: "user" | "assistant", content: string): void {
		const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
		if (welcome) welcome.remove();

		this.messages.push({ role, content });

		const msgEl = this.messagesEl.createDiv({
			cls: `ai-daily-msg ai-daily-msg-${role}`,
		});

		if (role === "assistant") {
			void MarkdownRenderer.render(
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
		this.updateTokenBar();
	}

	sendMessage(text: string): void {
		this.inputEl.value = text;
		void this.handleSend();
	}

	private clearChat(): void {
		this.sessionId = null;
		this.messages = [];
		this.client = null;
		this.vaultTools = null;
		this.messagesEl.empty();
		this.showWelcome();
	}

	private async openHistoryPanel(): Promise<void> {
		if (this.historyOverlay) {
			this.historyOverlay.remove();
			this.historyOverlay = null;
		}
		const { chatHistoryFolder } = this.plugin.settings;
		let sessions = await listChatSessions(this.app.vault, chatHistoryFolder);

		const overlay = this.messagesEl.createDiv({ cls: "ai-daily-history-overlay" });
		this.historyOverlay = overlay;

		const head = overlay.createDiv({ cls: "ai-daily-history-head" });
		head.createEl("span", { text: "历史对话", cls: "ai-daily-history-title" });
		const closeBtn = head.createSpan({ cls: "ai-daily-history-close", text: "✕" });
		closeBtn.addEventListener("click", () => {
			overlay.remove();
			this.historyOverlay = null;
		});

		const search = overlay.createEl("input", {
			cls: "ai-daily-history-search",
			type: "search",
			attr: { placeholder: "搜索标题…" },
		});

		const listEl = overlay.createDiv({ cls: "ai-daily-history-list" });

		const renderList = (items: ChatSessionFile[]) => {
			listEl.empty();
			for (const s of items) {
				const row = listEl.createDiv({ cls: "ai-daily-history-row" });
				row.createDiv({
					cls: "ai-daily-history-row-title",
					text: s.title || s.id,
				});
				row.createDiv({
					cls: "ai-daily-history-row-meta",
					text: `${s.updated?.slice(0, 16) ?? ""} · ${s.model}`,
				});
				row.addEventListener("click", () => {
					void this.loadSession(s.id);
					overlay.remove();
					this.historyOverlay = null;
				});
			}
			if (items.length === 0) {
				listEl.createDiv({
					cls: "ai-daily-history-empty",
					text: "暂无历史会话",
				});
			}
		};

		renderList(sessions);

		search.addEventListener("input", () => {
			const q = search.value.trim().toLowerCase();
			if (!q) {
				renderList(sessions);
				return;
			}
			renderList(
				sessions.filter(
					(s) =>
						s.title.toLowerCase().includes(q) ||
						s.id.toLowerCase().includes(q)
				)
			);
		});

		overlay.addEventListener("click", (ev) => {
			if (ev.target === overlay) {
				overlay.remove();
				this.historyOverlay = null;
			}
		});

		sessions = await listChatSessions(this.app.vault, chatHistoryFolder);
		renderList(sessions);
	}

	private async loadSession(id: string): Promise<void> {
		const { chatHistoryFolder } = this.plugin.settings;
		const data = await loadChatSession(this.app.vault, chatHistoryFolder, id);
		if (!data || !data.messages?.length) {
			new Notice("无法加载该会话");
			return;
		}
		this.sessionId = data.id;
		this.messages = data.messages.map((m) => ({
			role: m.role,
			content: m.content,
		}));
		this.client = null;
		this.vaultTools = null;
		this.messagesEl.empty();
		const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
		if (welcome) welcome.remove();
		for (const m of this.messages) {
			const msgEl = this.messagesEl.createDiv({
				cls: `ai-daily-msg ai-daily-msg-${m.role}`,
			});
			if (m.role === "assistant") {
				await MarkdownRenderer.render(
					this.app,
					m.content,
					msgEl,
					"",
					this.plugin
				);
			} else {
				msgEl.setText(m.content);
			}
		}
		await this.initClient();
		this.client!.setHistoryFromStrings(
			this.messages.map((m) => ({
				role: m.role,
				content: m.content,
			}))
		);
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		this.updateTokenBar();
		new Notice("已恢复历史对话", 3000);
	}

	async onClose(): Promise<void> {
		// nothing to clean up
	}
}
