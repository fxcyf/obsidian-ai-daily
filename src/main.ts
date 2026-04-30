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
import { findUnorganizedNotes, MAX_NOTES_PER_RUN, wikiHealthCheck, formatHealthCheckReport, hasFixableIssues } from "./knowledge-agent";
import { isClaudeCodeAvailable } from "./claude-code";

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

		// Command to health check wiki
		this.addCommand({
			id: "wiki-health-check",
			name: "Wiki 健康检查",
			callback: () => this.runWikiHealthCheck(),
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
		console.log("[ai-daily] organizeKnowledge called");
		const useClaudeCode = await isClaudeCodeAvailable();
		console.log("[ai-daily] useClaudeCode =", useClaudeCode);

		if (!useClaudeCode && !this.settings.apiKey) {
			new Notice("请先在插件设置中配置 Anthropic API Key，或安装 Claude Code。", 5000);
			return;
		}

		const sourceFolder = this.settings.autoTagFolders[0] || "Raw";
		const unorganized = await findUnorganizedNotes(this.app, sourceFolder);

		if (unorganized.length === 0) {
			new Notice("没有找到待整理的笔记", 3000);
			return;
		}

		const batch = unorganized.slice(0, MAX_NOTES_PER_RUN);
		const targetFolder = this.settings.distillTargetFolder;
		const noteList = batch.map((f) => `- [[${f.basename}]] (${f.path})`).join("\n");

		const message = [
			`请帮我整理以下 ${batch.length} 篇笔记（共 ${unorganized.length} 篇待整理）到 ${targetFolder}/ 文件夹：`,
			"",
			noteList,
			"",
			"整理流程：",
			"1. 先用 list_notes 浏览目标文件夹的已有条目和结构",
			"2. 逐篇用 read_note 阅读笔记内容，提取核心观点和关键概念",
			`3. 用 search_vault 在 ${targetFolder}/ 中搜索相关的已有条目`,
			"4. 有相关条目 → edit_note 补充新信息，保持原有结构；没有 → create_note 创建新条目",
			"5. 新条目需包含 frontmatter（tags、summary）和指向原笔记的 wiki-link",
			"6. 主动添加 [[wiki-link]] 关联相关条目，复用已有 tags 避免同义重复",
			"7. 每篇整理完后用 update_frontmatter 标记 organized: true",
			"",
			"请逐篇处理，每篇完成后告诉我做了什么。",
		].join("\n");

		await this.activateView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) return;
		const view = leaf.view as ChatView;

		if (useClaudeCode) {
			new Notice("使用 Claude Code 整理（Max plan 额度）", 3000);
			view.sendClaudeCodeMessage(message);
		} else {
			view.sendMessage(message);
		}
	}

	async runWikiHealthCheck(): Promise<void> {
		const notice = new Notice("正在检查知识库健康状态...", 0);
		try {
			const result = await wikiHealthCheck(this.app, this.settings.knowledgeFolders);
			const report = formatHealthCheckReport(result);
			notice.hide();

			await this.activateView();
			const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
			if (!leaf) return;
			const view = leaf.view as ChatView;
			view.addHealthCheckReport(report, hasFixableIssues(result) ? result : undefined);
		} catch (e) {
			notice.hide();
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`健康检查失败: ${msg}`, 5000);
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

	private get backupPath(): string {
		return `${this.manifest.dir}/data.backup.json`;
	}

	async loadSettings(): Promise<void> {
		let raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;

		if (Object.keys(raw).length === 0) {
			const restored = await this.restoreFromBackup();
			if (restored) {
				raw = restored;
				new Notice("设置已从备份恢复（data.json 可能丢失或损坏）", 8000);
				console.warn("[ai-daily] data.json was empty/missing, restored from backup");
			}
		}

		if ("chatStreaming" in raw && !("chatStreamMode" in raw)) {
			raw.chatStreamMode = raw.chatStreaming === false ? "off" : "auto";
			delete raw.chatStreaming;
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);

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

		await this.writeBackup();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		await this.writeBackup();
	}

	private async writeBackup(): Promise<void> {
		try {
			const json = JSON.stringify(this.settings, null, "\t");
			await this.app.vault.adapter.write(this.backupPath, json);
		} catch {
			// backup is best-effort
		}
	}

	private async restoreFromBackup(): Promise<Record<string, unknown> | null> {
		try {
			const exists = await this.app.vault.adapter.exists(this.backupPath);
			if (!exists) return null;
			const content = await this.app.vault.adapter.read(this.backupPath);
			const parsed = JSON.parse(content);
			if (parsed && typeof parsed === "object" && parsed.apiKey !== undefined) {
				await this.saveData(parsed);
				return parsed as Record<string, unknown>;
			}
		} catch {
			// backup unreadable
		}
		return null;
	}
}
