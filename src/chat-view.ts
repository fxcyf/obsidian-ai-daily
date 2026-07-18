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
	Modal,
	App,
	TFile,
	Menu,
} from "obsidian";
import type AIDailyChat from "./main";
import { ClaudeClient, estimateTextTokens, type ToolResultContent } from "./claude";
import { VaultTools, type UndoEntry } from "./vault-tools";
import { WebTools } from "./web-tools";
import { WeReadTools } from "./weread-tools";
import { PodcastTools } from "./podcast-tools";
import { FeedTools } from "./feed-tools";
import { buildSystemPrompt } from "./system-prompt";
import type { PromptTemplate } from "./settings";
import { loadProjectIndex, parseModesFromContent, resolveFileEntries, type HarnessContext } from "./harness-view";
import { WorkspaceStudio } from "./workspace-studio";
import { extractLocalImageRefs, prepareLocalImages } from "./image-tools";
import type { PreparedImage } from "./image-tools";
import { normalizeMarkdownForObsidian } from "./markdown-normalize";
import { distillConversation, prepareDistillation, prepareHealthFix, type HealthCheckResult } from "./knowledge-agent";
import { isClaudeCodeAvailable, spawnClaudeCode, getMcpServerPath, seedClaudeCodeSession, type UndoData } from "./claude-code";
import { isCodexAvailable, spawnCodex } from "./codex";
import {
	newSessionId,
	titleFromMessages,
	saveChatSession,
	loadChatSession,
	listChatSessions,
	deleteChatSessionFile,
	togglePinSession,
	renameSession,
	pruneOldSessions,
	type ChatSessionFile,
	type PersistedMessage,
	type MessageSource,
} from "./chat-session";

export const VIEW_TYPE = "ai-daily-chat";
const STREAM_MARKDOWN_RENDER_INTERVAL_MS = 120;

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	source?: MessageSource;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
	read_note: "读取笔记",
	search_vault: "搜索笔记",
	append_to_note: "追加内容",
	list_notes: "列出笔记",
	create_note: "创建笔记",
	edit_note: "编辑笔记",
	rename_note: "重命名笔记",
	delete_note: "删除笔记",
	get_links: "获取链接",
	update_frontmatter: "更新属性",
	read_image: "读取图片",
	web_search: "网络搜索",
	web_fetch: "抓取网页",
	weread_api: "微信读书",
};

function normalizeToolName(raw: string): string {
	const match = raw.match(/(?:mcp__[^_]+__)?(.+)/);
	return match ? match[1] : raw;
}

function toolCallSummary(name: string, input: Record<string, unknown>): string {
	const normalized = normalizeToolName(name);
	const label = TOOL_DISPLAY_NAMES[normalized] || normalized;
	const path = typeof input.path === "string" ? input.path : "";
	const query = typeof input.query === "string" ? input.query : "";
	if (path) return `${label}: ${path}`;
	if (query) return `${label}: ${query}`;
	return label;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function simpleDiff(before: string, after: string): string {
	const oldLines = before.split("\n");
	const newLines = after.split("\n");

	const lcs = lcsLines(oldLines, newLines);
	const result: string[] = [];
	let oi = 0, ni = 0, li = 0;

	while (oi < oldLines.length || ni < newLines.length) {
		if (li < lcs.length && oi < oldLines.length && ni < newLines.length &&
			oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
			oi++; ni++; li++;
		} else if (li < lcs.length && ni < newLines.length && newLines[ni] === lcs[li]) {
			result.push(`<span class="ai-daily-diff-del">- ${escapeHtml(oldLines[oi])}</span>`);
			oi++;
		} else if (li < lcs.length && oi < oldLines.length && oldLines[oi] === lcs[li]) {
			result.push(`<span class="ai-daily-diff-add">+ ${escapeHtml(newLines[ni])}</span>`);
			ni++;
		} else {
			if (oi < oldLines.length) {
				result.push(`<span class="ai-daily-diff-del">- ${escapeHtml(oldLines[oi])}</span>`);
				oi++;
			}
			if (ni < newLines.length) {
				result.push(`<span class="ai-daily-diff-add">+ ${escapeHtml(newLines[ni])}</span>`);
				ni++;
			}
		}
	}

	if (result.length > 40) {
		return result.slice(0, 40).join("\n") + `\n<span class="ai-daily-diff-more">…还有 ${result.length - 40} 行</span>`;
	}
	return result.join("\n");
}

function lcsLines(a: string[], b: string[]): string[] {
	const m = a.length, n = b.length;
	if (m > 500 || n > 500) {
		return [];
	}
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}
	const result: string[] = [];
	let i = m, j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			result.unshift(a[i - 1]);
			i--; j--;
		} else if (dp[i - 1][j] > dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}
	return result;
}

function formatTokenK(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(Math.round(n));
}

class ConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void;

	constructor(app: App, message: string, onConfirm: () => void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
		this.modalEl.addClass("ai-daily-modal-sm");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("p", { text: this.message });
		const btnRow = contentEl.createDiv({ cls: "ai-daily-confirm-btns" });
		const confirmBtn = btnRow.createEl("button", {
			text: "删除",
			cls: "mod-warning",
		});
		const cancelBtn = btnRow.createEl("button", { text: "取消" });
		confirmBtn.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});
		cancelBtn.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class RenameModal extends Modal {
	private currentTitle: string;
	private onRename: (newTitle: string) => void;

	constructor(app: App, currentTitle: string, onRename: (newTitle: string) => void) {
		super(app);
		this.currentTitle = currentTitle;
		this.onRename = onRename;
		this.modalEl.addClass("ai-daily-modal-sm");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("p", { text: "重命名对话" });
		const input = contentEl.createEl("input", {
			type: "text",
			cls: "ai-daily-rename-input",
			value: this.currentTitle,
		});
		input.style.width = "100%";
		input.style.marginBottom = "12px";
		const btnRow = contentEl.createDiv({ cls: "ai-daily-confirm-btns" });
		const confirmBtn = btnRow.createEl("button", { text: "确认", cls: "mod-cta" });
		const cancelBtn = btnRow.createEl("button", { text: "取消" });
		confirmBtn.addEventListener("click", () => {
			const v = input.value.trim();
			if (v) {
				this.onRename(v);
				this.close();
			}
		});
		cancelBtn.addEventListener("click", () => this.close());
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				const v = input.value.trim();
				if (v) {
					this.onRename(v);
					this.close();
				}
			}
		});
		setTimeout(() => { input.focus(); input.select(); }, 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ChatView extends ItemView {
	plugin: AIDailyChat;
	private closed = false;
	private chatContainerEl!: HTMLElement;
	private headerEl!: HTMLElement;
	private messages: ChatMessage[] = [];
	private client: ClaudeClient | null = null;
	private vaultTools: VaultTools | null = null;
	private webTools: WebTools = new WebTools();
	private wereadTools: WeReadTools | null = null;
	private podcastTools: PodcastTools | null = null;
	private feedTools: FeedTools | null = null;
	private messagesEl!: HTMLElement;
	private inputAreaEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private expandBtn!: HTMLButtonElement;
	private tokenBarEl!: HTMLElement;
	private historyOverlay: HTMLElement | null = null;
	private historyOverlayResizeCleanup: (() => void) | null = null;
	private templatePopupEl: HTMLElement | null = null;
	private isLoading = false;
	private userScrolledUp = false;
	private cachedTokenCount = 0;
	private sessionId: string | null = null;
	private lastMode: MessageSource | null = null;
	private attachedFiles: TFile[] = [];
	private attachBarEl: HTMLElement | null = null;
	private harnessContext: HarnessContext | null = null;
	private mentionPopupEl: HTMLElement | null = null;
	private mentionStartPos: number | null = null;
	private mentionCursorPos: number | null = null;
	private studioEl: HTMLElement | null = null;
	private moreBtnEl: HTMLElement | null = null;
	private studio: WorkspaceStudio | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AIDailyChat) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Cortex";
	}

	getIcon(): string {
		return "brain";
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
		this.chatContainerEl = container;

		this.buildHeader(container);

		this.messagesEl = container.createDiv({ cls: "ai-daily-messages" });
		this.messagesEl.addEventListener("scroll", () => {
			const el = this.messagesEl;
			this.userScrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 50;
		});

		this.tokenBarEl = container.createDiv({ cls: "ai-daily-token-bar" });
		this.updateTokenBar();

		this.buildInputArea(container);
		this.showWelcome();

		if (Platform.isMobile) {
			this.setupMobileKeyboard(container);
		}
	}

	private buildHeader(container: HTMLElement): void {
		this.headerEl = container.createDiv({ cls: "ai-daily-header" });

		if (Platform.isMobile) {
			const backBtn = this.headerEl.createDiv({
				cls: "ai-daily-header-btn",
				attr: { "aria-label": "返回", title: "返回" },
			});
			setIcon(backBtn, "arrow-left");
			backBtn.addEventListener("click", () => {
				this.leaf.detach();
			});
			const spacer = this.headerEl.createDiv();
			spacer.style.flex = "1";
		}

		const studioBtn = this.headerEl.createDiv({
			cls: "ai-daily-header-btn",
			attr: { "aria-label": "Workspace Studio", title: "Workspace Studio" },
		});
		setIcon(studioBtn, "layout-grid");
		studioBtn.addEventListener("click", () => this.toggleStudio());

		const newChatBtn = this.headerEl.createDiv({
			cls: "ai-daily-header-btn",
			attr: { "aria-label": "新对话", title: "新对话" },
		});
		setIcon(newChatBtn, "plus");
		newChatBtn.addEventListener("click", () => this.clearChat());

		this.moreBtnEl = this.headerEl.createDiv({
			cls: "ai-daily-header-btn",
			attr: { "aria-label": "更多", title: "更多" },
		});
		this.moreBtnEl.style.display = "none";
		setIcon(this.moreBtnEl, "more-vertical");
		this.moreBtnEl.addEventListener("click", (e) => {
			const menu = new Menu();
			const hasSession = !!this.sessionId;

			// — 对话操作 —
			menu.addItem((item) =>
				item.setTitle("保存为笔记").setIcon("file-down").setDisabled(!hasSession).onClick(() => this.saveSessionAsNote())
			);
			menu.addItem((item) =>
				item.setTitle("复制全文").setIcon("copy").setDisabled(!hasSession).onClick(() => this.copySessionText())
			);
			menu.addSeparator();

			// — 管理 —
			menu.addItem((item) =>
				item.setTitle("重命名").setIcon("pencil").setDisabled(!hasSession).onClick(() => this.renameCurrentSession())
			);
			menu.addItem((item) =>
				item.setTitle("置顶对话").setIcon("pin").setDisabled(!hasSession).onClick(() => this.togglePinCurrentSession())
			);
			menu.addSeparator();

			// — 全局 —
			menu.addItem((item) =>
				item.setTitle("历史").setIcon("history").onClick(() => this.openHistoryPanel())
			);
			menu.addItem((item) =>
				item.setTitle("蒸馏知识").setIcon("sparkles").onClick(() => {
					this.inputEl.value = "/distill";
					this.handleSend();
				})
			);
			menu.addSeparator();

			// — 危险 —
			menu.addItem((item) =>
				item.setTitle("删除对话").setIcon("trash-2").setDisabled(!hasSession).onClick(() => this.deleteCurrentSession())
			);

			menu.showAtMouseEvent(e);
		});
	}

	private buildInputArea(container: HTMLElement): void {
		this.inputAreaEl = container.createDiv({ cls: "ai-daily-input-area" });

		this.attachBarEl = this.inputAreaEl.createDiv({ cls: "ai-daily-attach-bar" });
		this.attachBarEl.style.display = "none";

		const inputRow = this.inputAreaEl.createDiv({ cls: "ai-daily-input-row" });

		const attachBtn = inputRow.createEl("button", {
			cls: "ai-daily-attach-btn",
			attr: { "aria-label": "添加笔记" },
		});
		setIcon(attachBtn, "paperclip");
		attachBtn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			this.openFilePicker();
		});

		const inputWrap = inputRow.createDiv({ cls: "ai-daily-input-wrap" });

		this.inputEl = inputWrap.createEl("textarea", {
			cls: "ai-daily-input",
			attr: { placeholder: "问点什么… @ 引用笔记，/ 选择模板", rows: "1" },
		});

		this.expandBtn = inputWrap.createEl("button", {
			cls: "ai-daily-expand-btn",
			attr: { "aria-label": "展开/收起输入框" },
		});
		this.expandBtn.textContent = "展开 ↑";

		this.sendBtn = inputRow.createEl("button", {
			cls: "ai-daily-send-btn",
		});
		setIcon(this.sendBtn, "send");
		this.expandBtn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			const isExpanded = this.inputEl.classList.toggle("expanded");
			this.expandBtn.textContent = isExpanded ? "收起 ↓" : "展开 ↑";
			this.autoResizeInput();
		});

		this.sendBtn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			if (this.isLoading) {
				this.handleStop();
			} else {
				this.handleSend();
			}
		});
		this.inputEl.addEventListener("input", () => {
			this.autoResizeInput();
			this.handleTemplateInput();
			this.handleMentionInput();
		});
		this.inputEl.addEventListener("keydown", (e) => {
			if (this.mentionPopupEl) {
				if (e.key === "Escape") {
					e.preventDefault();
					this.closeMentionPopup();
					return;
				}
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					this.navigatePopup(this.mentionPopupEl, e.key === "ArrowDown" ? 1 : -1);
					return;
				}
				if (e.key === "Enter" || e.key === "Tab") {
					const active = this.mentionPopupEl.querySelector(".ai-daily-mention-item-active");
					if (active) {
						e.preventDefault();
						(active as HTMLElement).click();
						return;
					}
				}
			}
			if (this.templatePopupEl) {
				if (e.key === "Escape") {
					e.preventDefault();
					this.closeTemplatePopup();
					return;
				}
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					this.navigateTemplatePopup(e.key === "ArrowDown" ? 1 : -1);
					return;
				}
				if (e.key === "Enter") {
					const active = this.templatePopupEl.querySelector(".ai-daily-template-item-active");
					if (active) {
						e.preventDefault();
						(active as HTMLElement).click();
						return;
					}
				}
			}
			if (e.key === "Enter") {
				if (Platform.isMobile) return;
				if (!e.shiftKey) {
					e.preventDefault();
					this.handleSend();
				}
			}
		});
	}

	// ── Prompt template popup ──────────────────────────────

	private handleTemplateInput(): void {
		const value = this.inputEl.value;
		if (value.startsWith("/")) {
			const query = value.slice(1).toLowerCase();
			const templates = this.plugin.settings.promptTemplates;
			const filtered = query
				? templates.filter(
						(t) =>
							t.name.toLowerCase().includes(query) ||
							t.prompt.toLowerCase().includes(query)
				  )
				: templates;
			if (filtered.length > 0) {
				this.showTemplatePopup(filtered);
			} else {
				this.closeTemplatePopup();
			}
		} else {
			this.closeTemplatePopup();
		}
	}

	private showTemplatePopup(templates: PromptTemplate[]): void {
		this.closeTemplatePopup();
		const popup = this.inputAreaEl.createDiv({ cls: "ai-daily-template-popup" });
		this.templatePopupEl = popup;

		for (let i = 0; i < templates.length; i++) {
			const tpl = templates[i];
			const item = popup.createDiv({
				cls: `ai-daily-template-item${i === 0 ? " ai-daily-template-item-active" : ""}`,
			});
			const content = item.createDiv({ cls: "ai-daily-template-item-content" });
			content.createDiv({ cls: "ai-daily-template-item-name", text: tpl.name });
			content.createDiv({
				cls: "ai-daily-template-item-prompt",
				text: tpl.prompt.length > 50 ? tpl.prompt.slice(0, 50) + "…" : tpl.prompt,
			});
			const deleteBtn = item.createDiv({ cls: "ai-daily-template-item-delete", attr: { "aria-label": "删除模板" } });
			deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
			deleteBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				const idx = this.plugin.settings.promptTemplates.indexOf(tpl);
				if (idx !== -1) {
					this.plugin.settings.promptTemplates.splice(idx, 1);
					await this.plugin.saveSettings();
					this.handleTemplateInput();
				}
			});
			item.addEventListener("click", () => {
				this.inputEl.value = tpl.prompt;
				this.autoResizeInput();
				this.closeTemplatePopup();
				this.inputEl.focus();
			});
		}
	}

	private navigateTemplatePopup(direction: number): void {
		if (!this.templatePopupEl) return;
		const items = Array.from(
			this.templatePopupEl.querySelectorAll(".ai-daily-template-item")
		);
		const activeIndex = items.findIndex((el) =>
			el.classList.contains("ai-daily-template-item-active")
		);
		items[activeIndex]?.classList.remove("ai-daily-template-item-active");
		const next = (activeIndex + direction + items.length) % items.length;
		items[next]?.classList.add("ai-daily-template-item-active");
		items[next]?.scrollIntoView({ block: "nearest" });
	}

	private closeTemplatePopup(): void {
		if (this.templatePopupEl) {
			this.templatePopupEl.remove();
			this.templatePopupEl = null;
		}
	}

	// ── @ mention popup ──────────────────────────────────

	private handleMentionInput(): void {
		const value = this.inputEl.value;
		const cursor = this.inputEl.selectionStart ?? value.length;

		const before = value.slice(0, cursor);
		const atMatch = before.match(/@([^\s@]*)$/);
		if (atMatch) {
			this.mentionStartPos = cursor - atMatch[1].length - 1;
			this.mentionCursorPos = cursor;
			const query = atMatch[1].toLowerCase();
			const allFiles = this.app.vault.getMarkdownFiles();
			const filtered = query
				? allFiles.filter((f) =>
					f.basename.toLowerCase().includes(query) ||
					f.path.toLowerCase().includes(query)
				)
				: allFiles;
			const sorted = filtered
				.sort((a, b) => b.stat.mtime - a.stat.mtime)
				.slice(0, 10);
			if (sorted.length > 0) {
				this.showMentionPopup(sorted);
			} else {
				this.closeMentionPopup();
			}
		} else {
			this.closeMentionPopup();
		}
	}

	private showMentionPopup(files: TFile[]): void {
		if (this.mentionPopupEl) {
			this.mentionPopupEl.remove();
			this.mentionPopupEl = null;
		}
		const popup = this.inputAreaEl.createDiv({ cls: "ai-daily-mention-popup" });
		this.mentionPopupEl = popup;

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const already = this.attachedFiles.some((f) => f.path === file.path);
			const item = popup.createDiv({
				cls: `ai-daily-mention-item${i === 0 ? " ai-daily-mention-item-active" : ""}${already ? " ai-daily-mention-item-attached" : ""}`,
			});
			const iconSpan = item.createSpan({ cls: "ai-daily-mention-item-icon" });
			setIcon(iconSpan, "file-text");
			const textDiv = item.createDiv({ cls: "ai-daily-mention-item-text" });
			textDiv.createDiv({ cls: "ai-daily-mention-item-name", text: file.basename });
			if (file.parent && file.parent.path !== "/") {
				textDiv.createDiv({ cls: "ai-daily-mention-item-path", text: file.parent.path });
			}
			if (already) {
				const badge = item.createSpan({ cls: "ai-daily-mention-item-badge", text: "已添加" });
			}
			item.addEventListener("click", () => {
				this.selectMention(file);
			});
		}
	}

	private selectMention(file: TFile): void {
		if (!this.attachedFiles.some((f) => f.path === file.path)) {
			this.attachedFiles.push(file);
			this.renderAttachBar();
		}
		if (this.mentionStartPos !== null) {
			const value = this.inputEl.value;
			const start = this.mentionStartPos;
			const end = this.mentionCursorPos ?? this.inputEl.selectionStart ?? value.length;
			this.inputEl.value = value.slice(0, start) + value.slice(end);
			this.inputEl.selectionStart = this.inputEl.selectionEnd = start;
		}
		this.closeMentionPopup();
		this.inputEl.focus();
	}

	private navigatePopup(popup: HTMLElement, direction: number): void {
		const items = Array.from(popup.querySelectorAll(".ai-daily-mention-item"));
		if (items.length === 0) return;
		const activeIndex = items.findIndex((el) => el.classList.contains("ai-daily-mention-item-active"));
		items[activeIndex]?.classList.remove("ai-daily-mention-item-active");
		const next = (activeIndex + direction + items.length) % items.length;
		items[next]?.classList.add("ai-daily-mention-item-active");
		items[next]?.scrollIntoView({ block: "nearest" });
	}

	private openFilePicker(): void {
		const allFiles = this.app.vault.getMarkdownFiles()
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 20);
		if (allFiles.length > 0) {
			this.mentionStartPos = null;
			this.mentionCursorPos = null;
			this.showMentionPopup(allFiles);
		}
	}

	private closeMentionPopup(): void {
		if (this.mentionPopupEl) {
			this.mentionPopupEl.remove();
			this.mentionPopupEl = null;
		}
		this.mentionStartPos = null;
		this.mentionCursorPos = null;
	}

	private renderAttachBar(): void {
		if (!this.attachBarEl) return;
		this.attachBarEl.empty();
		if (this.attachedFiles.length === 0) {
			this.attachBarEl.style.display = "none";
			return;
		}
		this.attachBarEl.style.display = "";
		for (const file of this.attachedFiles) {
			const chip = this.attachBarEl.createDiv({ cls: "ai-daily-attach-chip" });
			const iconSpan = chip.createSpan({ cls: "ai-daily-attach-chip-icon" });
			setIcon(iconSpan, "file-text");
			chip.createSpan({ cls: "ai-daily-attach-chip-name", text: file.basename });
			const removeBtn = chip.createSpan({ cls: "ai-daily-attach-chip-remove" });
			setIcon(removeBtn, "x");
			removeBtn.addEventListener("click", () => {
				this.attachedFiles = this.attachedFiles.filter((f) => f.path !== file.path);
				this.renderAttachBar();
			});
		}
	}

	private async consumeAttachedFiles(): Promise<string> {
		if (this.attachedFiles.length === 0) return "";
		const parts: string[] = [];
		for (const file of this.attachedFiles) {
			try {
				const content = await this.app.vault.cachedRead(file);
				parts.push(`## 附加笔记: ${file.path}\n\n${content}`);
			} catch {
				parts.push(`## 附加笔记: ${file.path}\n\n(读取失败)`);
			}
		}
		this.attachedFiles = [];
		this.renderAttachBar();
		return parts.join("\n\n---\n\n");
	}

	// ── Post-processing: wiki-links & code copy buttons ───

	private postProcessAssistantEl(el: HTMLElement): void {
		this.processMarkdownLinks(el);
		this.processWikiLinks(el);
		this.processCodeBlocks(el);
		this.addSaveToInboxBtn(el);
		this.updateForkButtons();
	}

	private addSaveToInboxBtn(el: HTMLElement): void {
		if (el.querySelector(".ai-daily-save-inbox-btn")) return;

		const btn = el.createDiv({ cls: "ai-daily-save-inbox-btn" });
		setIcon(btn, "pin");
		btn.setAttribute("aria-label", "保存到 Inbox");
		btn.setAttribute("title", "保存到 Inbox");

		btn.addEventListener("click", async () => {
			const text = el.textContent?.trim() ?? "";
			if (!text) return;

			const today = new Date().toISOString().slice(0, 10);
			const snippet = text.length > 200 ? text.slice(0, 200) + "…" : text;
			const entry = `- [ ] [AI 对话] ${snippet}`;

			const inboxPath = this.plugin.settings.harnessInboxFile;
			const file = this.app.vault.getAbstractFileByPath(inboxPath);

			const dateHeader = `## ${today}`;
			if (file instanceof TFile) {
				let content = await this.app.vault.read(file);
				if (content.includes(dateHeader)) {
					content = content.replace(dateHeader, `${dateHeader}\n${entry}`);
				} else {
					const insertPos = content.indexOf("\n## ");
					if (insertPos !== -1) {
						content = content.slice(0, insertPos) + `\n${dateHeader}\n${entry}\n` + content.slice(insertPos);
					} else {
						content += `\n\n${dateHeader}\n${entry}`;
					}
				}
				await this.app.vault.modify(file, content);
			} else {
				await this.app.vault.create(inboxPath, `# Inbox\n\n${dateHeader}\n${entry}\n`);
			}

			btn.empty();
			setIcon(btn, "check");
			btn.addClass("ai-daily-save-inbox-done");
			new Notice("已保存到 Inbox", 2000);
			setTimeout(() => {
				btn.empty();
				setIcon(btn, "pin");
				btn.removeClass("ai-daily-save-inbox-done");
			}, 2000);
		});
	}

	private updateForkButtons(): void {
		this.messagesEl.querySelectorAll(".ai-daily-fork-btn").forEach((el) => el.remove());

		const msgEls = this.messagesEl.querySelectorAll(".ai-daily-msg-assistant");
		if (msgEls.length === 0 || this.messages.length < 2) return;

		// Map DOM assistant elements to message indices
		let assistantDomIdx = 0;
		const assistantMsgIndices: number[] = [];
		for (let i = 0; i < this.messages.length; i++) {
			if (this.messages[i].role === "assistant") {
				assistantMsgIndices.push(i);
			}
		}

		for (let d = 0; d < msgEls.length && d < assistantMsgIndices.length; d++) {
			const el = msgEls[d];
			if (el.querySelector(".ai-daily-fork-btn")) continue;
			const msgIdx = assistantMsgIndices[d];
			// Need a user message before this assistant message to fork
			if (msgIdx < 1 || this.messages[msgIdx - 1]?.role !== "user") continue;

			const btn = (el as HTMLElement).createDiv({ cls: "ai-daily-fork-btn" });
			setIcon(btn, "git-branch");
			btn.setAttribute("aria-label", "从此处分叉");
			btn.setAttribute("title", "从此处分叉");

			const capturedIdx = msgIdx;
			btn.addEventListener("click", () => {
				void this.forkAtMessage(capturedIdx);
			});
		}
	}

	private processMarkdownLinks(el: HTMLElement): void {
		el.querySelectorAll("a.internal-link").forEach((link) => {
			const href = link.getAttr("data-href") ?? link.getAttr("href");
			if (!href) return;
			link.addEventListener("click", (e) => {
				e.preventDefault();
				this.app.workspace.openLinkText(href, "", false);
			});
		});
		el.querySelectorAll("a.external-link").forEach((link) => {
			link.addEventListener("click", (e) => {
				e.preventDefault();
				const href = link.getAttr("href");
				if (href) window.open(href, "_blank");
			});
		});
	}

	private processWikiLinks(el: HTMLElement): void {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const wikiLinkRe = /\[\[([^\]]+)\]\]/g;
		const replacements: { node: Text; frag: DocumentFragment }[] = [];

		let textNode: Text | null;
		while ((textNode = walker.nextNode() as Text | null)) {
			if (textNode.parentElement?.closest("pre, code, a")) continue;

			const text = textNode.textContent ?? "";
			if (!wikiLinkRe.test(text)) continue;
			wikiLinkRe.lastIndex = 0;

			const frag = document.createDocumentFragment();
			let lastIndex = 0;
			let match: RegExpExecArray | null;

			while ((match = wikiLinkRe.exec(text)) !== null) {
				if (match.index > lastIndex) {
					frag.appendChild(
						document.createTextNode(text.slice(lastIndex, match.index))
					);
				}
				const linkText = match[1];
				const resolved = this.app.metadataCache.getFirstLinkpathDest(
					linkText,
					""
				);
				const link = document.createElement("a");
				link.className = "ai-daily-wiki-link";
				link.textContent = linkText;
				link.setAttribute("data-href", linkText);
				if (resolved) {
					link.classList.add("ai-daily-wiki-link-resolved");
					link.addEventListener("click", (e) => {
						e.preventDefault();
						this.app.workspace.openLinkText(linkText, "", false);
					});
				} else {
					link.classList.add("ai-daily-wiki-link-unresolved");
				}
				frag.appendChild(link);
				lastIndex = match.index + match[0].length;
			}
			if (lastIndex < text.length) {
				frag.appendChild(document.createTextNode(text.slice(lastIndex)));
			}
			replacements.push({ node: textNode, frag });
		}

		for (const { node, frag } of replacements) {
			node.parentNode?.replaceChild(frag, node);
		}
	}

	private processCodeBlocks(el: HTMLElement): void {
		el.querySelectorAll("pre > code").forEach((codeEl) => {
			const pre = codeEl.parentElement!;
			if (pre.querySelector(".ai-daily-copy-btn")) return;

			const btn = pre.createDiv({ cls: "ai-daily-copy-btn" });
			setIcon(btn, "copy");
			btn.setAttribute("aria-label", "复制");
			btn.addEventListener("click", async () => {
				const text = codeEl.textContent ?? "";
				await navigator.clipboard.writeText(text);
				btn.empty();
				setIcon(btn, "check");
				btn.classList.add("ai-daily-copy-btn-done");
				setTimeout(() => {
					btn.empty();
					setIcon(btn, "copy");
					btn.classList.remove("ai-daily-copy-btn-done");
				}, 2000);
			});
		});
	}

	// ── Mobile keyboard ───────────────────────────────────

	private setupMobileKeyboard(container: HTMLElement): void {
		const inMainArea = this.leaf.getRoot() === this.app.workspace.rootSplit;
		const navbar = document.querySelector<HTMLElement>(".mobile-navbar");
		const navbarH = navbar ? navbar.getBoundingClientRect().height : 48;

		this.inputAreaEl.style.setProperty("padding-bottom", navbarH + "px", "important");

		if (inMainArea) {
			const killObsidianPadding = new MutationObserver(() => {
				if (container.style.getPropertyValue("padding-bottom") !== "0px") {
					container.style.setProperty("padding-bottom", "0", "important");
				}
			});
			this.register(() => killObsidianPadding.disconnect());

			this.inputEl.addEventListener("focus", () => {
				this.inputAreaEl.style.setProperty("padding-bottom", "8px", "important");
				container.style.setProperty("padding-bottom", "0", "important");
				killObsidianPadding.observe(container, { attributes: true, attributeFilter: ["style"] });
			});
			this.inputEl.addEventListener("blur", () => {
				killObsidianPadding.disconnect();
				this.inputAreaEl.style.setProperty("padding-bottom", navbarH + "px", "important");
				container.style.removeProperty("padding-bottom");
			});
		} else {
			const initialPb = parseFloat(getComputedStyle(container).paddingBottom) || 0;
			const containerTop = container.getBoundingClientRect().top;
			const initialParentH = container.parentElement!.getBoundingClientRect().height;
			const tabBarH = window.innerHeight - containerTop - initialParentH;
			const tabBarUiH = Math.max(0, tabBarH - initialPb);

			container.style.setProperty("padding-bottom", "0", "important");

			let keyboardOpen = false;
			let recalcTimer: ReturnType<typeof setTimeout> | null = null;

			const recalcPadding = () => {
				container.style.removeProperty("padding-bottom");
				void container.offsetHeight;
				const obsidianPb = parseFloat(getComputedStyle(container).paddingBottom) || 0;
				let appliedPb: number;
				if (obsidianPb > 50) {
					appliedPb = Math.max(8, obsidianPb - tabBarUiH);
				} else {
					appliedPb = 0;
				}
				container.style.setProperty("padding-bottom", appliedPb + "px", "important");
			};

			const scheduleRecalc = () => {
				if (recalcTimer) clearTimeout(recalcTimer);
				recalcTimer = setTimeout(recalcPadding, 300);
			};

			const resizeObs = new ResizeObserver(() => {
				if (keyboardOpen) scheduleRecalc();
			});
			resizeObs.observe(container.parentElement!);
			this.register(() => resizeObs.disconnect());

			this.inputEl.addEventListener("focus", () => {
				keyboardOpen = true;
				container.addClass("ai-daily-keyboard-open");
				this.inputAreaEl.style.setProperty("padding-bottom", "8px", "important");
				scheduleRecalc();
			});
			this.inputEl.addEventListener("blur", () => {
				keyboardOpen = false;
				if (recalcTimer) { clearTimeout(recalcTimer); recalcTimer = null; }
				container.removeClass("ai-daily-keyboard-open");
				this.inputAreaEl.style.setProperty("padding-bottom", navbarH + "px", "important");
				container.style.setProperty("padding-bottom", "0", "important");
			});
		}
	}

	private updateTokenBar(): void {
		const budget = this.plugin.settings.chatContextBudgetTokens;
		const used = this.client
			? this.client.estimateContextTokens()
			: this.cachedTokenCount;
		const pct = Math.min(100, budget > 0 ? (used / budget) * 100 : 0);
		this.tokenBarEl.empty();
		this.tokenBarEl.toggleClass("ai-daily-token-bar-low", pct < 10);
		this.tokenBarEl.createDiv({
			cls: "ai-daily-token-bar-inner",
			attr: {
				style: `--ai-token-pct:${pct}%;`,
			},
		});
		this.tokenBarEl.createSpan({
			cls: "ai-daily-token-bar-label",
			text: `约 ${formatTokenK(used)} / ${formatTokenK(budget)} tokens`,
		});
	}

	private showWelcome(): void {
		const welcomeEl = this.messagesEl.createDiv({
			cls: "ai-daily-welcome",
		});

		// Masthead: logo + title
		const masthead = welcomeEl.createDiv({ cls: "ai-daily-welcome-masthead" });
		const glyph = masthead.createDiv({ cls: "ai-daily-welcome-glyph" });
		glyph.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A2.5 2.5 0 0 0 9 18a3 3 0 0 0 3 1 3 3 0 0 0 3-1 2.5 2.5 0 0 0 2-4.8A3 3 0 0 0 15 8a3 3 0 0 0-3-3Z"/><path d="M12 5v14"/></svg>';
		const titleRow = masthead.createEl("h1", { cls: "ai-daily-welcome-title" });
		titleRow.createSpan({ text: "Cortex" });
		titleRow.createSpan({ cls: "ai-daily-welcome-ver", text: `v${this.plugin.manifest.version}` });

		// Resume hero card — shows last session
		this.buildResumeHero(welcomeEl);

		// Workspace section header
		this.buildWelcomeHarness(welcomeEl);

		// Bottom toolbar
		const tools: { icon: string; label: string; action: () => void }[] = [
			{ icon: "layout-grid", label: "Studio", action: () => void this.openStudio() },
			{ icon: "history", label: "历史", action: () => this.openHistoryPanel() },
			{ icon: "heart-pulse", label: "Wiki", action: () => this.plugin.runWikiHealthCheck() },
		];
		const toolsEl = welcomeEl.createDiv({ cls: "ai-daily-welcome-tools" });
		for (const t of tools) {
			const btn = toolsEl.createEl("button", { cls: "ai-daily-welcome-tool" });
			const iconEl = btn.createSpan({ cls: "ai-daily-welcome-tool-icon" });
			setIcon(iconEl, t.icon);
			btn.createSpan({ text: t.label });
			btn.addEventListener("click", t.action);
		}

		this.updateTokenBar();
	}

	private buildResumeHero(welcomeEl: HTMLElement): void {
		// Find the most recent session
		listChatSessions(
			this.app.vault,
			this.plugin.settings.chatHistoryFolder,
		).then((sessions) => {
			if (sessions.length === 0) return;
			const last = sessions[0];
			const hero = welcomeEl.createDiv({ cls: "ai-daily-welcome-hero" });

			const playBtn = hero.createDiv({ cls: "ai-daily-welcome-hero-play" });
			playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

			const info = hero.createDiv({ cls: "ai-daily-welcome-hero-info" });
			info.createDiv({ cls: "ai-daily-welcome-hero-label", text: "继续上次" });
			const modeName = last.harnessContext?.mode
				? `${last.harnessContext.mode.label}`
				: "";
			const actionLabel = last.harnessContext?.mode?.actions?.[0]?.label;
			const titleParts = [modeName, actionLabel].filter(Boolean).join(" · ");
			info.createDiv({ cls: "ai-daily-welcome-hero-title", text: titleParts || last.title || "新对话" });
			const wsName = last.workspace || last.harnessContext?.workspace || "";
			const timeStr = last.updated ? this.formatRelativeTime(last.updated) : "";
			const metaParts = [wsName, timeStr].filter(Boolean).join(" · ");
			if (metaParts) {
				info.createDiv({ cls: "ai-daily-welcome-hero-meta", text: metaParts });
			}

			const chevron = hero.createSpan({ cls: "ai-daily-welcome-hero-chevron" });
			setIcon(chevron, "chevron-right");

			hero.addEventListener("click", () => {
				void this.loadSession(last.id);
			});

			const harness = welcomeEl.querySelector(".ai-daily-welcome-harness");
			if (harness) welcomeEl.insertBefore(hero, harness);
		});
	}

	private formatRelativeTime(dateStr: string): string {
		const now = Date.now();
		const then = Date.parse(dateStr);
		if (isNaN(then)) return "";
		const diff = now - then;
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return "刚刚";
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours} 小时前`;
		const days = Math.floor(hours / 24);
		if (days === 0) return "今天";
		if (days === 1) return "昨天";
		if (days < 7) return `${days} 天前`;
		if (days < 30) return "上周";
		return `${Math.floor(days / 30)} 月前`;
	}

	private toggleStudio(): void {
		if (this.studioEl) {
			this.closeStudio();
		} else {
			void this.openStudio();
		}
	}

	private async openStudio(): Promise<void> {
		if (this.studioEl) return;
		this.messagesEl.style.display = "none";
		this.inputAreaEl.style.display = "none";
		this.tokenBarEl.style.display = "none";

		this.studioEl = this.chatContainerEl.createDiv({ cls: "ai-daily-studio-panel" });
		this.studio = new WorkspaceStudio(this.studioEl, this.plugin, {
			onStartWithContext: (ctx) => {
				this.closeStudio();
				this.startWithContext(ctx);
			},
			onOpenSession: (id) => {
				this.closeStudio();
				void this.loadSession(id);
			},
			onStartFresh: () => {
				this.closeStudio();
				this.clearChat();
			},
			onClose: () => this.closeStudio(),
		});
		await this.studio.render();
	}

	private closeStudio(): void {
		if (!this.studioEl) return;
		this.studio?.destroy();
		this.studio = null;
		this.studioEl.remove();
		this.studioEl = null;
		this.messagesEl.style.display = "";
		this.inputAreaEl.style.display = "";
		this.tokenBarEl.style.display = "";
	}

	private buildWelcomeHarness(welcomeEl: HTMLElement): void {
		const container = welcomeEl.createDiv({ cls: "ai-daily-welcome-harness" });

		loadProjectIndex(
			this.app.vault,
			this.app.metadataCache,
			this.plugin.settings.harnessProjectsFolder,
		).then((index) => {
			if (!index || index.projects.length === 0) return;

			const projectsFolder = this.plugin.settings.harnessProjectsFolder;
			const activeProjects = index.projects.filter((p) => p.status !== "archive");
			const archivedCount = index.projects.length - activeProjects.length;

			// Section header
			const secHead = container.createDiv({ cls: "ai-daily-welcome-sec-head" });
			secHead.createSpan({ cls: "ai-daily-welcome-sec-label", text: "工作区" });
			const countParts = [String(activeProjects.length)];
			if (archivedCount > 0) countParts.push(`${archivedCount} 已归档`);
			secHead.createSpan({ cls: "ai-daily-welcome-sec-count", text: countParts.join(" · ") });

			for (const project of activeProjects) {
				const modesPath = `${projectsFolder}/${project.name}/modes.md`;
				const modesFile = this.app.vault.getAbstractFileByPath(modesPath);
				if (!(modesFile instanceof TFile)) continue;

				void this.app.vault.read(modesFile).then((content) => {
					const modes = parseModesFromContent(content);
					if (modes.length === 0) return;

					const card = container.createDiv({ cls: "ai-daily-welcome-card" });

					// Card header
					const cardHead = card.createDiv({ cls: "ai-daily-welcome-card-head" });
					const cardIcon = cardHead.createSpan({ cls: "ai-daily-welcome-card-icon" });
					setIcon(cardIcon, "folder");
					cardHead.createSpan({ cls: "ai-daily-welcome-card-name", text: project.name });

					// Active dot for the currently active workspace
					if (project.name === index.activeProject) {
						cardHead.createSpan({ cls: "ai-daily-welcome-card-dot" });
					}

					// Chips: modes as plain chips, actions as bolt chips
					const chips = card.createDiv({ cls: "ai-daily-welcome-chips" });
					for (const mode of modes) {
						const resolveContext = () => {
							const resolveVars = (p: string) => {
								let r = p;
								r = r.replace(/\{active_project\}/g, project.name);
								r = r.replace(/\{active_work_context\}/g, index.activeWorkContext || "");
								return r;
							};
							const resolvedFiles = resolveFileEntries(mode.files, this.app, resolveVars);
							return { mode, injectedFiles: resolvedFiles, workspace: project.name } as HarnessContext;
						};

						const boltSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>';

						if (mode.actions.length >= 1) {
							for (const action of mode.actions) {
								const chip = chips.createEl("button", { cls: "ai-daily-welcome-chip ai-daily-welcome-chip--action" });
								const bolt = chip.createSpan({ cls: "ai-daily-welcome-chip-bolt" });
								bolt.innerHTML = boltSvg;
								chip.createSpan({ text: action.label });
								chip.addEventListener("click", () => {
									const ctx = resolveContext();
									this.startWithContext(ctx);
									this.inputEl.value = action.prompt;
									void this.handleSend();
								});
							}
						} else {
							const chip = chips.createEl("button", { cls: "ai-daily-welcome-chip" });
							chip.createSpan({ text: mode.label });
							chip.addEventListener("click", () => {
								this.startWithContext(resolveContext());
							});
						}
					}
				});
			}
		});
	}

	private autoResizeInput(): void {
		this.inputEl.style.height = "auto";
		const isExpanded = this.inputEl.classList.contains("expanded");
		const maxH = isExpanded ? window.innerHeight * 0.5 : 200;
		this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, maxH) + "px";
		const overflowing = this.inputEl.scrollHeight > 200;
		this.expandBtn.classList.toggle("visible", overflowing);
		if (!overflowing) {
			this.inputEl.classList.remove("expanded");
			this.expandBtn.textContent = "展开 ↑";
		}
	}

	private handleStop(): void {
		if (!this.isLoading) return;
		if (this.claudeCodeAbort) {
			this.claudeCodeAbort();
			this.claudeCodeAbort = null;
			return;
		}
		if (this.codexAbort) {
			this.codexAbort();
			this.codexAbort = null;
			return;
		}
		if (this.client) {
			this.client.abort();
		}
	}

	private setSendButtonState(loading: boolean): void {
		setIcon(this.sendBtn, loading ? "square" : "send");
		this.sendBtn.toggleClass("ai-daily-send-btn-stop", loading);
		this.sendBtn.setAttribute("aria-label", loading ? "停止生成" : "发送");
		this.sendBtn.setAttribute("title", loading ? "停止生成" : "发送");
	}

	private async handleSend(): Promise<void> {
		this.closeTemplatePopup();

		const text = this.inputEl.value.trim();
		if (!text || this.isLoading) return;

		if (text === "/distill") {
			this.inputEl.value = "";
			this.inputEl.style.height = "auto";
			this.handleDistillAsMessage();
			return;
		}

		const cliBackend = this.plugin.settings.cliBackend;
		const useCodex = cliBackend === "codex" && await isCodexAvailable();
		const useClaudeCode = cliBackend === "claude-code" && await isClaudeCodeAvailable();
		const useCliAgent = useCodex || useClaudeCode;

		const proxyReady = this.plugin.settings.proxyEnabled && !!this.plugin.settings.proxyUrl && !!this.plugin.settings.proxyToken;
		if (!useCliAgent && !this.plugin.getEffectiveApiKey() && !proxyReady) {
			this.addMessage(
				"assistant",
				"请先在插件设置中配置 Anthropic API Key，或安装 Claude Code / Codex。"
			);
			return;
		}

		this.isLoading = true;
		this.readImageCount = 0;
		this.setSendButtonState(true);
		this.inputEl.value = "";
		this.inputEl.style.height = "auto";
		this.inputEl.classList.remove("expanded");
		this.expandBtn.classList.remove("visible");
		this.expandBtn.textContent = "展开 ↑";

		const currentMode: MessageSource = useCodex
			? "codex"
			: useClaudeCode
				? "claude-code"
				: proxyReady ? "proxy" : "api";

		if (this.lastMode && this.lastMode !== currentMode) {
			if (this.lastMode === "proxy" || ((this.lastMode === "claude-code" || this.lastMode === "codex") && currentMode === "proxy")) {
				this.client?.clearProxySessionId();
			}
			if (this.lastMode === "claude-code" || this.lastMode === "codex" || (this.lastMode === "proxy" && (currentMode === "claude-code" || currentMode === "codex"))) {
				this.claudeCodeSessionId = undefined;
				this.codexSessionId = undefined;
			}
			const modeNames: Record<MessageSource, string> = {
				"claude-code": "本地 Claude Code",
				"codex": "本地 Codex",
				"proxy": "代理模式",
				"api": "API 直连",
			};
			new Notice(`已切换到${modeNames[currentMode]}，对话上下文将自动同步`, 4000);
		}
		this.lastMode = currentMode;

		if (useCodex) {
			this.handleSendViaCodex(text).catch((e) => {
				console.error("[ai-daily] Codex error:", e);
				this.addMessage("assistant", `Codex 出错: ${e instanceof Error ? e.message : String(e)}`, "codex");
				this.isLoading = false;
				this.setSendButtonState(false);
			});
			return;
		}

		if (useClaudeCode) {
			this.handleSendViaClaudeCode(text).catch((e) => {
				console.error("[ai-daily] Claude Code error:", e);
				this.addMessage("assistant", `Claude Code 出错: ${e instanceof Error ? e.message : String(e)}`, "claude-code");
				this.isLoading = false;
				this.setSendButtonState(false);
			});
			return;
		}

		const attachedContent = await this.consumeAttachedFiles();
		const userMessage = attachedContent
			? attachedContent + "\n\n" + text
			: text;

		this.addMessage("user", text);

		if (!this.sessionId) {
			this.sessionId = newSessionId();
		}

		const proxySettingsChanged = this.client && (
			this.client.isProxyMode() !== (this.plugin.settings.proxyEnabled && !!this.plugin.settings.proxyUrl)
		);
		if (!this.client || proxySettingsChanged) {
			await this.initClient();
			this.restoreProxyHandlesToClient();
		}

		const loadingEl = this.messagesEl.createDiv({
			cls: "ai-daily-loading",
		});
		const loadingTextEl = loadingEl.createSpan({ text: "思考中" });
		const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
		dotsEl.createEl("span");
		dotsEl.createEl("span");
		dotsEl.createEl("span");

		const useStream = this.plugin.settings.chatStreamMode !== "off";

		let assistantEl: HTMLElement | null = null as HTMLElement | null;

		let streamingRenderTimer: number | null = null;
		let latestStreamingMarkdown = "";
		let streamingRenderQueue = Promise.resolve();
		const renderStreamingMarkdown = async (content: string) => {
			if (!assistantEl) return;
			assistantEl.empty();
			await MarkdownRenderer.render(
				this.app,
				normalizeMarkdownForObsidian(content),
				assistantEl,
				"",
				this.plugin
			);
			this.scrollToBottomIfFollowing();
		};
		const scheduleStreamingMarkdown = (content: string) => {
			latestStreamingMarkdown = content;
			if (streamingRenderTimer !== null) return;
			streamingRenderTimer = window.setTimeout(() => {
				streamingRenderTimer = null;
				const snapshot = latestStreamingMarkdown;
				streamingRenderQueue = streamingRenderQueue.then(() =>
					renderStreamingMarkdown(snapshot)
				);
			}, STREAM_MARKDOWN_RENDER_INTERVAL_MS);
		};
		const flushStreamingMarkdown = async (content: string) => {
			latestStreamingMarkdown = content;
			if (streamingRenderTimer !== null) {
				window.clearTimeout(streamingRenderTimer);
				streamingRenderTimer = null;
			}
			await streamingRenderQueue;
			await renderStreamingMarkdown(content);
		};
		const cancelStreamingMarkdown = () => {
			if (streamingRenderTimer !== null) {
				window.clearTimeout(streamingRenderTimer);
				streamingRenderTimer = null;
			}
		};

		let proxyTypewriterTarget = "";
		let proxyTypewriterRendered = 0;
		let proxyTypewriterTimer: number | null = null;

		try {
			let preparedImages: PreparedImage[] | undefined;
			if (this.plugin.settings.enableLocalImages) {
				const refs = extractLocalImageRefs(text);
				if (refs.length > 0) {
					const { images, skipped } = await prepareLocalImages(
						this.app,
						refs,
						{
							maxImages: this.plugin.settings.maxImagesPerMessage,
							maxBytes: this.plugin.settings.maxImageBytes,
						}
					);
					if (images.length > 0) {
						preparedImages = images;
						new Notice(`已附带 ${images.length} 张图片`);
					}
					if (skipped.length > 0) {
						new Notice(
							`跳过 ${skipped.length} 张图片: ${skipped.map((s) => s.reason).join(", ")}`
						);
					}
				}
			}

			let toolCallsEl: HTMLElement | null = null;
			let toolCallsSummaryEl: HTMLElement | null = null;
			const toolCallEls = new Map<string, HTMLElement>();
			let toolCallCounter = 0;
			let toolTotal = 0;
			let toolRunning = 0;

			const onToolCall = (name: string, input: Record<string, unknown>, status: "start" | "done" | "error") => {
				if (status === "start") {
					loadingEl.remove();
					if (!toolCallsEl) {
						const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
						const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
						toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
						toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
					}
					toolTotal++;
					toolRunning++;
					const key = `${name}-${toolCallCounter++}`;
					const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
					const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
					setIcon(iconSpan, "loader");
					el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
					toolCallEls.set(key, el);
					this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
					this.scrollToBottomIfFollowing();
				} else {
					const lastKey = `${name}-${toolCallCounter - 1}`;
					const el = toolCallEls.get(lastKey);
					if (el) {
						el.removeClass("ai-daily-tool-call-running");
						el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
						const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
						if (iconSpan) {
							iconSpan.empty();
							setIcon(iconSpan as HTMLElement, status === "done" ? "check" : "x");
						}
						toolRunning--;
						this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
					}
				}
			};
			const PROXY_TYPEWRITER_INTERVAL = 25;
			const proxyTypewriterTick = () => {
				const buffered = proxyTypewriterTarget.length - proxyTypewriterRendered;
				if (buffered <= 0) {
					proxyTypewriterTimer = null;
					return;
				}
				const chars = buffered > 60 ? 4 : buffered > 20 ? 2 : 1;
				proxyTypewriterRendered = Math.min(proxyTypewriterRendered + chars, proxyTypewriterTarget.length);
				scheduleStreamingMarkdown(proxyTypewriterTarget.slice(0, proxyTypewriterRendered));
				proxyTypewriterTimer = window.setTimeout(proxyTypewriterTick, PROXY_TYPEWRITER_INTERVAL);
			};
			const startProxyTypewriter = () => {
				if (proxyTypewriterTimer !== null) return;
				proxyTypewriterTimer = window.setTimeout(proxyTypewriterTick, PROXY_TYPEWRITER_INTERVAL);
			};
			const flushProxyTypewriter = () => {
				if (proxyTypewriterTimer !== null) {
					window.clearTimeout(proxyTypewriterTimer);
					proxyTypewriterTimer = null;
				}
				proxyTypewriterRendered = proxyTypewriterTarget.length;
			};

			const streamCb = useStream
				? (_delta: string, accumulated: string) => {
						loadingEl.remove();
						if (!assistantEl) {
							assistantEl = this.messagesEl.createDiv({
								cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming",
							});
						}
						if (this.client!.isProxyMode()) {
							proxyTypewriterTarget = accumulated;
							startProxyTypewriter();
						} else {
							scheduleStreamingMarkdown(accumulated);
						}
					}
				: undefined;

			const doLocalChat = () => this.client!.chat(
						userMessage,
						async (name, input) => {
							if (name === "web_fetch") return this.webTools.execute(name, input);
							if (name === "read_image") return this.executeReadImage(input);
							if (name === "weread_api" && this.wereadTools) return this.wereadTools.execute(name, input);
							if (name.startsWith("podcast_") && this.podcastTools) return this.podcastTools.execute(name, input);
							if (name.startsWith("fetch_") && this.feedTools) return this.feedTools.execute(name, input);
							return this.vaultTools!.execute(name, input);
						},
						streamCb,
						preparedImages,
						onToolCall
					);

			let reply: string;
			let actualSource: MessageSource = "api";
			if (this.client!.isProxyMode()) {
				const proxyBackend = this.plugin.settings.cliBackend;
				const isFirstProxyMessage = !this.client!.getProxySessionId(proxyBackend);
				let seedHistory: { role: string; content: string }[] | undefined;
				if (isFirstProxyMessage && this.messages.length > 1) {
					seedHistory = this.messages.slice(0, -1).map((m) => ({
						role: m.role,
						content: m.content,
					}));
				}
				let proxyMessage = userMessage;
				if (isFirstProxyMessage && this.harnessContext) {
					const hm = this.harnessContext.mode;
					const filesList = this.harnessContext.injectedFiles.map((f) => f.path).join("\n");
					const harnessBlock = [
						`[Harness 模式：${hm.emoji} ${hm.label}]`,
						"",
						hm.systemPromptAppend,
						"",
						filesList ? `相关文件（需要时请用工具读取）：\n${filesList}` : "",
						"",
						"请严格按照上述模式要求回复，不要偏离角色。",
						"---",
						"",
					].filter(Boolean).join("\n");
					proxyMessage = harnessBlock + proxyMessage;
				}
				try {
					reply = await this.client!.proxyChat(
						proxyMessage,
						streamCb,
						onToolCall,
						seedHistory,
						proxyBackend,
						this.plugin.settings.cliBackend === "codex" ? this.plugin.settings.codexModel : this.plugin.settings.model,
						this.plugin.settings.codexPermissionMode,
						(message) => loadingTextEl.setText(message),
					);
					actualSource = "proxy";
				} catch (proxyErr) {
					if (this.plugin.settings.proxyFallbackToApi && this.plugin.getEffectiveApiKey()) {
						console.warn("[ai-daily] proxy failed, falling back to API:", proxyErr);
						new Notice("代理不可用，回退到本地 API", 4000);
						this.client!.clearProxySessionId(proxyBackend);
						this.lastMode = "api";
						reply = await doLocalChat();
						actualSource = "api";
					} else {
						throw proxyErr;
					}
				}
			} else {
				reply = await doLocalChat();
				actualSource = "api";
			}

			loadingEl.remove();
			flushProxyTypewriter();

			// Tag user message with actual source (determined after mode resolution)
			const lastUserMsg = this.messages[this.messages.length - 1];
			if (lastUserMsg?.role === "user") lastUserMsg.source = actualSource;

			if (useStream && assistantEl) {
				await flushStreamingMarkdown(reply || "*(已停止)*");
				this.postProcessAssistantEl(assistantEl);
				assistantEl.removeClass("ai-daily-msg-streaming");
				this.messages.push({ role: "assistant", content: reply || "*(已停止)*", source: actualSource });
				this.cachedTokenCount += estimateTextTokens(reply);
			} else if (reply) {
				this.addMessage("assistant", reply, actualSource);
			} else {
				this.addMessage("assistant", "*(空回复，请检查代理配置)*", actualSource);
			}
			this.scrollToBottomIfFollowing();
			this.renderUndoBar();
			if (this.client!.isProxyMode()) {
				await this.fetchAndRenderProxyUndo();
			}

			await this.persistSession();
			this.updateTokenBar();
		} catch (e) {
			if (proxyTypewriterTimer !== null) {
				window.clearTimeout(proxyTypewriterTimer);
				proxyTypewriterTimer = null;
			}
			cancelStreamingMarkdown();
			loadingEl.remove();
			if (assistantEl && latestStreamingMarkdown) {
				assistantEl.removeClass("ai-daily-msg-streaming");
				this.messages.push({ role: "assistant", content: latestStreamingMarkdown });
			} else if (assistantEl) {
				assistantEl.remove();
			}
			const msg = e instanceof Error ? e.message : String(e);
			this.addMessage("assistant", `出错了: ${msg}`);
		} finally {
			this.isLoading = false;
			this.setSendButtonState(false);
			this.updateTokenBar();
		}
	}

	private getMcpConfig(): { vaultPath: string; mcpServerPath: string; knowledgeFolders: string[]; wereadApiKey?: string } {
		const { knowledgeFolders, enableWeRead, wereadApiKey } = this.plugin.settings;
		const adapter = this.app.vault.adapter as { basePath?: string };
		const vaultPath = adapter.basePath || "";
		const mcpServerPath = getMcpServerPath();
		return { vaultPath, mcpServerPath, knowledgeFolders, ...(enableWeRead && wereadApiKey ? { wereadApiKey } : {}) };
	}

	private async handleSendViaClaudeCode(text: string): Promise<void> {
		this.addMessage("user", text, "claude-code");
		if (!this.sessionId) this.sessionId = newSessionId();

		const isFirstMessage = !this.claudeCodeSessionId;
		const attachedContent = await this.consumeAttachedFiles();
		let prompt = text;

		if (isFirstMessage && this.messages.length > 1) {
			const adapter = this.app.vault.adapter as { basePath?: string };
			const vaultAbsPath = adapter.basePath || "";
			const history = this.messages.slice(0, -1).map((m) => ({
				role: m.role,
				content: m.content,
			}));
			try {
				const seededId = await seedClaudeCodeSession(history, vaultAbsPath, this.plugin.settings.model);
				this.claudeCodeSessionId = seededId;
			} catch (e) {
				console.error("[ai-daily] Failed to seed claude-code session:", e);
			}
		}

		if (isFirstMessage && !this.claudeCodeSessionId) {
			const adapter = this.app.vault.adapter as { basePath?: string };
			const vaultAbsPath = adapter.basePath || "";

			const systemPromptText = buildSystemPrompt({
				mode: "claude-code",
				knowledgeFolders: this.plugin.settings.knowledgeFolders,
				distillTargetFolder: this.plugin.settings.distillTargetFolder,
				autoTagFolders: this.plugin.settings.autoTagFolders,
				enableWebSearch: false,
				enableWeRead: this.plugin.settings.enableWeRead && !!this.plugin.settings.wereadApiKey,
				enablePodcast: false,
				harnessContext: this.harnessContext,
				vaultAbsPath,
			});

			prompt = systemPromptText + "\n\n" + (attachedContent ? attachedContent + "\n\n" : "") + text;
		} else if (attachedContent) {
			prompt = attachedContent + "\n\n" + text;
		}

		this.runClaudeCodeStream(prompt, this.getMcpConfig(), this.claudeCodeSessionId, this.plugin.settings.model);
	}

	private async handleSendViaCodex(text: string): Promise<void> {
		this.addMessage("user", text, "codex");
		if (!this.sessionId) this.sessionId = newSessionId();

		const isFirstMessage = !this.codexSessionId;
		const attachedContent = await this.consumeAttachedFiles();
		let prompt = text;

		if (isFirstMessage) {
			const adapter = this.app.vault.adapter as { basePath?: string };
			const vaultAbsPath = adapter.basePath || "";

			const systemPromptText = buildSystemPrompt({
				mode: "codex",
				knowledgeFolders: this.plugin.settings.knowledgeFolders,
				distillTargetFolder: this.plugin.settings.distillTargetFolder,
				autoTagFolders: this.plugin.settings.autoTagFolders,
				enableWebSearch: false,
				enableWeRead: this.plugin.settings.enableWeRead && !!this.plugin.settings.wereadApiKey,
				enablePodcast: false,
				harnessContext: this.harnessContext,
				vaultAbsPath,
			});

			prompt = systemPromptText + "\n\n" + (attachedContent ? attachedContent + "\n\n" : "") + text;
		} else if (attachedContent) {
			prompt = attachedContent + "\n\n" + text;
		}

		this.runCodexStream(prompt, this.getMcpConfig(), this.codexSessionId, this.plugin.settings.codexModel);
	}

	private readImageCount = 0;
	private static readonly MAX_IMAGES_PER_TURN = 5;

	private async executeReadImage(input: Record<string, unknown>): Promise<ToolResultContent> {
		const path = typeof input.path === "string" ? input.path : "";
		if (!path) return "Error: path is required";

		if (this.readImageCount >= ChatView.MAX_IMAGES_PER_TURN) {
			return `[已达本轮图片上限 ${ChatView.MAX_IMAGES_PER_TURN} 张，无法读取 ${path}。请先基于已读取的图片回复用户，用户可在后续消息中要求继续读取。]`;
		}

		const refs = [{ raw: path, path }];
		const { images, skipped } = await prepareLocalImages(this.app, refs, {
			maxImages: 1,
			maxBytes: this.plugin.settings.maxImageBytes,
		});

		if (skipped.length > 0) return `Error: ${skipped[0].reason} (${path})`;
		if (images.length === 0) return `Error: 无法读取图片 (${path})`;

		this.readImageCount++;
		const img = images[0];
		return [
			{
				type: "image",
				source: {
					type: "base64",
					media_type: img.mediaType,
					data: img.base64,
				},
			},
			{ type: "text", text: `图片: ${path} (${this.readImageCount}/${ChatView.MAX_IMAGES_PER_TURN})` },
		];
	}

	private async initClient(): Promise<void> {
		const {
			apiKey,
			model,
			knowledgeFolders,
			chatStreamMode,
			chatCompressThresholdEst,
			enableWebSearch,
			enableWeRead,
			wereadApiKey,
			enablePodcast,
		} = this.plugin.settings;

		this.vaultTools = new VaultTools(this.app, knowledgeFolders);

		const weReadActive = enableWeRead && !!wereadApiKey;
		this.wereadTools = weReadActive ? new WeReadTools(wereadApiKey) : null;
		this.podcastTools = enablePodcast ? new PodcastTools() : null;
		this.feedTools = new FeedTools(this.plugin.settings.feedSources);

		const knowledgeContext = await this.vaultTools.loadKnowledgeContext(5);
		const proxyActive = this.plugin.settings.proxyEnabled;

		const systemPrompt = buildSystemPrompt({
			mode: proxyActive ? "proxy" : "api",
			knowledgeFolders,
			distillTargetFolder: this.plugin.settings.distillTargetFolder,
			autoTagFolders: this.plugin.settings.autoTagFolders,
			enableWebSearch,
			enableWeRead: weReadActive,
			enablePodcast,
			harnessContext: this.harnessContext,
			knowledgeContext: knowledgeContext || undefined,
		});

		this.client = new ClaudeClient(apiKey, model, systemPrompt, {
			streamMode: chatStreamMode,
			enableWebSearch,
			enableWeRead: weReadActive,
			enablePodcast,
			enableFeeds: true,
			compressThresholdEst: chatCompressThresholdEst,
			onCompress: (detail) => {
				new Notice(detail, 6000);
			},
			onStreamFallback: (reason) => {
				console.warn("[ai-daily] stream fallback:", reason);
			},
			proxyUrl: proxyActive ? this.plugin.settings.proxyUrl : undefined,
			proxyToken: proxyActive ? this.plugin.settings.proxyToken : undefined,
		});
	}

	private async persistSession(): Promise<void> {
		if (!this.sessionId) return;
		const { chatHistoryFolder, model } = this.plugin.settings;
		const now = new Date().toISOString();
		const persisted: PersistedMessage[] = this.messages.map((m) => ({
			role: m.role,
			content: m.content,
			...(m.source ? { source: m.source } : {}),
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
			claudeCodeSessionId: this.claudeCodeSessionId,
			codexSessionId: this.codexSessionId,
			claudeCodeProxySessionId: this.client?.getProxySessionId("claude-code"),
			codexProxySessionId: this.client?.getProxySessionId("codex"),
			claudeCodeProxyTaskId: this.client?.getProxyTaskId("claude-code"),
			codexProxyTaskId: this.client?.getProxyTaskId("codex"),
			harnessContext: this.harnessContext ?? undefined,
			lastMode: this.lastMode ?? undefined,
			workspace: this.harnessContext?.workspace ?? existing?.workspace,
			pinned: existing?.pinned,
		};
		try {
			await saveChatSession(this.app.vault, chatHistoryFolder, file);
		} catch (e) {
			console.error("[ai-daily] persist session failed", e);
			new Notice(
				`对话存档失败: ${e instanceof Error ? e.message : String(e)}`,
				6000
			);
		}
	}

	private scrollToBottomIfFollowing(): void {
		if (!this.userScrolledUp) {
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		}
	}

	private addMessage(role: "user" | "assistant", content: string, source?: MessageSource): void {
		const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
		if (welcome) {
			welcome.remove();
			if (this.moreBtnEl) this.moreBtnEl.style.display = "";
		}

		this.messages.push({ role, content, source });
		this.cachedTokenCount += estimateTextTokens(content);

		const msgEl = this.messagesEl.createDiv({
			cls: `ai-daily-msg ai-daily-msg-${role}`,
		});

		if (role === "assistant") {
			void MarkdownRenderer.render(
				this.app,
				normalizeMarkdownForObsidian(content),
				msgEl,
				"",
				this.plugin
			).then(() => {
				this.postProcessAssistantEl(msgEl);
			});
		} else {
			msgEl.setText(content);
		}

		if (role === "user") {
			this.userScrolledUp = false;
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		} else {
			this.scrollToBottomIfFollowing();
		}
		this.updateTokenBar();
	}

	private async fetchAndRenderProxyUndo(): Promise<void> {
		const { proxyUrl, proxyToken } = this.plugin.settings;
		if (!proxyUrl || !proxyToken) return;
		const base = /^https?:\/\//i.test(proxyUrl) ? proxyUrl : `https://${proxyUrl}`;
		try {
			const resp = await fetch(`${base}/undo-history`, {
				headers: { Authorization: `Bearer ${proxyToken}` },
			});
			if (!resp.ok) return;
			const entries: Array<{ id: string; timestamp: number; operation: string; path: string }> = await resp.json();
			if (entries.length === 0) return;

			this.messagesEl.querySelectorAll(".ai-daily-undo-bar-proxy").forEach((el) => el.remove());

			for (const entry of entries.slice(0, 3)) {
				const label = `${entry.operation.replace(/_/g, " ")}: ${entry.path.split("/").pop()}`;
				this.createUndoBarEl(label, entry.path, async () => {
					const r = await fetch(`${base}/undo`, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${proxyToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ id: entry.id }),
					});
					const data = await r.json();
					if (!r.ok) throw new Error(data.error || "撤销失败");
					return `已撤销: ${data.operation} ${data.path}`;
				}, undefined, "ai-daily-undo-bar-proxy");
			}
		} catch { /* silent */ }
	}

	private renderUndoBar(): void {
		this.messagesEl.querySelectorAll(".ai-daily-undo-bar").forEach((el) => el.remove());

		// API mode undo
		if (this.vaultTools) {
			const history = this.vaultTools.getUndoHistory();
			for (const entry of history.slice(-5).reverse()) {
				this.createUndoBarEl(entry.description, entry.path, async () => {
					return await this.vaultTools!.undoById(entry.id) || "已撤销";
				});
			}
			if (history.length > 0) return;
		}

		// Claude Code mode undo
		for (const entry of this.claudeCodeUndoHistory.slice(-5).reverse()) {
			this.createUndoBarEl(entry.description, entry.data.path, async () => {
				return await this.executeClaudeCodeUndo(entry.id);
			}, entry.data);
		}
	}

	private updateToolCallsSummary(el: HTMLElement, total: number, running: number): void {
		el.empty();
		if (running > 0) {
			const iconSpan = el.createSpan({ cls: "ai-daily-tool-calls-summary-icon" });
			setIcon(iconSpan, "loader");
			el.createSpan({ text: ` ${total} 个工具调用 (${running} 进行中)` });
		} else {
			const iconSpan = el.createSpan({ cls: "ai-daily-tool-calls-summary-icon ai-daily-tool-calls-summary-done" });
			setIcon(iconSpan, "check-circle");
			el.createSpan({ text: ` ${total} 个工具调用已完成` });
		}
	}

	private createUndoBarEl(description: string, filePath: string, onUndo: () => Promise<string>, undoData?: UndoData, extraCls?: string): void {
		const bar = this.messagesEl.createDiv({ cls: "ai-daily-undo-bar" + (extraCls ? ` ${extraCls}` : "") });

		const textSpan = bar.createSpan({ cls: "ai-daily-undo-text", text: description });
		textSpan.addEventListener("click", () => {
			this.app.workspace.openLinkText(filePath, "", false);
		});

		if (undoData?.previous !== undefined && undoData.tool !== "create_note") {
			const diffBtn = bar.createEl("button", { cls: "ai-daily-undo-diff-btn" });
			setIcon(diffBtn, "diff");
			diffBtn.setAttribute("aria-label", "查看变更");
			diffBtn.setAttribute("title", "查看变更");
			diffBtn.addEventListener("click", () => {
				const existingDiff = bar.querySelector(".ai-daily-undo-diff");
				if (existingDiff) { existingDiff.remove(); return; }
				this.showDiffInBar(bar, filePath, undoData.previous!);
			});
		}

		const undoBtn = bar.createEl("button", { cls: "ai-daily-undo-btn", text: "撤销" });
		const iconSpan = undoBtn.createSpan({ cls: "ai-daily-undo-btn-icon" });
		setIcon(iconSpan, "undo");
		undoBtn.prepend(iconSpan);

		undoBtn.addEventListener("click", async () => {
			undoBtn.disabled = true;
			undoBtn.setText("撤销中...");
			try {
				const result = await onUndo();
				new Notice(result, 3000);
			} catch (e) {
				new Notice(`撤销失败: ${e instanceof Error ? e.message : String(e)}`, 4000);
			}
			bar.remove();
			this.renderUndoBar();
		});

		this.scrollToBottomIfFollowing();
	}

	private async showDiffInBar(bar: HTMLElement, filePath: string, previous: string): Promise<void> {
		let current: string;
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file && file instanceof TFile) {
				current = await this.app.vault.cachedRead(file);
			} else {
				const adapter = this.app.vault.adapter as { basePath?: string };
				const { join } = require("path") as typeof import("path");
				const { readFileSync } = require("fs") as typeof import("fs");
				current = readFileSync(join(adapter.basePath || "", filePath), "utf-8");
			}
		} catch {
			current = "(文件不存在或已删除)";
		}

		const diffEl = bar.createDiv({ cls: "ai-daily-undo-diff" });
		const diffHtml = simpleDiff(previous, current);
		diffEl.innerHTML = diffHtml;
		this.scrollToBottomIfFollowing();
	}

	private pushClaudeCodeUndo(data: UndoData): void {
		const TOOL_LABELS: Record<string, string> = {
			append_to_note: "追加内容",
			create_note: "创建笔记",
			edit_note: "编辑笔记",
			rename_note: "重命名笔记",
			delete_note: "删除笔记",
			update_frontmatter: "更新属性",
		};
		const label = TOOL_LABELS[data.tool] || data.tool;
		const description = `${label}: ${data.path}`;
		this.claudeCodeUndoHistory.push({
			id: this.claudeCodeUndoCounter++,
			data,
			description,
		});
		if (this.claudeCodeUndoHistory.length > 20) {
			this.claudeCodeUndoHistory.shift();
		}
	}

	private async executeClaudeCodeUndo(id: number): Promise<string> {
		const idx = this.claudeCodeUndoHistory.findIndex((e) => e.id === id);
		if (idx === -1) return "撤销条目不存在";
		const [entry] = this.claudeCodeUndoHistory.splice(idx, 1);
		const { data } = entry;
		const adapter = this.app.vault.adapter as { basePath?: string };
		const vaultPath = adapter.basePath || "";
		const { join } = require("path") as typeof import("path");
		const { writeFileSync, readFileSync, renameSync, mkdirSync } = require("fs") as typeof import("fs");

		switch (data.tool) {
			case "create_note": {
				const abs = join(vaultPath, data.path);
				const trashDir = join(vaultPath, ".trash");
				try { mkdirSync(trashDir, { recursive: true }); } catch { /* exists */ }
				renameSync(abs, join(trashDir, data.path.split("/").pop()!));
				return `已撤销创建: ${data.path}`;
			}
			case "delete_note": {
				if (data.previous === undefined) return "无法撤销: 缺少原始内容";
				const abs = join(vaultPath, data.path);
				const dir = join(vaultPath, data.path.substring(0, data.path.lastIndexOf("/")));
				try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
				writeFileSync(abs, data.previous, "utf-8");
				return `已恢复: ${data.path}`;
			}
			case "rename_note": {
				if (!data.oldPath) return "无法撤销: 缺少原路径";
				const absNew = join(vaultPath, data.path);
				const absOld = join(vaultPath, data.oldPath);
				renameSync(absNew, absOld);
				return `已撤销重命名: ${data.path} → ${data.oldPath}`;
			}
			case "append_to_note":
			case "edit_note":
			case "update_frontmatter": {
				if (data.previous === undefined) return "无法撤销: 缺少原始内容";
				const abs = join(vaultPath, data.path);
				writeFileSync(abs, data.previous, "utf-8");
				return `已恢复: ${data.path}`;
			}
			default:
				return `不支持的撤销操作: ${data.tool}`;
		}
	}

	startWithContext(context: HarnessContext | null): void {
		this.clearChat();
		this.harnessContext = context;

		if (context) {
			const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
			if (welcome) welcome.remove();

			const banner = this.messagesEl.createDiv({ cls: "ai-daily-ctx-header" });
			let expanded = false;

			// Collapsed row (always visible)
			const row = banner.createDiv({ cls: "ai-daily-ctx-row" });
			const modeIcon = row.createDiv({ cls: "ai-daily-ctx-icon" });
			modeIcon.textContent = context.mode.emoji;
			const info = row.createDiv({ cls: "ai-daily-ctx-info" });
			info.createDiv({ cls: "ai-daily-ctx-mode", text: context.mode.label });
			if (context.workspace) {
				info.createDiv({ cls: "ai-daily-ctx-ws", text: context.workspace });
			}
			if (context.injectedFiles.length > 0) {
				const toggle = row.createSpan({
					cls: "ai-daily-ctx-toggle",
					text: `${context.injectedFiles.length} files ⌄`,
				});
				toggle.addEventListener("click", (ev) => {
					ev.stopPropagation();
					expanded = !expanded;
					banner.toggleClass("ai-daily-ctx-expanded", expanded);
					toggle.textContent = expanded
						? `${context.injectedFiles.length} files ⌃`
						: `${context.injectedFiles.length} files ⌄`;
				});
			}

			// Expanded detail (hidden by default)
			if (context.injectedFiles.length > 0) {
				const detail = banner.createDiv({ cls: "ai-daily-ctx-detail" });
				detail.createDiv({ cls: "ai-daily-ctx-detail-label", text: `已注入 ${context.injectedFiles.length} 个文件` });
				const pills = detail.createDiv({ cls: "ai-daily-ctx-pills" });
				for (const f of context.injectedFiles) {
					const pill = pills.createSpan({ cls: "ai-daily-ctx-pill" });
					const fIcon = pill.createSpan({ cls: "ai-daily-ctx-pill-icon" });
					setIcon(fIcon, "file-text");
					const displayName = f.path.replace(/^.*\//, "").replace(/\.md$/, "");
					pill.createSpan({ text: displayName });
					pill.setAttribute("title", f.path);
				}
			}

			this.inputEl.focus();
		}
	}

	sendMessage(text: string): void {
		this.inputEl.value = text;
		void this.handleSend();
	}

	sendClaudeCodeMessage(userText: string): void {
		if (this.isLoading) return;
		this.isLoading = true;
		this.setSendButtonState(true);
		const source: MessageSource = this.plugin.settings.cliBackend === "codex" ? "codex" : "claude-code";
		this.addMessage("user", userText, source);
		if (!this.sessionId) this.sessionId = newSessionId();
		if (source === "codex") {
			this.runCodexStream(userText, this.getMcpConfig(), this.codexSessionId, this.plugin.settings.codexModel);
		} else {
			this.runClaudeCodeStream(userText, this.getMcpConfig(), this.claudeCodeSessionId, this.plugin.settings.model);
		}
	}

	private runClaudeCodeStream(prompt: string, mcpConfig: { vaultPath: string; mcpServerPath: string; knowledgeFolders: string[] }, sessionId?: string, model?: string): void {
		const loadingEl = this.messagesEl.createDiv({ cls: "ai-daily-loading" });
		loadingEl.createSpan({ text: "Claude Code 处理中" });
		const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
		dotsEl.createEl("span");
		dotsEl.createEl("span");
		dotsEl.createEl("span");

		let assistantEl: HTMLDivElement | null = null;
		let streamTextEl: HTMLElement | null = null;
		let accumulated = "";
		let rendered = 0;
		let typewriterTimer: number | null = null;
		let toolCallsEl: HTMLElement | null = null;
		let toolCallsSummaryEl: HTMLElement | null = null;
		const toolCallEls = new Map<string, HTMLElement>();
		let toolTotal = 0;
		let toolRunning = 0;
		let thinkingEl: HTMLElement | null = null;
		let thinkingContentEl: HTMLElement | null = null;
		let thinkingText = "";

		const typewriterTick = () => {
			if (!streamTextEl) return;
			const buffered = accumulated.length - rendered;
			if (buffered <= 0) {
				typewriterTimer = null;
				return;
			}
			// Adaptive speed: slow when buffer is small, fast when buffer is large
			const chars = buffered > 60 ? 4 : buffered > 20 ? 2 : 1;
			const end = Math.min(rendered + chars, accumulated.length);
			streamTextEl.textContent = accumulated.slice(0, end);
			rendered = end;
			this.scrollToBottomIfFollowing();
			typewriterTimer = window.setTimeout(typewriterTick, 25);
		};

		const startTypewriter = () => {
			if (typewriterTimer !== null) return;
			if (streamTextEl) streamTextEl.addClass("ai-daily-stream-text");
			typewriterTimer = window.setTimeout(typewriterTick, 25);
		};

		const flushTypewriter = () => {
			if (typewriterTimer !== null) {
				window.clearTimeout(typewriterTimer);
				typewriterTimer = null;
			}
			if (streamTextEl && rendered < accumulated.length) {
				streamTextEl.textContent = accumulated;
				rendered = accumulated.length;
			}
			if (streamTextEl) streamTextEl.removeClass("ai-daily-stream-text");
		};

		const handle = spawnClaudeCode(prompt, { mcpConfig, sessionId, model }, {
			onText: (delta) => {
				if (this.closed) return;
				loadingEl.remove();
				if (!assistantEl) {
					assistantEl = this.messagesEl.createDiv({
						cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming",
					});
					streamTextEl = assistantEl.createEl("pre", {
						cls: "ai-daily-stream-text",
					});
				} else if (streamTextEl && !streamTextEl.hasClass("ai-daily-stream-text")) {
					streamTextEl.addClass("ai-daily-stream-text");
				}
				accumulated += delta;
				startTypewriter();
			},
			onToolCall: (id, name, input, status) => {
				if (this.closed) return;
				if (status === "running") {
					loadingEl.remove();
					flushTypewriter();
					if (!toolCallsEl) {
						const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
						const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
						toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
						toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
					}
					toolTotal++;
					toolRunning++;
					const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
					const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
					setIcon(iconSpan, "loader");
					el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
					toolCallEls.set(id, el);
					this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
					this.scrollToBottomIfFollowing();
				} else {
					const el = toolCallEls.get(id);
					if (el) {
						el.removeClass("ai-daily-tool-call-running");
						el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
						const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
						if (iconSpan) {
							iconSpan.empty();
							setIcon(iconSpan as HTMLElement, status === "done" ? "check" : "x");
						}
					}
					toolRunning = Math.max(0, toolRunning - 1);
					this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
				}
			},
			onToolResult: (id, result, isError) => {
				if (this.closed) return;
				const el = toolCallEls.get(id);
				if (!el || !result) return;
				const details = el.createEl("details", { cls: "ai-daily-tool-result" });
				details.createEl("summary", { text: isError ? "错误" : "结果" });
				const pre = details.createEl("pre", { cls: "ai-daily-tool-result-content" });
				pre.createEl("code", { text: result.length > 2000 ? result.slice(0, 2000) + "\n…(已截断)" : result });
			},
			onThinking: (text) => {
				if (this.closed) return;
				loadingEl.remove();
				thinkingText += text;
				if (!thinkingEl) {
					thinkingEl = this.messagesEl.createDiv({ cls: "ai-daily-thinking" });
					const details = thinkingEl.createEl("details", { cls: "ai-daily-thinking-details" });
					details.createEl("summary", { text: "💭 思考过程" });
					thinkingContentEl = details.createEl("pre", { cls: "ai-daily-thinking-content" });
				}
				if (thinkingContentEl) {
					thinkingContentEl.textContent = thinkingText;
				}
				this.scrollToBottomIfFollowing();
			},
			onUndoData: (data) => {
				this.pushClaudeCodeUndo(data);
			},
			onError: (error) => {
				if (this.closed) return;
				loadingEl.remove();
				if (typewriterTimer !== null) { window.clearTimeout(typewriterTimer); typewriterTimer = null; }
				if (assistantEl && accumulated) {
					assistantEl.empty();
					void MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(accumulated), assistantEl, "", this.plugin).then(() => {
						assistantEl!.removeClass("ai-daily-msg-streaming");
						this.postProcessAssistantEl(assistantEl!);
					});
					this.messages.push({ role: "assistant", content: accumulated, source: "claude-code" });
				} else if (assistantEl) {
					assistantEl.remove();
				}
				this.addMessage("assistant", `Claude Code 出错: ${error}`, "claude-code");
				this.isLoading = false;
				this.setSendButtonState(false);
				this.renderUndoBar();
			},
			onDone: (fullText) => {
				if (this.closed) return;
				loadingEl.remove();
				if (typewriterTimer !== null) { window.clearTimeout(typewriterTimer); typewriterTimer = null; }
				if (assistantEl) {
					assistantEl.empty();
					void MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(fullText), assistantEl, "", this.plugin).then(() => {
						assistantEl!.removeClass("ai-daily-msg-streaming");
						this.postProcessAssistantEl(assistantEl!);
					});
					this.messages.push({ role: "assistant", content: fullText, source: "claude-code" });
				} else if (fullText) {
					this.addMessage("assistant", fullText, "claude-code");
				}
				this.scrollToBottomIfFollowing();
				void this.persistSession();
				this.isLoading = false;
				this.setSendButtonState(false);
				this.renderUndoBar();
			},
			onSessionId: (id) => {
				this.claudeCodeSessionId = id;
				console.log("[ai-daily] Claude Code session:", id);
			},
		});

		this.claudeCodeAbort = handle.abort;
	}

	private runCodexStream(prompt: string, mcpConfig: { vaultPath: string; mcpServerPath: string; knowledgeFolders: string[]; wereadApiKey?: string }, sessionId?: string, model?: string): void {
		const loadingEl = this.messagesEl.createDiv({ cls: "ai-daily-loading" });
		loadingEl.createSpan({ text: "Codex 处理中" });
		const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
		dotsEl.createEl("span");
		dotsEl.createEl("span");
		dotsEl.createEl("span");
		this.scrollToBottomIfFollowing();

		let assistantEl: HTMLElement | null = null;
		let streamTextEl: HTMLElement | null = null;
		let accumulated = "";
		let rendered = 0;
		let typewriterTimer: number | null = null;

		let toolCallsEl: HTMLElement | null = null;
		let toolCallsSummaryEl: HTMLElement | null = null;
		let toolTotal = 0;
		let toolRunning = 0;
		const toolCallEls = new Map<string, HTMLElement>();

		let thinkingEl: HTMLElement | null = null;
		let thinkingContentEl: HTMLElement | null = null;
		let thinkingText = "";

		const startTypewriter = () => {
			if (typewriterTimer !== null) return;
			const tick = () => {
				if (!streamTextEl || rendered >= accumulated.length) {
					typewriterTimer = null;
					if (streamTextEl) streamTextEl.removeClass("ai-daily-stream-text");
					return;
				}
				const next = Math.min(rendered + 3, accumulated.length);
				streamTextEl.textContent = accumulated.slice(0, next);
				rendered = next;
				this.scrollToBottomIfFollowing();
				if (streamTextEl) streamTextEl.addClass("ai-daily-stream-text");
				typewriterTimer = window.setTimeout(tick, 25);
			};
			typewriterTimer = window.setTimeout(tick, 25);
		};

		const flushTypewriter = () => {
			if (typewriterTimer !== null) {
				window.clearTimeout(typewriterTimer);
				typewriterTimer = null;
			}
			if (streamTextEl && rendered < accumulated.length) {
				streamTextEl.textContent = accumulated;
				rendered = accumulated.length;
			}
			if (streamTextEl) streamTextEl.removeClass("ai-daily-stream-text");
		};

		const handle = spawnCodex(prompt, {
			mcpConfig,
			sessionId,
			model,
			codexPermissionMode: this.plugin.settings.codexPermissionMode,
		}, {
			onText: (delta) => {
				if (this.closed) return;
				loadingEl.remove();
				if (!assistantEl) {
					assistantEl = this.messagesEl.createDiv({
						cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming",
					});
					streamTextEl = assistantEl.createEl("pre", {
						cls: "ai-daily-stream-text",
					});
				} else if (streamTextEl && !streamTextEl.hasClass("ai-daily-stream-text")) {
					streamTextEl.addClass("ai-daily-stream-text");
				}
				accumulated += delta;
				startTypewriter();
			},
			onToolCall: (id, name, input, status) => {
				if (this.closed) return;
				if (status === "running") {
					loadingEl.remove();
					flushTypewriter();
					if (!toolCallsEl) {
						const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
						const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
						toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
						toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
					}
					toolTotal++;
					toolRunning++;
					const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
					const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
					setIcon(iconSpan, "loader");
					el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
					toolCallEls.set(id, el);
					this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
					this.scrollToBottomIfFollowing();
				} else {
					const el = toolCallEls.get(id);
					if (el) {
						el.removeClass("ai-daily-tool-call-running");
						el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
						const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
						if (iconSpan) {
							iconSpan.empty();
							setIcon(iconSpan as HTMLElement, status === "done" ? "check" : "x");
						}
					}
					toolRunning = Math.max(0, toolRunning - 1);
					this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
				}
			},
			onToolResult: (id, result, isError) => {
				if (this.closed) return;
				const el = toolCallEls.get(id);
				if (!el || !result) return;
				const details = el.createEl("details", { cls: "ai-daily-tool-result" });
				details.createEl("summary", { text: isError ? "错误" : "结果" });
				const pre = details.createEl("pre", { cls: "ai-daily-tool-result-content" });
				pre.createEl("code", { text: result.length > 2000 ? result.slice(0, 2000) + "\n…(已截断)" : result });
			},
			onThinking: (text) => {
				if (this.closed) return;
				loadingEl.remove();
				thinkingText += text;
				if (!thinkingEl) {
					thinkingEl = this.messagesEl.createDiv({ cls: "ai-daily-thinking" });
					const details = thinkingEl.createEl("details", { cls: "ai-daily-thinking-details" });
					details.createEl("summary", { text: "💭 思考过程" });
					thinkingContentEl = details.createEl("pre", { cls: "ai-daily-thinking-content" });
				}
				if (thinkingContentEl) {
					thinkingContentEl.textContent = thinkingText;
				}
				this.scrollToBottomIfFollowing();
			},
			onError: (error) => {
				if (this.closed) return;
				loadingEl.remove();
				if (typewriterTimer !== null) { window.clearTimeout(typewriterTimer); typewriterTimer = null; }
				if (assistantEl && accumulated) {
					assistantEl.empty();
					void MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(accumulated), assistantEl, "", this.plugin).then(() => {
						assistantEl!.removeClass("ai-daily-msg-streaming");
						this.postProcessAssistantEl(assistantEl!);
					});
					this.messages.push({ role: "assistant", content: accumulated, source: "codex" });
				} else if (assistantEl) {
					assistantEl.remove();
				}
				this.addMessage("assistant", `Codex 出错: ${error}`, "codex");
				this.isLoading = false;
				this.setSendButtonState(false);
			},
			onDone: (fullText) => {
				if (this.closed) return;
				loadingEl.remove();
				if (typewriterTimer !== null) { window.clearTimeout(typewriterTimer); typewriterTimer = null; }
				if (assistantEl) {
					assistantEl.empty();
					void MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(fullText), assistantEl, "", this.plugin).then(() => {
						assistantEl!.removeClass("ai-daily-msg-streaming");
						this.postProcessAssistantEl(assistantEl!);
					});
					this.messages.push({ role: "assistant", content: fullText, source: "codex" });
				} else if (fullText) {
					this.addMessage("assistant", fullText, "codex");
				}
				this.scrollToBottomIfFollowing();
				void this.persistSession();
				this.isLoading = false;
				this.setSendButtonState(false);
			},
			onSessionId: (id) => {
				this.codexSessionId = id;
				console.log("[ai-daily] Codex session:", id);
			},
		});

		this.codexAbort = handle.abort;
	}

	private claudeCodeAbort: (() => void) | null = null;
	private codexAbort: (() => void) | null = null;
	private claudeCodeSessionId: string | undefined;
	private codexSessionId: string | undefined;
	private restoredProxySessionIds: Partial<Record<"claude-code" | "codex", string>> = {};
	private restoredProxyTaskIds: Partial<Record<"claude-code" | "codex", string>> = {};
	private claudeCodeUndoHistory: { id: number; data: UndoData; description: string }[] = [];
	private claudeCodeUndoCounter = 0;

	private async handleDistillAsMessage(): Promise<void> {
		if (this.messages.length < 2) {
			new Notice("当前对话内容太少，无法蒸馏", 3000);
			return;
		}
		if (this.isLoading) {
			new Notice("请等待当前操作完成", 2000);
			return;
		}
		if (!this.plugin.getEffectiveApiKey()) {
			new Notice("请先在插件设置中配置 API Key", 3000);
			return;
		}

		this.isLoading = true;
		this.setSendButtonState(true);

		this.addMessage("user", "/distill");
		if (!this.sessionId) {
			this.sessionId = newSessionId();
		}

		const loadingEl = this.messagesEl.createDiv({ cls: "ai-daily-loading" });
		loadingEl.createSpan({ text: "蒸馏中" });
		const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
		dotsEl.createEl("span");
		dotsEl.createEl("span");
		dotsEl.createEl("span");

		const useStream = this.plugin.settings.chatStreamMode !== "off";
		let assistantEl: HTMLElement | null = null as HTMLElement | null;
		let streamingRenderTimer: number | null = null;
		let latestStreamingMarkdown = "";
		let streamingRenderQueue = Promise.resolve();

		const renderStreamingMarkdown = async (content: string) => {
			if (!assistantEl) return;
			assistantEl.empty();
			await MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(content), assistantEl, "", this.plugin);
			this.scrollToBottomIfFollowing();
		};
		const scheduleStreamingMarkdown = (content: string) => {
			latestStreamingMarkdown = content;
			if (streamingRenderTimer !== null) return;
			streamingRenderTimer = window.setTimeout(() => {
				streamingRenderTimer = null;
				const snapshot = latestStreamingMarkdown;
				streamingRenderQueue = streamingRenderQueue.then(() =>
					renderStreamingMarkdown(snapshot)
				);
			}, STREAM_MARKDOWN_RENDER_INTERVAL_MS);
		};
		const flushStreamingMarkdown = async (content: string) => {
			latestStreamingMarkdown = content;
			if (streamingRenderTimer !== null) {
				window.clearTimeout(streamingRenderTimer);
				streamingRenderTimer = null;
			}
			await streamingRenderQueue;
			await renderStreamingMarkdown(content);
		};
		const cancelStreamingMarkdown = () => {
			if (streamingRenderTimer !== null) {
				window.clearTimeout(streamingRenderTimer);
				streamingRenderTimer = null;
			}
		};

		try {
			const { systemPrompt, userMessage } = await prepareDistillation(
				this.app, this.messages, {
					knowledgeFolders: this.plugin.settings.knowledgeFolders,
					targetFolder: this.plugin.settings.distillTargetFolder,
				}
			);

			const distillClient = new ClaudeClient(
				this.plugin.getEffectiveApiKey(),
				this.plugin.settings.model,
				systemPrompt,
				{ streamMode: this.plugin.settings.chatStreamMode, enableWebSearch: false }
			);

			const vaultTools = new VaultTools(this.app, this.plugin.settings.knowledgeFolders);

			let toolCallsEl: HTMLElement | null = null;
			let toolCallsSummaryEl: HTMLElement | null = null;
			const toolCallEls = new Map<string, HTMLElement>();
			let toolCallCounter = 0;
			let toolTotal = 0;
			let toolRunning = 0;

			const onToolCall = (name: string, input: Record<string, unknown>, status: "start" | "done" | "error") => {
				if (status === "start") {
					loadingEl.remove();
					if (!toolCallsEl) {
						const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
						const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
						toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
						toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
					}
					toolTotal++;
					toolRunning++;
					const key = `${name}-${toolCallCounter++}`;
					const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
					const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
					setIcon(iconSpan, "loader");
					el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
					toolCallEls.set(key, el);
					this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
					this.scrollToBottomIfFollowing();
				} else {
					const lastKey = `${name}-${toolCallCounter - 1}`;
					const el = toolCallEls.get(lastKey);
					if (el) {
						el.removeClass("ai-daily-tool-call-running");
						el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
						const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
						if (iconSpan) {
							iconSpan.empty();
							setIcon(iconSpan as HTMLElement, status === "done" ? "check" : "x");
						}
						toolRunning--;
						this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
					}
				}
			};

			const reply = await distillClient.chat(
				userMessage,
				(name, input) => vaultTools.execute(name, input),
				useStream
					? (_delta, accumulated) => {
							loadingEl.remove();
							if (!assistantEl) {
								assistantEl = this.messagesEl.createDiv({
									cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming",
								});
							}
							scheduleStreamingMarkdown(accumulated);
						}
					: undefined,
				undefined,
				onToolCall
			);

			loadingEl.remove();

			if (useStream && assistantEl) {
				await flushStreamingMarkdown(reply || "*(已停止)*");
				this.postProcessAssistantEl(assistantEl);
				assistantEl.removeClass("ai-daily-msg-streaming");
				this.messages.push({ role: "assistant", content: reply || "*(已停止)*", source: "api" });
			} else if (reply) {
				this.addMessage("assistant", reply, "api");
			}
			this.scrollToBottomIfFollowing();
			await this.persistSession();
			new Notice("知识蒸馏完成", 3000);
		} catch (e) {
			cancelStreamingMarkdown();
			loadingEl.remove();
			if (assistantEl && latestStreamingMarkdown) {
				assistantEl.removeClass("ai-daily-msg-streaming");
				this.messages.push({ role: "assistant", content: latestStreamingMarkdown });
			} else if (assistantEl) {
				assistantEl.remove();
			}
			const msg = e instanceof Error ? e.message : String(e);
			this.addMessage("assistant", `蒸馏失败: ${msg}`);
		} finally {
			this.isLoading = false;
			this.setSendButtonState(false);
		}
	}

	private async handleDistill(): Promise<void> {
		if (this.messages.length < 2) {
			new Notice("当前对话内容太少，无法蒸馏", 3000);
			return;
		}
		if (this.isLoading) {
			new Notice("请等待当前操作完成", 2000);
			return;
		}
		if (!this.plugin.getEffectiveApiKey()) {
			new Notice("请先在插件设置中配置 API Key", 3000);
			return;
		}

		this.isLoading = true;
		const notice = new Notice("正在蒸馏对话知识...", 0);
		try {
			const result = await distillConversation(this.app, this.messages, {
				apiKey: this.plugin.getEffectiveApiKey(),
				model: this.plugin.settings.model,
				knowledgeFolders: this.plugin.settings.knowledgeFolders,
				targetFolder: this.plugin.settings.distillTargetFolder,
			});
			notice.hide();
			this.addMessage("assistant", result);
			await this.persistSession();
			new Notice("知识蒸馏完成", 3000);
		} catch (e) {
			notice.hide();
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`蒸馏失败: ${msg}`, 5000);
		} finally {
			this.isLoading = false;
		}
	}

	addHealthCheckReport(report: string, fixableResult?: HealthCheckResult): void {
		this.addMessage("assistant", report);
		if (fixableResult) {
			const bar = this.messagesEl.createDiv({ cls: "ai-daily-health-fix-bar" });
			const btn = bar.createEl("button", {
				cls: "ai-daily-health-fix-btn",
				text: "一键修复",
			});
			setIcon(btn.createSpan({ cls: "ai-daily-health-fix-icon" }), "wrench");
			btn.addEventListener("click", () => {
				bar.remove();
				this.handleHealthFix(fixableResult);
			});
		}
	}

	private async handleHealthFix(result: HealthCheckResult): Promise<void> {
		if (this.isLoading) {
			new Notice("请等待当前操作完成", 2000);
			return;
		}
		if (!this.plugin.getEffectiveApiKey()) {
			new Notice("请先在插件设置中配置 API Key", 3000);
			return;
		}

		this.isLoading = true;
		this.setSendButtonState(true);

		this.addMessage("user", "修复知识库问题");
		if (!this.sessionId) {
			this.sessionId = newSessionId();
		}

		const loadingEl = this.messagesEl.createDiv({ cls: "ai-daily-loading" });
		loadingEl.createSpan({ text: "修复中" });
		const dotsEl = loadingEl.createSpan({ cls: "ai-daily-loading-dots" });
		dotsEl.createEl("span");
		dotsEl.createEl("span");
		dotsEl.createEl("span");

		const useStream = this.plugin.settings.chatStreamMode !== "off";
		let assistantEl: HTMLElement | null = null as HTMLElement | null;
		let streamingRenderTimer: number | null = null;
		let latestStreamingMarkdown = "";
		let streamingRenderQueue = Promise.resolve();

		const renderStreamingMarkdown = async (content: string) => {
			if (!assistantEl) return;
			assistantEl.empty();
			await MarkdownRenderer.render(this.app, normalizeMarkdownForObsidian(content), assistantEl, "", this.plugin);
			this.scrollToBottomIfFollowing();
		};
		const scheduleStreamingMarkdown = (content: string) => {
			latestStreamingMarkdown = content;
			if (streamingRenderTimer !== null) return;
			streamingRenderTimer = window.setTimeout(() => {
				streamingRenderTimer = null;
				const snapshot = latestStreamingMarkdown;
				streamingRenderQueue = streamingRenderQueue.then(() =>
					renderStreamingMarkdown(snapshot)
				);
			}, STREAM_MARKDOWN_RENDER_INTERVAL_MS);
		};
		const flushStreamingMarkdown = async (content: string) => {
			latestStreamingMarkdown = content;
			if (streamingRenderTimer !== null) {
				window.clearTimeout(streamingRenderTimer);
				streamingRenderTimer = null;
			}
			await streamingRenderQueue;
			await renderStreamingMarkdown(content);
		};
		const cancelStreamingMarkdown = () => {
			if (streamingRenderTimer !== null) {
				window.clearTimeout(streamingRenderTimer);
				streamingRenderTimer = null;
			}
		};

		try {
			const { systemPrompt, userMessage } = prepareHealthFix(
				result, this.plugin.settings.knowledgeFolders
			);

			const fixClient = new ClaudeClient(
				this.plugin.getEffectiveApiKey(),
				this.plugin.settings.model,
				systemPrompt,
				{ streamMode: this.plugin.settings.chatStreamMode, enableWebSearch: false }
			);

			const vaultTools = new VaultTools(this.app, this.plugin.settings.knowledgeFolders);

			let toolCallsEl: HTMLElement | null = null;
			let toolCallsSummaryEl: HTMLElement | null = null;
			const toolCallEls = new Map<string, HTMLElement>();
			let toolCallCounter = 0;
			let toolTotal = 0;
			let toolRunning = 0;

			const onToolCall = (name: string, input: Record<string, unknown>, status: "start" | "done" | "error") => {
				if (status === "start") {
					loadingEl.remove();
					if (!toolCallsEl) {
						const wrapper = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
						const detailsEl = wrapper.createEl("details", { cls: "ai-daily-tool-calls-details" });
						toolCallsSummaryEl = detailsEl.createEl("summary", { cls: "ai-daily-tool-calls-summary" });
						toolCallsEl = detailsEl.createDiv({ cls: "ai-daily-tool-calls-list" });
					}
					toolTotal++;
					toolRunning++;
					const key = `${name}-${toolCallCounter++}`;
					const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
					const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
					setIcon(iconSpan, "loader");
					el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
					toolCallEls.set(key, el);
					this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
					this.scrollToBottomIfFollowing();
				} else {
					const lastKey = `${name}-${toolCallCounter - 1}`;
					const el = toolCallEls.get(lastKey);
					if (el) {
						el.removeClass("ai-daily-tool-call-running");
						el.addClass(status === "done" ? "ai-daily-tool-call-done" : "ai-daily-tool-call-error");
						const iconSpan = el.querySelector(".ai-daily-tool-call-icon");
						if (iconSpan) {
							iconSpan.empty();
							setIcon(iconSpan as HTMLElement, status === "done" ? "check" : "x");
						}
						toolRunning--;
						this.updateToolCallsSummary(toolCallsSummaryEl!, toolTotal, toolRunning);
					}
				}
			};

			const reply = await fixClient.chat(
				userMessage,
				(name, input) => vaultTools.execute(name, input),
				useStream
					? (_delta, accumulated) => {
							loadingEl.remove();
							if (!assistantEl) {
								assistantEl = this.messagesEl.createDiv({
									cls: "ai-daily-msg ai-daily-msg-assistant ai-daily-msg-streaming",
								});
							}
							scheduleStreamingMarkdown(accumulated);
						}
					: undefined,
				undefined,
				onToolCall
			);

			loadingEl.remove();

			if (useStream && assistantEl) {
				await flushStreamingMarkdown(reply || "*(修复完成)*");
				this.postProcessAssistantEl(assistantEl);
				assistantEl.removeClass("ai-daily-msg-streaming");
				this.messages.push({ role: "assistant", content: reply || "*(修复完成)*", source: "api" });
			} else if (reply) {
				this.addMessage("assistant", reply, "api");
			}
			this.renderUndoBar();
			this.scrollToBottomIfFollowing();
			await this.persistSession();
			new Notice("知识库修复完成", 3000);
		} catch (e) {
			cancelStreamingMarkdown();
			loadingEl.remove();
			if (assistantEl && latestStreamingMarkdown) {
				assistantEl.removeClass("ai-daily-msg-streaming");
				this.messages.push({ role: "assistant", content: latestStreamingMarkdown });
			} else if (assistantEl) {
				assistantEl.remove();
			}
			const msg = e instanceof Error ? e.message : String(e);
			this.addMessage("assistant", `修复失败: ${msg}`);
		} finally {
			this.isLoading = false;
			this.setSendButtonState(false);
		}
	}

	private async forkAtMessage(assistantMsgIdx: number): Promise<void> {
		if (this.isLoading) return;
		if (assistantMsgIdx < 1) return;

		const assistantMsg = this.messages[assistantMsgIdx];
		const userMsg = this.messages[assistantMsgIdx - 1];
		if (assistantMsg?.role !== "assistant" || userMsg?.role !== "user") return;

		const removedCount = this.messages.length - (assistantMsgIdx - 1);
		const rewoundUserText = userMsg.content;

		this.messages.splice(assistantMsgIdx - 1);

		this.client?.clearProxySessionId();
		this.claudeCodeSessionId = undefined;
		this.codexSessionId = undefined;

		if (this.client) {
			const keepCount = this.messages.filter((m) => m.source === "api" || m.source === "proxy").length;
			while (this.client.getMessagesSnapshot().length > keepCount) {
				if (!this.client.rewindLastTurn()) break;
			}
		}

		const msgEls = this.messagesEl.querySelectorAll(".ai-daily-msg");
		const allEls = Array.from(this.messagesEl.children);
		const remainingMsgCount = this.messages.length;
		if (msgEls.length > remainingMsgCount) {
			const firstToRemove = msgEls[remainingMsgCount];
			const startIdx = allEls.indexOf(firstToRemove);
			if (startIdx >= 0) {
				for (let i = allEls.length - 1; i >= startIdx; i--) {
					allEls[i].remove();
				}
			}
		}

		this.cachedTokenCount = this.messages.reduce(
			(sum, m) => sum + estimateTextTokens(m.content), 0
		);
		this.updateTokenBar();
		this.updateForkButtons();

		this.inputEl.value = rewoundUserText;
		this.inputEl.focus();

		await this.persistSession();
		const turnsRemoved = Math.floor(removedCount / 2);
		new Notice(`已分叉，移除 ${turnsRemoved} 轮对话，下次发送将创建新会话`, 3000);
	}

	private async saveSessionAsNote(): Promise<void> {
		if (!this.sessionId || this.messages.length === 0) return;
		const lines: string[] = [];
		for (const m of this.messages) {
			lines.push(m.role === "user" ? `**User:**\n${m.content}` : `**Assistant:**\n${m.content}`);
			lines.push("");
		}
		const content = lines.join("\n");
		const title = titleFromMessages(this.messages.map((m) => ({ role: m.role, content: m.content })));
		const ws = this.harnessContext?.workspace;
		const folder = ws
			? `${this.plugin.settings.harnessProjectsFolder}/${ws}`
			: this.plugin.settings.knowledgeFolders[0] || "Raw";
		const fileName = `${folder}/${title}.md`;
		try {
			const existing = this.app.vault.getAbstractFileByPath(fileName);
			if (existing) {
				new Notice(`笔记已存在: ${fileName}`, 3000);
				return;
			}
			await this.app.vault.create(fileName, content);
			new Notice(`已保存为笔记: ${fileName}`, 3000);
		} catch (e) {
			new Notice(`保存失败: ${e instanceof Error ? e.message : String(e)}`, 5000);
		}
	}

	private copySessionText(): void {
		if (this.messages.length === 0) return;
		const lines: string[] = [];
		for (const m of this.messages) {
			lines.push(m.role === "user" ? `**User:**\n${m.content}` : `**Assistant:**\n${m.content}`);
			lines.push("");
		}
		navigator.clipboard.writeText(lines.join("\n")).then(() => {
			new Notice("已复制全文", 2000);
		});
	}

	private renameCurrentSession(): void {
		if (!this.sessionId) return;
		const currentTitle = titleFromMessages(this.messages.map((m) => ({ role: m.role, content: m.content })));
		const modal = new RenameModal(this.app, currentTitle, async (newTitle) => {
			if (!this.sessionId) return;
			await renameSession(
				this.app.vault,
				this.plugin.settings.chatHistoryFolder,
				this.sessionId,
				newTitle
			);
			new Notice(`已重命名为「${newTitle}」`, 2000);
		});
		modal.open();
	}

	private async togglePinCurrentSession(): Promise<void> {
		if (!this.sessionId) return;
		const pinned = await togglePinSession(
			this.app.vault,
			this.plugin.settings.chatHistoryFolder,
			this.sessionId
		);
		new Notice(pinned ? "已置顶" : "已取消置顶", 2000);
	}

	private deleteCurrentSession(): void {
		if (!this.sessionId) return;
		const title = titleFromMessages(this.messages.map((m) => ({ role: m.role, content: m.content })));
		new ConfirmModal(
			this.app,
			`确定删除对话「${title}」？此操作不可撤销。`,
			async () => {
				if (!this.sessionId) return;
				await deleteChatSessionFile(
					this.app.vault,
					this.plugin.settings.chatHistoryFolder,
					this.sessionId
				);
				this.clearChat();
				new Notice("对话已删除", 2000);
			}
		).open();
	}

	private clearChat(): void {
		this.client?.abort();
		this.sessionId = null;
		this.messages = [];
		this.cachedTokenCount = 0;
		this.client = null;
		this.vaultTools = null;
		this.harnessContext = null;
		this.claudeCodeSessionId = undefined;
		this.codexSessionId = undefined;
		this.claudeCodeUndoHistory = [];
		this.restoredProxySessionIds = {};
		this.restoredProxyTaskIds = {};
		this.lastMode = null;
		this.attachedFiles = [];
		this.renderAttachBar();
		this.messagesEl.empty();
		this.showWelcome();
		if (this.moreBtnEl) this.moreBtnEl.style.display = "none";
	}

	private updateHistoryOverlayInset(): void {
		if (!this.historyOverlay || !this.chatContainerEl) return;
		const topInset = this.headerEl?.offsetHeight ?? 0;
		const bottomInset =
			(this.tokenBarEl?.offsetHeight ?? 0) + (this.inputAreaEl?.offsetHeight ?? 0);
		this.historyOverlay.setAttribute(
			"style",
			`inset:${topInset}px 0 ${bottomInset}px 0;`
		);
	}

	private closeHistoryOverlay(): void {
		if (this.historyOverlay) {
			this.historyOverlay.remove();
			this.historyOverlay = null;
		}
		if (this.historyOverlayResizeCleanup) {
			this.historyOverlayResizeCleanup();
			this.historyOverlayResizeCleanup = null;
		}
	}

	private static WORKSPACE_COLORS = [
		"#e07a3a", "#5b9bd5", "#6bc26b", "#c25b8e",
		"#9b7ed8", "#d4a843", "#4abfbf", "#d45b5b",
	];

	private workspaceColorMap = new Map<string, string>();

	private getWorkspaceColor(ws: string): string {
		if (this.workspaceColorMap.has(ws)) return this.workspaceColorMap.get(ws)!;
		const idx = this.workspaceColorMap.size % ChatView.WORKSPACE_COLORS.length;
		const color = ChatView.WORKSPACE_COLORS[idx];
		this.workspaceColorMap.set(ws, color);
		return color;
	}

	private formatHistoryTime(dateStr: string): string {
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return "";
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		if (diffMins < 60) return `${diffMins} 分钟前`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24 && d.getDate() === now.getDate()) {
			const h = d.getHours();
			const m = d.getMinutes().toString().padStart(2, "0");
			const period = h >= 12 ? "下午" : "上午";
			const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
			return `${period} ${h12.toString().padStart(2, "0")}:${m}`;
		}
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 1);
		if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) {
			return "昨天";
		}
		const diffDays = Math.floor(diffMs / 86400000);
		if (diffDays < 7) return `${diffDays} 天前`;
		return `${d.getMonth() + 1}月${d.getDate()}日`;
	}

	private getTimeGroup(dateStr: string): string {
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return "更早";
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		if (d >= todayStart) return "今天";
		const yesterdayStart = new Date(todayStart);
		yesterdayStart.setDate(yesterdayStart.getDate() - 1);
		if (d >= yesterdayStart) return "昨天";
		const weekAgo = new Date(todayStart);
		weekAgo.setDate(weekAgo.getDate() - 7);
		if (d >= weekAgo) return "本周";
		return "更早";
	}

	private async openHistoryPanel(): Promise<void> {
		if (this.historyOverlay) { this.closeHistoryOverlay(); return; }
		const { chatHistoryFolder } = this.plugin.settings;
		let sessions = await listChatSessions(this.app.vault, chatHistoryFolder);

		const overlay = this.chatContainerEl.createDiv({
			cls: "ai-daily-history-overlay",
		});
		this.historyOverlay = overlay;
		this.updateHistoryOverlayInset();
		const onViewportResize = () => this.updateHistoryOverlayInset();
		window.addEventListener("resize", onViewportResize);
		window.visualViewport?.addEventListener("resize", onViewportResize);
		window.visualViewport?.addEventListener("scroll", onViewportResize);
		this.historyOverlayResizeCleanup = () => {
			window.removeEventListener("resize", onViewportResize);
			window.visualViewport?.removeEventListener("resize", onViewportResize);
			window.visualViewport?.removeEventListener("scroll", onViewportResize);
		};

		// Header: back + title + filter
		const head = overlay.createDiv({ cls: "ai-daily-history-head" });
		const backBtn = head.createDiv({ cls: "ai-daily-history-back" });
		setIcon(backBtn, "chevron-left");
		backBtn.addEventListener("click", () => this.closeHistoryOverlay());
		head.createEl("span", { text: "历史", cls: "ai-daily-history-title" });
		const headActions = head.createDiv({ cls: "ai-daily-history-head-actions" });
		const clearAllBtn = headActions.createSpan({ cls: "ai-daily-history-clear-all" });
		setIcon(clearAllBtn, "trash-2");
		clearAllBtn.setAttribute("title", "清空全部");
		clearAllBtn.addEventListener("click", () => {
			if (sessions.length === 0) return;
			new ConfirmModal(
				this.app,
				`确定删除全部 ${sessions.length} 条历史对话？此操作不可撤销。`,
				async () => {
					for (const s of sessions) {
						await deleteChatSessionFile(this.app.vault, chatHistoryFolder, s.id);
					}
					if (this.sessionId && sessions.some((s) => s.id === this.sessionId)) {
						this.clearChat();
					}
					sessions = [];
					renderList([]);
					new Notice("已清空所有历史对话", 3000);
				}
			).open();
		});

		// Search
		const searchWrap = overlay.createDiv({ cls: "ai-daily-history-search-wrap" });
		const searchIcon = searchWrap.createSpan({ cls: "ai-daily-history-search-icon" });
		setIcon(searchIcon, "search");
		const search = searchWrap.createEl("input", {
			cls: "ai-daily-history-search",
			type: "search",
			attr: { placeholder: "搜索历史对话..." },
		});

		// Group toggle: 时间 / 模式
		let groupByMode = false;
		const toggleWrap = overlay.createDiv({ cls: "ai-daily-history-toggle-wrap" });
		toggleWrap.createSpan({ cls: "ai-daily-history-toggle-label", text: "分组" });
		const toggleGroup = toggleWrap.createDiv({ cls: "ai-daily-history-toggle-group" });
		const btnTime = toggleGroup.createSpan({ cls: "ai-daily-history-toggle-btn is-active", text: "时间" });
		const btnMode = toggleGroup.createSpan({ cls: "ai-daily-history-toggle-btn", text: "模式" });
		const setGroupMode = (byMode: boolean) => {
			groupByMode = byMode;
			btnTime.toggleClass("is-active", !byMode);
			btnMode.toggleClass("is-active", byMode);
			const q = search.value.trim().toLowerCase();
			const filtered = q ? sessions.filter((s) => matchSession(s, q)) : sessions;
			renderList(filtered);
		};
		btnTime.addEventListener("click", () => setGroupMode(false));
		btnMode.addEventListener("click", () => setGroupMode(true));

		const listEl = overlay.createDiv({ cls: "ai-daily-history-list" });

		const renderList = (items: ChatSessionFile[]) => {
			listEl.empty();

			if (items.length === 0) {
				listEl.createDiv({ cls: "ai-daily-history-empty", text: "暂无历史会话" });
				return;
			}

			const pinned = items.filter((s) => s.pinned);
			const unpinned = items.filter((s) => !s.pinned);

			if (pinned.length > 0) {
				renderGroup("置顶", pinned, true);
			}

			if (groupByMode) {
				const modeGroups = new Map<string, { emoji: string; label: string; items: ChatSessionFile[] }>();
				for (const s of unpinned) {
					const mode = s.harnessContext?.mode;
					const key = mode?.id ?? "__free__";
					const existing = modeGroups.get(key);
					if (existing) {
						existing.items.push(s);
					} else {
						modeGroups.set(key, {
							emoji: mode?.emoji ?? "💬",
							label: mode?.label ?? "自由对话",
							items: [s],
						});
					}
				}
				for (const [, group] of modeGroups) {
					renderModeGroup(group.emoji, group.label, group.items);
				}
			} else {
				const timeGroups = new Map<string, ChatSessionFile[]>();
				const groupOrder = ["今天", "昨天", "本周", "更早"];
				for (const s of unpinned) {
					const g = this.getTimeGroup(s.updated);
					const arr = timeGroups.get(g) ?? [];
					arr.push(s);
					timeGroups.set(g, arr);
				}
				for (const g of groupOrder) {
					const arr = timeGroups.get(g);
					if (arr && arr.length > 0) renderGroup(g, arr, false);
				}
			}
		};

		const renderGroup = (label: string, items: ChatSessionFile[], isPinned: boolean) => {
			const groupEl = listEl.createDiv({ cls: "ai-daily-history-group" });
			groupEl.createDiv({ cls: "ai-daily-history-group-label", text: label });
			for (const s of items) renderSession(s, groupEl, isPinned);
		};

		const renderModeGroup = (emoji: string, label: string, items: ChatSessionFile[]) => {
			const groupEl = listEl.createDiv({ cls: "ai-daily-history-group" });
			const header = groupEl.createDiv({ cls: "ai-daily-history-mode-header" });
			header.createSpan({ cls: "ai-daily-history-mode-emoji", text: emoji });
			header.createSpan({ cls: "ai-daily-history-mode-label", text: label });
			header.createSpan({ cls: "ai-daily-history-mode-count", text: String(items.length) });
			for (const s of items) renderSession(s, groupEl, false);
		};

		const renderSession = (s: ChatSessionFile, parent: HTMLElement, isPinned: boolean) => {
			const ws = s.workspace || s.harnessContext?.workspace || "";
			const color = ws ? this.getWorkspaceColor(ws) : "var(--text-faint)";
			const row = parent.createDiv({
				cls: `ai-daily-history-row${isPinned ? " ai-daily-history-row--pinned" : ""}`,
			});

			// Left color indicator
			const dot = row.createSpan({ cls: "ai-daily-history-row-dot" });
			dot.style.background = color;
			if (isPinned) {
				dot.style.background = "var(--interactive-accent)";
				const pinIcon = row.createSpan({ cls: "ai-daily-history-row-pin-icon" });
				setIcon(pinIcon, "pin");
			}

			// Info
			const info = row.createDiv({ cls: "ai-daily-history-row-info" });
			info.createDiv({
				cls: "ai-daily-history-row-title",
				text: s.title || s.id,
			});
			const metaParts = [ws, this.formatHistoryTime(s.updated)].filter(Boolean).join(" · ");
			info.createDiv({
				cls: "ai-daily-history-row-meta",
				text: metaParts,
			});

			// Mode chip
			const modeLabel = s.harnessContext?.mode?.label;
			if (modeLabel) {
				const chip = row.createSpan({ cls: "ai-daily-history-row-chip" });
				chip.textContent = modeLabel;
			}

			// Delete button (visible on desktop hover, mobile long-press)
			const delBtn = row.createSpan({ cls: "ai-daily-history-row-delete" });
			setIcon(delBtn, "x");
			delBtn.setAttribute("title", "删除此对话");
			const confirmDelete = () => {
				new ConfirmModal(
					this.app,
					`确定删除对话「${s.title || s.id}」？此操作不可撤销。`,
					async () => {
						await deleteChatSessionFile(this.app.vault, chatHistoryFolder, s.id);
						sessions = sessions.filter((x) => x.id !== s.id);
						if (this.sessionId === s.id) this.clearChat();
						const q = search.value.trim().toLowerCase();
						renderList(q ? sessions.filter((x) => matchSession(x, q)) : sessions);
						new Notice("已删除对话", 2000);
					}
				).open();
			};
			delBtn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				confirmDelete();
			});

			// Long-press to reveal delete button (mobile)
			let longPressTimer: ReturnType<typeof setTimeout> | null = null;
			let longPressed = false;
			row.addEventListener("touchstart", (ev) => {
				longPressed = false;
				longPressTimer = setTimeout(() => {
					longPressed = true;
					row.addClass("ai-daily-history-row--show-delete");
					// dismiss on next tap anywhere
					const dismiss = (e: Event) => {
						if (!row.contains(e.target as Node) || e.target === row || info.contains(e.target as Node)) {
							row.removeClass("ai-daily-history-row--show-delete");
						}
						document.removeEventListener("touchstart", dismiss, true);
					};
					setTimeout(() => document.addEventListener("touchstart", dismiss, true), 50);
				}, 500);
			}, { passive: true });
			row.addEventListener("touchend", () => {
				if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
			});
			row.addEventListener("touchmove", () => {
				if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
			});

			row.addEventListener("click", () => {
				if (longPressed) { longPressed = false; return; }
				void this.loadSession(s.id);
				this.closeHistoryOverlay();
			});
		};

		const matchSession = (s: ChatSessionFile, q: string): boolean => {
			if (s.title.toLowerCase().includes(q)) return true;
			if (s.id.toLowerCase().includes(q)) return true;
			if ((s.workspace || "").toLowerCase().includes(q)) return true;
			if ((s.harnessContext?.mode?.label || "").toLowerCase().includes(q)) return true;
			return false;
		};

		renderList(sessions);

		search.addEventListener("input", () => {
			const q = search.value.trim().toLowerCase();
			if (!q) {
				renderList(sessions);
				return;
			}
			renderList(sessions.filter((s) => matchSession(s, q)));
		});

		overlay.addEventListener("click", (ev) => {
			if (ev.target === overlay) this.closeHistoryOverlay();
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
		this.claudeCodeSessionId = data.claudeCodeSessionId;
		this.codexSessionId = data.codexSessionId;
		this.restoredProxySessionIds = {
			"claude-code": data.claudeCodeProxySessionId,
			codex: data.codexProxySessionId,
		};
		this.restoredProxyTaskIds = {
			"claude-code": data.claudeCodeProxyTaskId,
			codex: data.codexProxyTaskId,
		};
		// Migrate the former shared field only when its backend is known. An
		// unlabelled ID must not be resumed by the wrong CLI.
		if (data.proxySessionId && data.proxySessionBackend) {
			this.restoredProxySessionIds[data.proxySessionBackend] ??= data.proxySessionId;
		}
		if (data.proxyTaskId && data.proxySessionBackend) {
			this.restoredProxyTaskIds[data.proxySessionBackend] ??= data.proxyTaskId;
		}
		this.harnessContext = data.harnessContext
			? { ...data.harnessContext, mode: { ...data.harnessContext.mode, actions: data.harnessContext.mode.actions ?? [] } }
			: null;
		this.lastMode = data.lastMode ?? null;
		this.messages = data.messages.map((m) => ({
			role: m.role,
			content: m.content,
			source: m.source,
		}));
		this.cachedTokenCount = this.messages.reduce(
			(sum, m) => sum + estimateTextTokens(m.content), 0
		);
		this.client = null;
		this.vaultTools = null;
		this.messagesEl.empty();
		const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
		if (welcome) welcome.remove();
		if (this.moreBtnEl) this.moreBtnEl.style.display = "";

		if (this.harnessContext) {
			const ctx = this.harnessContext;
			const banner = this.messagesEl.createDiv({ cls: "ai-daily-ctx-header" });
			const row = banner.createDiv({ cls: "ai-daily-ctx-row" });
			const modeIcon = row.createDiv({ cls: "ai-daily-ctx-icon" });
			modeIcon.textContent = ctx.mode.emoji;
			const info = row.createDiv({ cls: "ai-daily-ctx-info" });
			info.createDiv({ cls: "ai-daily-ctx-mode", text: ctx.mode.label });
			if (ctx.workspace) {
				info.createDiv({ cls: "ai-daily-ctx-ws", text: ctx.workspace });
			}
			if (ctx.injectedFiles.length > 0) {
				let expanded = false;
				const toggle = row.createSpan({
					cls: "ai-daily-ctx-toggle",
					text: `${ctx.injectedFiles.length} files ⌄`,
				});
				toggle.addEventListener("click", (ev) => {
					ev.stopPropagation();
					expanded = !expanded;
					banner.toggleClass("ai-daily-ctx-expanded", expanded);
					toggle.textContent = expanded
						? `${ctx.injectedFiles.length} files ⌃`
						: `${ctx.injectedFiles.length} files ⌄`;
				});
				const detail = banner.createDiv({ cls: "ai-daily-ctx-detail" });
				detail.createDiv({ cls: "ai-daily-ctx-detail-label", text: `已注入 ${ctx.injectedFiles.length} 个文件` });
				const pills = detail.createDiv({ cls: "ai-daily-ctx-pills" });
				for (const f of ctx.injectedFiles) {
					const pill = pills.createSpan({ cls: "ai-daily-ctx-pill" });
					const fIcon = pill.createSpan({ cls: "ai-daily-ctx-pill-icon" });
					setIcon(fIcon, "file-text");
					const displayName = f.path.replace(/^.*\//, "").replace(/\.md$/, "");
					pill.createSpan({ text: displayName });
					pill.setAttribute("title", f.path);
				}
			}
		}

		for (const m of this.messages) {
			const msgEl = this.messagesEl.createDiv({
				cls: `ai-daily-msg ai-daily-msg-${m.role}`,
			});
			if (m.role === "assistant") {
				await MarkdownRenderer.render(
					this.app,
					normalizeMarkdownForObsidian(m.content),
					msgEl,
					"",
					this.plugin
				);
				this.postProcessAssistantEl(msgEl);
			} else {
				msgEl.setText(m.content);
			}
		}
		await this.initClient();
		this.restoreProxyHandlesToClient();
		this.client!.setHistoryFromStrings(
			this.messages.map((m) => ({
				role: m.role,
				content: m.content,
			}))
		);
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		this.updateTokenBar();
		new Notice("已恢复历史对话", 3000);

		if (this.plugin.settings.proxyEnabled && this.plugin.settings.proxyUrl) {
			const backend = this.plugin.settings.cliBackend;
			const taskId = this.client!.getProxyTaskId(backend);
			if (taskId) void this.recoverProxyTask(taskId, backend);
		}
	}

	private restoreProxyHandlesToClient(): void {
		if (!this.client) return;
		for (const backend of ["claude-code", "codex"] as const) {
			const sessionId = this.restoredProxySessionIds[backend];
			const taskId = this.restoredProxyTaskIds[backend];
			if (sessionId) this.client.setProxySessionId(backend, sessionId);
			if (taskId) this.client.setProxyTaskId(backend, taskId);
		}
		this.restoredProxySessionIds = {};
		this.restoredProxyTaskIds = {};
	}

	private async recoverProxyTask(taskId: string, backend: "claude-code" | "codex"): Promise<void> {
		const proxyUrl = this.plugin.settings.proxyUrl?.trim();
		const baseUrl = proxyUrl && !/^https?:\/\//i.test(proxyUrl) ? `https://${proxyUrl}` : proxyUrl;
		if (!baseUrl || !this.plugin.settings.proxyToken) return;

		try {
			const resp = await fetch(`${baseUrl}/task/${taskId}`, {
				headers: { Authorization: `Bearer ${this.plugin.settings.proxyToken}` },
			});
			if (!resp.ok) return;

			const data = await resp.json() as {
				status: string;
				chunks: string[];
				result?: string;
				sessionId?: string;
			};

			if (data.sessionId && this.client) {
				this.client.setProxySessionId(backend, data.sessionId);
			}

			if (data.status === "done" && data.result) {
				const lastMsg = this.messages[this.messages.length - 1];
				if (lastMsg?.role === "user" || (lastMsg?.role === "assistant" && lastMsg.content !== data.result)) {
					if (lastMsg?.role === "assistant") {
						this.messages.pop();
						const lastEl = this.messagesEl.querySelector(".ai-daily-msg-assistant:last-child");
						if (lastEl) lastEl.remove();
					}
					this.addMessage("assistant", data.result, "proxy");
					this.scrollToBottomIfFollowing();
					await this.persistSession();
					new Notice("已恢复代理任务的完整回复", 4000);
				}
			} else if (data.status === "running") {
				new Notice("代理任务仍在运行中，请稍后刷新", 4000);
			}
		} catch (e) {
			console.warn("[ai-daily] proxy task recovery failed:", e);
		}
	}

	async onClose(): Promise<void> {
		this.closed = true;
		if (this.claudeCodeAbort) {
			this.claudeCodeAbort();
			this.claudeCodeAbort = null;
		}
		if (this.codexAbort) {
			this.codexAbort();
			this.codexAbort = null;
		}
		this.client?.abort();
		this.closeHistoryOverlay();
		this.closeTemplatePopup();
		this.closeMentionPopup();
	}
}
