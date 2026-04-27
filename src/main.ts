import { App, Modal, Notice, Platform, Plugin, TFile } from "obsidian";
import {
	AIDailyChatSettings,
	DEFAULT_SETTINGS,
	AIDailyChatSettingTab,
} from "./settings";
import { ChatView, VIEW_TYPE } from "./chat-view";
import { generateFeed, checkExistingFeed } from "./feed-generator";
import { DEFAULT_FEEDS } from "./feeds";
import { AutoTagger } from "./auto-tagger";
import { runKnowledgeOrganizer } from "./knowledge-agent";

class FeedConfirmModal extends Modal {
	private resolved = false;
	private resolve: (value: boolean) => void = () => {};

	constructor(app: App) {
		super(app);
	}

	open(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			super.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("p", {
			text: "今天已经生成过 Feed，再次生成会将新内容追加到现有文件中（不会覆盖）。AI 会自动避免重复已有的内容。",
		});
		contentEl.createEl("p", {
			text: "是否继续生成？",
			cls: "ai-daily-confirm-question",
		});
		const btnRow = contentEl.createDiv({ cls: "ai-daily-confirm-btns" });
		const confirmBtn = btnRow.createEl("button", {
			text: "继续生成",
			cls: "mod-cta",
		});
		const cancelBtn = btnRow.createEl("button", { text: "取消" });
		confirmBtn.addEventListener("click", () => {
			this.resolved = true;
			this.resolve(true);
			this.close();
		});
		cancelBtn.addEventListener("click", () => {
			this.resolved = true;
			this.resolve(false);
			this.close();
		});
	}

	onClose(): void {
		if (!this.resolved) this.resolve(false);
		this.contentEl.empty();
	}
}

export default class AIDailyChat extends Plugin {
	settings: AIDailyChatSettings = DEFAULT_SETTINGS;
	private autoTagger: AutoTagger | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the chat sidebar view
		this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));

		// Ribbon icon to open chat
		this.addRibbonIcon("message-circle", "AI Knowledge Chat", () => {
			this.activateView();
		});

		// Command to open chat
		this.addCommand({
			id: "open-chat",
			name: "打开 AI Knowledge Chat",
			callback: () => this.activateView(),
		});

		// Command to chat about the current note
		this.addCommand({
			id: "chat-current-note",
			name: "对话当前笔记",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				this.chatAboutCurrentNote();
				return true;
			},
		});

		// Command to generate feed
		this.addCommand({
			id: "generate-feed",
			name: "生成 AI Feed",
			callback: () => this.generateFeed(),
		});

		// Command to organize knowledge
		this.addCommand({
			id: "organize-knowledge",
			name: "整理知识库",
			callback: () => this.organizeKnowledge(),
		});

		// Settings tab
		this.addSettingTab(new AIDailyChatSettingTab(this.app, this));

		// Auto-tagging
		this.setupAutoTagger();

		if (Platform.isMobile) {
			this.app.workspace.onLayoutReady(() => {
				const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
				if (leaf && this.isLeafInSidebar(leaf)) {
					leaf.detach();
				}
			});
		}
	}

	async chatAboutCurrentNote(): Promise<void> {
		await this.activateView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (leaf) {
			const view = leaf.view as ChatView;
			view.sendMessage("请总结这篇笔记的要点，并指出最值得深入了解的部分。");
		}
	}

	private isLeafInSidebar(leaf: import("obsidian").WorkspaceLeaf): boolean {
		return leaf.getRoot() !== this.app.workspace.rootSplit;
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

		if (leaf && Platform.isMobile && this.isLeafInSidebar(leaf)) {
			leaf.detach();
			leaf = undefined as unknown as import("obsidian").WorkspaceLeaf;
		}

		if (!leaf) {
			if (Platform.isMobile) {
				leaf = workspace.getLeaf(true);
			} else {
				const rightLeaf = workspace.getRightLeaf(false);
				if (rightLeaf) leaf = rightLeaf;
			}
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async generateFeed(): Promise<void> {
		const existing = await checkExistingFeed(this.app, this.settings.feedFolder);

		if (existing) {
			const confirmed = await new FeedConfirmModal(this.app).open();
			if (!confirmed) return;
		}

		const notice = new Notice("正在生成 AI Feed...", 0);
		try {
			const file = await generateFeed(
				this.app,
				this.settings,
				(progress) => { notice.setMessage(progress.message); },
				existing?.content
			);
			notice.hide();
			new Notice(`Feed 已生成: ${file.path}`, 5000);
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		} catch (e) {
			notice.hide();
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Feed 生成失败: ${msg}`, 8000);
		}
	}

	async organizeKnowledge(): Promise<void> {
		if (!this.settings.apiKey) {
			new Notice("请先在插件设置中配置 Anthropic API Key。", 5000);
			return;
		}

		const notice = new Notice("正在扫描待整理笔记...", 0);
		try {
			const sourceFolder = this.settings.autoTagFolders[0] || "Raw";
			const { processed, total } = await runKnowledgeOrganizer(this.app, {
				apiKey: this.settings.apiKey,
				model: this.settings.model,
				knowledgeFolders: this.settings.knowledgeFolders,
				sourceFolder,
				targetFolder: this.settings.distillTargetFolder,
				onProgress: (msg) => { notice.setMessage(msg); },
			});
			notice.hide();
			if (total === 0) {
				new Notice("没有找到待整理的笔记", 3000);
			} else {
				new Notice(`知识整理完成: ${processed}/${total} 篇`, 5000);
			}
		} catch (e) {
			notice.hide();
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`知识整理失败: ${msg}`, 8000);
		}
	}

	setupAutoTagger(): void {
		this.autoTagger?.destroy();
		this.autoTagger = null;

		if (!this.settings.enableAutoTagging || !this.settings.apiKey) return;

		this.autoTagger = new AutoTagger(this.app, {
			apiKey: this.settings.apiKey,
			model: this.settings.model,
			folders: this.settings.autoTagFolders,
			customPrompt: this.settings.autoTagPrompt || undefined,
			onTagged: (path) => {
				new Notice(`已自动标注: ${path}`, 3000);
			},
			onError: (path, error) => {
				console.warn(`[ai-daily] auto-tag failed for ${path}:`, error);
			},
		});

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile) this.autoTagger?.handleFileEvent(file);
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) this.autoTagger?.handleFileEvent(file);
			})
		);
	}

	onunload(): void {
		this.autoTagger?.destroy();
	}

	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		// Migrate old chatStreaming:boolean → chatStreamMode (Phase 2 of feature-real-streaming)
		if ("chatStreaming" in raw && !("chatStreamMode" in raw)) {
			raw.chatStreamMode = raw.chatStreaming === false ? "off" : "auto";
			delete raw.chatStreaming;
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);

		// Migrate feed sources: append new default sources that the user doesn't have yet
		if (Array.isArray(raw.feedSources)) {
			const existingNames = new Set(
				this.settings.feedSources.map((s) => s.name)
			);
			let added = false;
			for (const defaultSource of DEFAULT_FEEDS) {
				if (!existingNames.has(defaultSource.name)) {
					this.settings.feedSources.push(defaultSource);
					added = true;
				}
			}
			if (added) {
				await this.saveData(this.settings);
			}
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
