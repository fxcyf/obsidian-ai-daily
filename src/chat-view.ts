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
} from "obsidian";
import type AIDailyChat from "./main";
import { ClaudeClient, estimateTextTokens, type ToolResultContent } from "./claude";
import { VaultTools, type UndoEntry } from "./vault-tools";
import { WebTools } from "./web-tools";
import type { PromptTemplate } from "./settings";
import { extractLocalImageRefs, prepareLocalImages } from "./image-tools";
import type { PreparedImage } from "./image-tools";
import { distillConversation } from "./knowledge-agent";
import { isClaudeCodeAvailable, spawnClaudeCode, getMcpServerPath, type UndoData } from "./claude-code";
import {
	newSessionId,
	titleFromMessages,
	saveChatSession,
	loadChatSession,
	listChatSessions,
	deleteChatSessionFile,
	pruneOldSessions,
	type ChatSessionFile,
	type PersistedMessage,
} from "./chat-session";

export const VIEW_TYPE = "ai-daily-chat";
const STREAM_MARKDOWN_RENDER_INTERVAL_MS = 120;

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
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

export class ChatView extends ItemView {
	plugin: AIDailyChat;
	private chatContainerEl!: HTMLElement;
	private headerEl!: HTMLElement;
	private messages: ChatMessage[] = [];
	private client: ClaudeClient | null = null;
	private vaultTools: VaultTools | null = null;
	private webTools: WebTools = new WebTools();
	private messagesEl!: HTMLElement;
	private inputAreaEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private tokenBarEl!: HTMLElement;
	private historyOverlay: HTMLElement | null = null;
	private historyOverlayResizeCleanup: (() => void) | null = null;
	private templatePopupEl: HTMLElement | null = null;
	private isLoading = false;
	private userScrolledUp = false;
	private cachedTokenCount = 0;
	private sessionId: string | null = null;
	private attachedFiles: TFile[] = [];
	private attachBarEl: HTMLElement | null = null;
	private mentionPopupEl: HTMLElement | null = null;
	private mentionStartPos: number | null = null;

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

		const feedBtn = this.headerEl.createDiv({
			cls: "ai-daily-header-btn ai-daily-header-btn-primary",
			attr: { "aria-label": "生成 Feed", title: "生成 Feed" },
		});
		setIcon(feedBtn, "rss");
		feedBtn.addEventListener("click", () => this.plugin.generateFeed());

		const historyBtn = this.headerEl.createDiv({
			cls: "ai-daily-header-btn",
			attr: { "aria-label": "历史", title: "历史" },
		});
		setIcon(historyBtn, "history");
		historyBtn.addEventListener("click", () => this.openHistoryPanel());

		const distillBtn = this.headerEl.createDiv({
			cls: "ai-daily-header-btn",
			attr: { "aria-label": "蒸馏知识", title: "蒸馏知识" },
		});
		setIcon(distillBtn, "sparkles");
		distillBtn.addEventListener("click", () => this.handleDistill());

		const newChatBtn = this.headerEl.createDiv({
			cls: "ai-daily-header-btn",
			attr: { "aria-label": "新对话", title: "新对话" },
		});
		setIcon(newChatBtn, "plus");
		newChatBtn.addEventListener("click", () => this.clearChat());
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
		attachBtn.addEventListener("click", () => {
			this.openFilePicker();
		});

		this.inputEl = inputRow.createEl("textarea", {
			cls: "ai-daily-input",
			attr: { placeholder: "问点什么… @ 引用笔记，/ 选择模板", rows: "1" },
		});

		this.sendBtn = inputRow.createEl("button", {
			cls: "ai-daily-send-btn",
		});
		setIcon(this.sendBtn, "send");

		this.sendBtn.addEventListener("click", () => {
			if (this.isLoading) {
				this.handleStop();
			} else {
				this.handleSend();
			}
		});
		this.inputEl.addEventListener("input", () => {
			this.inputEl.style.height = "auto";
			this.inputEl.style.height =
				Math.min(this.inputEl.scrollHeight, 120) + "px";
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
				this.inputEl.style.height = "auto";
				this.inputEl.style.height =
					Math.min(this.inputEl.scrollHeight, 120) + "px";
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
		this.closeMentionPopup();
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
		const value = this.inputEl.value;
		const start = this.mentionStartPos ?? 0;
		const cursor = this.inputEl.selectionStart ?? value.length;
		this.inputEl.value = value.slice(0, start) + value.slice(cursor);
		this.inputEl.selectionStart = this.inputEl.selectionEnd = start;
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
			this.mentionStartPos = this.inputEl.selectionStart ?? this.inputEl.value.length;
			this.showMentionPopup(allFiles);
		}
	}

	private closeMentionPopup(): void {
		if (this.mentionPopupEl) {
			this.mentionPopupEl.remove();
			this.mentionPopupEl = null;
		}
		this.mentionStartPos = null;
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
		const hint = "直接提问来探索你的知识库，或用工具读取特定笔记。";

		const welcomeEl = this.messagesEl.createDiv({
			cls: "ai-daily-welcome",
		});
		welcomeEl.createDiv({ cls: "ai-daily-welcome-title", text: `AI Knowledge Chat v${this.plugin.manifest.version}` });
		welcomeEl.createDiv({ cls: "ai-daily-welcome-hint", text: hint });
		const examplesEl = welcomeEl.createDiv({ cls: "ai-daily-welcome-examples" });
		for (const example of [
			"总结一下这篇文章的要点",
			"帮我在知识库里搜索 RAG 相关内容",
			"最近收藏了哪些文章？",
		]) {
			examplesEl.createDiv({ cls: "ai-daily-example", text: example });
		}

		welcomeEl.querySelectorAll(".ai-daily-example").forEach((el) => {
			el.addEventListener("click", () => {
				this.inputEl.value = el.textContent || "";
				this.handleSend();
			});
		});
		this.updateTokenBar();
	}

	private handleStop(): void {
		if (!this.isLoading) return;
		if (this.claudeCodeAbort) {
			this.claudeCodeAbort();
			this.claudeCodeAbort = null;
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

		const useClaudeCode = await isClaudeCodeAvailable();

		if (!useClaudeCode && !this.plugin.settings.apiKey) {
			this.addMessage(
				"assistant",
				"请先在插件设置中配置 Anthropic API Key，或安装 Claude Code。"
			);
			return;
		}

		this.isLoading = true;
		this.readImageCount = 0;
		this.setSendButtonState(true);
		this.inputEl.value = "";
		this.inputEl.style.height = "auto";

		if (useClaudeCode) {
			this.handleSendViaClaudeCode(text);
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

		if (!this.client) {
			await this.initClient();
		}

		const loadingEl = this.messagesEl.createDiv({
			cls: "ai-daily-loading",
		});
		loadingEl.createSpan({ text: "思考中" });
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
				content,
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
			const toolCallEls = new Map<string, HTMLElement>();
			let toolCallCounter = 0;

			const onToolCall = (name: string, input: Record<string, unknown>, status: "start" | "done" | "error") => {
				if (status === "start") {
					loadingEl.remove();
					if (!toolCallsEl) {
						toolCallsEl = this.messagesEl.createDiv({ cls: "ai-daily-tool-calls" });
					}
					const key = `${name}-${toolCallCounter++}`;
					const el = toolCallsEl.createDiv({ cls: "ai-daily-tool-call ai-daily-tool-call-running" });
					const iconSpan = el.createSpan({ cls: "ai-daily-tool-call-icon" });
					setIcon(iconSpan, "loader");
					el.createSpan({ cls: "ai-daily-tool-call-text", text: toolCallSummary(name, input) });
					toolCallEls.set(key, el);
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
					}
				}
			};

			const reply = await this.client!.chat(
				userMessage,
				async (name, input) => {
					if (name === "web_fetch") return this.webTools.execute(name, input);
					if (name === "read_image") return this.executeReadImage(input);
					return this.vaultTools!.execute(name, input);
				},
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
				preparedImages,
				onToolCall
			);

			loadingEl.remove();

			if (useStream && assistantEl) {
				await flushStreamingMarkdown(reply || "*(已停止)*");
				this.postProcessAssistantEl(assistantEl);
				assistantEl.removeClass("ai-daily-msg-streaming");
				this.messages.push({ role: "assistant", content: reply || "*(已停止)*" });
				this.cachedTokenCount += estimateTextTokens(reply);
			} else if (reply) {
				this.addMessage("assistant", reply);
			}
			this.scrollToBottomIfFollowing();
			this.renderUndoBar();

			await this.persistSession();
			this.updateTokenBar();
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
			this.addMessage("assistant", `出错了: ${msg}`);
		} finally {
			this.isLoading = false;
			this.setSendButtonState(false);
			this.updateTokenBar();
		}
	}

	private getMcpConfig(): { vaultPath: string; mcpServerPath: string; knowledgeFolders: string[] } {
		const { knowledgeFolders } = this.plugin.settings;
		const adapter = this.app.vault.adapter as { basePath?: string };
		const vaultPath = adapter.basePath || "";
		const mcpServerPath = getMcpServerPath();
		return { vaultPath, mcpServerPath, knowledgeFolders };
	}

	private async handleSendViaClaudeCode(text: string): Promise<void> {
		this.addMessage("user", text);
		if (!this.sessionId) this.sessionId = newSessionId();

		const isFirstMessage = !this.claudeCodeSessionId;
		const attachedContent = await this.consumeAttachedFiles();
		let prompt = text;

		if (isFirstMessage) {
			const { knowledgeFolders, distillTargetFolder, autoTagFolders } = this.plugin.settings;
			const parts: string[] = [
				"你是一个个人知识库助手。用户在 Obsidian 中管理知识库。",
				"",
				"## Vault 结构",
				`- 知识库文件夹: ${knowledgeFolders.join("、")}`,
				`- 原始笔记文件夹: ${autoTagFolders.join("、")}`,
				`- 知识整理目标文件夹: ${distillTargetFolder}`,
			];

			if (attachedContent) {
				parts.push("", attachedContent);
			}

			const adapter = this.app.vault.adapter as { basePath?: string };
			const vaultAbsPath = adapter.basePath || "";

			parts.push(
				"",
				"## MCP 工具使用说明",
				"你可以通过 MCP 工具操作 vault 中的笔记，路径使用 vault 内相对路径：",
				"- read_note: 读取笔记，path 如 `Raw/文章标题.md` 或 `Wiki/概念.md`",
				"- search_vault: 搜索笔记，query 为关键词，可用 folder 限定文件夹",
				"- list_notes: 列出文件夹内笔记，folder 如 `Raw`、`Wiki`",
				"- create_note: 创建笔记，path 为完整路径如 `Wiki/新条目.md`",
				"- edit_note: 编辑笔记指定部分",
				"- append_to_note: 在笔记末尾追加内容",
				"- update_frontmatter: 更新笔记的 frontmatter 属性",
				"- rename_note / delete_note / get_links: 其他操作",
				"",
				"## 图片处理",
				`Vault 绝对路径: ${vaultAbsPath}`,
				"当 read_note 返回的内容包含图片引用（如 `![[image.png]]` 或 `![](path/to/image.jpg)`）时，",
				"用 ReadFile 工具直接读取图片文件来查看内容。图片的绝对路径 = Vault绝对路径 + 图片相对路径。",
				"例如: `![[attachments/photo.png]]` → ReadFile(`" + vaultAbsPath + "/attachments/photo.png`)",
				"支持的格式: png, jpg, jpeg, webp, gif",
				"",
				"当用户提到某篇笔记时，先用 search_vault 搜索，找到后用 read_note 读取。",
				"回答用中文，简洁有深度。引用笔记时使用 [[笔记名]] wiki-link 格式。",
			);

			if (this.messages.length > 1) {
				const history = this.messages.slice(0, -1);
				const summary = history.map((m) =>
					`${m.role === "user" ? "用户" : "助手"}: ${m.content}`
				).join("\n\n");
				parts.push("", "以下是之前的对话记录，请基于这些上下文继续：", "---", summary, "---");
			}

			parts.push("", text);
			prompt = parts.join("\n");
		} else {
			const contextParts: string[] = [];

			if (attachedContent) {
				contextParts.push(attachedContent);
			}

			if (contextParts.length > 0) {
				prompt = contextParts.join("\n\n") + "\n\n" + text;
			}
		}

		this.runClaudeCodeStream(prompt, this.getMcpConfig(), this.claudeCodeSessionId, this.plugin.settings.model);
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
		} = this.plugin.settings;

		this.vaultTools = new VaultTools(this.app, knowledgeFolders);

		const knowledgeContext = await this.vaultTools.loadKnowledgeContext(5);

		const allFolders = knowledgeFolders.join("、");

		const systemPrompt = [
			"你是一个个人知识库助手。用户在 Obsidian 中管理自己的知识库，包括采集的原始文章（Raw/）、整理的知识条目（Wiki/）和每日笔记。",
			`知识库文件夹: ${allFolders}`,
			"你可以使用工具来读取、搜索、列出、创建、编辑、重命名、删除笔记，以及修改 frontmatter。支持按文件夹和标签（frontmatter tags）筛选搜索。删除笔记需要两步确认。",
			enableWebSearch
				? "你还可以使用 web_search 搜索互联网获取最新信息，用 web_fetch 抓取网页全文阅读。当用户提问涉及最新动态、你不确定的事实、或需要外部资料时，主动使用联网工具。"
				: "",
			"回答用中文，简洁有深度。如果用户想保存洞察，用 append_to_note 工具写回笔记。",
			"��回复中引用笔记时，请使用 [[笔记名]] 的 wiki-link 格式，以便用户可以直接点击跳转。",
			"当用户提到某篇笔记时，先用 search_vault 搜索，找到后用 read_note 读取。",
			knowledgeContext ? `## 最近的知识库笔记\n\n${knowledgeContext}` : "",
		]
			.filter(Boolean)
			.join("\n\n");

		this.client = new ClaudeClient(apiKey, model, systemPrompt, {
			streamMode: chatStreamMode,
			enableWebSearch,
			compressThresholdEst: chatCompressThresholdEst,
			onCompress: (detail) => {
				new Notice(detail, 6000);
			},
			onStreamFallback: (reason) => {
				console.warn("[ai-daily] stream fallback:", reason);
			},
		});
	}

	private async persistSession(): Promise<void> {
		if (!this.sessionId) return;
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
			claudeCodeSessionId: this.claudeCodeSessionId,
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

	private addMessage(role: "user" | "assistant", content: string): void {
		const welcome = this.messagesEl.querySelector(".ai-daily-welcome");
		if (welcome) welcome.remove();

		this.messages.push({ role, content });
		this.cachedTokenCount += estimateTextTokens(content);

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

	private createUndoBarEl(description: string, filePath: string, onUndo: () => Promise<string>, undoData?: UndoData): void {
		const bar = this.messagesEl.createDiv({ cls: "ai-daily-undo-bar" });

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

	sendMessage(text: string): void {
		this.inputEl.value = text;
		void this.handleSend();
	}

	sendClaudeCodeMessage(userText: string): void {
		if (this.isLoading) return;
		this.isLoading = true;
		this.setSendButtonState(true);
		this.addMessage("user", userText);
		if (!this.sessionId) this.sessionId = newSessionId();
		this.runClaudeCodeStream(userText, this.getMcpConfig(), this.claudeCodeSessionId, this.plugin.settings.model);
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
				const el = toolCallEls.get(id);
				if (!el || !result) return;
				const details = el.createEl("details", { cls: "ai-daily-tool-result" });
				details.createEl("summary", { text: isError ? "错误" : "结果" });
				const pre = details.createEl("pre", { cls: "ai-daily-tool-result-content" });
				pre.createEl("code", { text: result.length > 2000 ? result.slice(0, 2000) + "\n…(已截断)" : result });
			},
			onThinking: (text) => {
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
				loadingEl.remove();
				if (typewriterTimer !== null) { window.clearTimeout(typewriterTimer); typewriterTimer = null; }
				if (assistantEl && accumulated) {
					assistantEl.empty();
					void MarkdownRenderer.render(this.app, accumulated, assistantEl, "", this.plugin).then(() => {
						assistantEl!.removeClass("ai-daily-msg-streaming");
						this.postProcessAssistantEl(assistantEl!);
					});
					this.messages.push({ role: "assistant", content: accumulated });
				} else if (assistantEl) {
					assistantEl.remove();
				}
				this.addMessage("assistant", `Claude Code 出错: ${error}`);
				this.isLoading = false;
				this.setSendButtonState(false);
				this.renderUndoBar();
			},
			onDone: (fullText) => {
				loadingEl.remove();
				if (typewriterTimer !== null) { window.clearTimeout(typewriterTimer); typewriterTimer = null; }
				if (assistantEl) {
					assistantEl.empty();
					void MarkdownRenderer.render(this.app, fullText, assistantEl, "", this.plugin).then(() => {
						assistantEl!.removeClass("ai-daily-msg-streaming");
						this.postProcessAssistantEl(assistantEl!);
					});
					this.messages.push({ role: "assistant", content: fullText });
				} else if (fullText) {
					this.addMessage("assistant", fullText);
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

	private claudeCodeAbort: (() => void) | null = null;
	private claudeCodeSessionId: string | undefined;
	private claudeCodeUndoHistory: { id: number; data: UndoData; description: string }[] = [];
	private claudeCodeUndoCounter = 0;

	private async handleDistill(): Promise<void> {
		if (this.messages.length < 2) {
			new Notice("当前对话内容太少，无法蒸馏", 3000);
			return;
		}
		if (this.isLoading) {
			new Notice("请等待当前操作完成", 2000);
			return;
		}
		if (!this.plugin.settings.apiKey) {
			new Notice("请先在插件设置中配置 API Key", 3000);
			return;
		}

		this.isLoading = true;
		const notice = new Notice("正在蒸馏对话知识...", 0);
		try {
			const result = await distillConversation(this.app, this.messages, {
				apiKey: this.plugin.settings.apiKey,
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

	private clearChat(): void {
		this.sessionId = null;
		this.messages = [];
		this.cachedTokenCount = 0;
		this.client = null;
		this.vaultTools = null;
		this.claudeCodeSessionId = undefined;
		this.claudeCodeUndoHistory = [];
		this.attachedFiles = [];
		this.renderAttachBar();
		this.messagesEl.empty();
		this.showWelcome();
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

		const head = overlay.createDiv({ cls: "ai-daily-history-head" });
		head.createEl("span", { text: "历史对话", cls: "ai-daily-history-title" });

		const headActions = head.createDiv({ cls: "ai-daily-history-head-actions" });
		const clearAllBtn = headActions.createSpan({
			cls: "ai-daily-history-clear-all",
			text: "清空全部",
		});
		clearAllBtn.addEventListener("click", () => {
			if (sessions.length === 0) return;
			new ConfirmModal(
				this.app,
				`确定删除全部 ${sessions.length} 条历史对话？此操作不可撤销。`,
				async () => {
					const { chatHistoryFolder } = this.plugin.settings;
					for (const s of sessions) {
						await deleteChatSessionFile(
							this.app.vault,
							chatHistoryFolder,
							s.id
						);
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

		const closeBtn = headActions.createSpan({ cls: "ai-daily-history-close", text: "✕" });
		closeBtn.addEventListener("click", () => {
			this.closeHistoryOverlay();
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
				const info = row.createDiv({ cls: "ai-daily-history-row-info" });
				info.createDiv({
					cls: "ai-daily-history-row-title",
					text: s.title || s.id,
				});
				info.createDiv({
					cls: "ai-daily-history-row-meta",
					text: `${s.updated?.slice(0, 16) ?? ""} · ${s.model}`,
				});
				info.addEventListener("click", () => {
					void this.loadSession(s.id);
					this.closeHistoryOverlay();
				});

				const delBtn = row.createSpan({ cls: "ai-daily-history-row-del" });
				setIcon(delBtn, "trash-2");
				delBtn.setAttribute("title", "删除");
				delBtn.addEventListener("click", (ev) => {
					ev.stopPropagation();
					new ConfirmModal(
						this.app,
						`确定删除对话「${s.title || s.id}」？此操作不可撤销。`,
						async () => {
							const { chatHistoryFolder } = this.plugin.settings;
							await deleteChatSessionFile(
								this.app.vault,
								chatHistoryFolder,
								s.id
							);
							if (this.sessionId === s.id) {
								this.clearChat();
							}
							sessions = sessions.filter((x) => x.id !== s.id);
							renderList(
								sessions.filter((x) =>
									search.value
										? x.title
												.toLowerCase()
												.includes(search.value.toLowerCase()) ||
										  x.id.toLowerCase().includes(search.value.toLowerCase())
										: true
								)
							);
							new Notice("对话已删除", 3000);
						}
					).open();
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
				this.closeHistoryOverlay();
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
		this.claudeCodeSessionId = data.claudeCodeSessionId;
		this.messages = data.messages.map((m) => ({
			role: m.role,
			content: m.content,
		}));
		this.cachedTokenCount = this.messages.reduce(
			(sum, m) => sum + estimateTextTokens(m.content), 0
		);
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
				this.postProcessAssistantEl(msgEl);
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
		this.closeHistoryOverlay();
		this.closeTemplatePopup();
		this.closeMentionPopup();
	}
}
