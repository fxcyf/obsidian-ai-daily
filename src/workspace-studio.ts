/**
 * Workspace Studio — a page rendered inside Chat View for managing workspaces,
 * modes, and recent conversations per workspace.
 *
 * Not a standalone Obsidian View. The Chat View calls `render()` when the user
 * clicks the Studio entry, and calls `destroy()` when returning to chat.
 *
 * Callbacks decouple the studio from ChatView specifics — the studio doesn't
 * know how a mode is launched or how a session is loaded.
 */

import { App, TFile, setIcon, Menu, Modal, Setting, Notice, FuzzySuggestModal, type FuzzyMatch } from "obsidian";
import type AIDailyChat from "./main";
import {
	loadProjectIndex,
	parseModesFromContent,
	resolveFileEntries,
	type ProjectIndex,
	type HarnessContext,
} from "./harness-view";
import type { HarnessMode, HarnessModeAction } from "./settings";
import type { ChatSessionFile } from "./chat-session";
import { listChatSessions } from "./chat-session";
import { serializeModesToContent } from "./modes-serializer";

export interface StudioCallbacks {
	onStartWithContext: (ctx: HarnessContext) => void;
	onOpenSession: (sessionId: string) => void;
	onStartFresh: () => void;
	onClose: () => void;
}

export class WorkspaceStudio {
	private container: HTMLElement;
	private app: App;
	private plugin: AIDailyChat;
	private callbacks: StudioCallbacks;
	private projectIndex: ProjectIndex | null = null;
	private sessions: ChatSessionFile[] = [];

	constructor(container: HTMLElement, plugin: AIDailyChat, callbacks: StudioCallbacks) {
		this.container = container;
		this.plugin = plugin;
		this.app = plugin.app;
		this.callbacks = callbacks;
	}

	async render(): Promise<void> {
		this.container.empty();
		this.container.addClass("ws-studio");

		await this.loadData();
		this.buildHeader();
		this.buildWorkspaceSelector();
		this.buildModes();
		this.buildRecent();
		this.buildStartFresh();
	}

	private async loadData(): Promise<void> {
		this.projectIndex = await loadProjectIndex(
			this.app.vault,
			this.app.metadataCache,
			this.plugin.settings.harnessProjectsFolder,
		);
		this.sessions = await listChatSessions(
			this.app.vault,
			this.plugin.settings.chatHistoryFolder,
		);
	}

	private buildHeader(): void {
		const head = this.container.createDiv({ cls: "ws-studio-head" });
		const back = head.createEl("button", { cls: "ws-studio-back" });
		setIcon(back.createSpan({ cls: "ws-studio-back-icon" }), "arrow-left");
		back.createSpan({ text: "返回对话" });
		back.addEventListener("click", () => this.callbacks.onClose());

		head.createDiv({ cls: "ws-studio-title", text: "Workspace Studio" });
	}

	private buildWorkspaceSelector(): void {
		const section = this.container.createDiv({ cls: "ws-studio-section" });
		const label = section.createDiv({ cls: "ws-studio-section-label" });
		label.createSpan({ text: "WORKSPACES" });

		const allProjects = this.projectIndex?.projects ?? [];
		const activeProjects = allProjects.filter((p) => p.status !== "archive");
		const archivedProjects = allProjects.filter((p) => p.status === "archive");
		const active = this.projectIndex?.activeProject;

		const scroller = section.createDiv({ cls: "ws-studio-ws-scroller" });

		for (const p of activeProjects) {
			const card = scroller.createEl("button", { cls: "ws-studio-ws-card" });
			if (p.name === active) card.addClass("active");
			card.createDiv({ cls: "ws-studio-ws-name", text: p.name });
			const meta = card.createDiv({ cls: "ws-studio-ws-meta" });
			const count = this.sessions.filter(
				(s) => (s.workspace || s.harnessContext?.workspace) === p.name,
			).length;
			meta.createSpan({ text: `${count} 对话` });

			card.addEventListener("click", () => {
				void this.switchWorkspace(p.name);
			});

			card.addEventListener("contextmenu", (ev) => {
				ev.preventDefault();
				this.showWorkspaceMenu(p.name, ev as MouseEvent);
			});
		}

		const addCard = scroller.createEl("button", { cls: "ws-studio-ws-card ws-studio-ws-add" });
		setIcon(addCard.createSpan({ cls: "ws-studio-ws-add-icon" }), "plus");
		addCard.createDiv({ text: "新建" });
		addCard.addEventListener("click", () => this.openCreateWorkspaceModal());

		if (archivedProjects.length > 0) {
			const archiveToggle = section.createEl("button", { cls: "ws-studio-archive-toggle" });
			setIcon(archiveToggle.createSpan({ cls: "ws-studio-archive-toggle-icon" }), "archive");
			archiveToggle.createSpan({ text: `${archivedProjects.length} 个已归档` });
			let expanded = false;
			const archiveList = section.createDiv({ cls: "ws-studio-archive-list" });
			archiveList.style.display = "none";

			archiveToggle.addEventListener("click", () => {
				expanded = !expanded;
				archiveList.style.display = expanded ? "flex" : "none";
				archiveToggle.toggleClass("is-expanded", expanded);
			});

			for (const p of archivedProjects) {
				const row = archiveList.createDiv({ cls: "ws-studio-archive-row" });
				row.createSpan({ cls: "ws-studio-archive-name", text: p.name });
				const restoreBtn = row.createEl("button", { cls: "ws-studio-archive-restore", text: "恢复" });
				restoreBtn.addEventListener("click", () => {
					void this.unarchiveWorkspace(p.name);
				});
			}
		}
	}

	private buildModes(): void {
		const section = this.container.createDiv({ cls: "ws-studio-section" });
		const label = section.createDiv({ cls: "ws-studio-section-label" });
		label.createSpan({ text: "MODES" });

		const active = this.projectIndex?.activeProject;
		if (active) {
			const editBtn = label.createSpan({ cls: "ws-studio-section-action" });
			setIcon(editBtn, "pencil");
			editBtn.setAttribute("title", "编辑 modes");
			editBtn.addEventListener("click", () => this.openEditWorkspaceModal(active));
		}

		const modes = this.projectIndex?.modes ?? [];
		if (modes.length === 0) {
			section.createDiv({
				cls: "ws-studio-empty",
				text: active ? "当前 workspace 没有 modes.md" : "请选择一个 workspace",
			});
			return;
		}

		const grid = section.createDiv({ cls: "ws-studio-mode-grid" });
		for (const mode of modes) {
			const resolveContext = (): HarnessContext => {
				const resolveVars = (p: string) => {
					let r = p;
					r = r.replace(/\{active_project\}/g, this.projectIndex?.activeProject || "");
					r = r.replace(/\{active_work_context\}/g, this.projectIndex?.activeWorkContext || "");
					return r;
				};
				return {
					mode,
					injectedFiles: resolveFileEntries(mode.files, this.app, resolveVars),
					workspace: this.projectIndex?.activeProject,
				};
			};

			if (mode.actions.length >= 1) {
				for (const action of mode.actions) {
					const card = grid.createEl("button", { cls: "ws-studio-mode-card quick" });
					if (action.icon) {
						const iconEl = card.createSpan({ cls: "ws-studio-mode-emoji ws-studio-mode-emoji--icon" });
						setIcon(iconEl, action.icon);
					} else {
						card.createSpan({ cls: "ws-studio-mode-emoji", text: mode.emoji });
					}
					card.createSpan({ cls: "ws-studio-mode-name", text: action.label });
					const bolt = card.createSpan({ cls: "ws-studio-mode-bolt" });
					bolt.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>';
					card.addEventListener("click", () => {
						const ctx = resolveContext();
						this.callbacks.onStartWithContext(ctx);
					});
				}
			} else {
				const card = grid.createEl("button", { cls: "ws-studio-mode-card" });
				card.createSpan({ cls: "ws-studio-mode-emoji", text: mode.emoji });
				card.createSpan({ cls: "ws-studio-mode-name", text: mode.label });
				card.addEventListener("click", () => {
					this.callbacks.onStartWithContext(resolveContext());
				});
			}
		}
	}

	private buildRecent(): void {
		const active = this.projectIndex?.activeProject;
		if (!active) return;

		const section = this.container.createDiv({ cls: "ws-studio-section" });
		section.createDiv({ cls: "ws-studio-section-label", text: "RECENT" });

		const wsSessions = this.sessions.filter(
			(s) => (s.workspace || s.harnessContext?.workspace) === active,
		).slice(0, 5);

		if (wsSessions.length === 0) {
			section.createDiv({ cls: "ws-studio-empty", text: "该 workspace 暂无对话" });
			return;
		}

		const list = section.createDiv({ cls: "ws-studio-recent-list" });
		for (const s of wsSessions) {
			const row = list.createDiv({ cls: "ws-studio-recent-row" });
			const modeLabel = s.harnessContext?.mode
				? `${s.harnessContext.mode.emoji} ${s.harnessContext.mode.label} · `
				: "";
			row.createDiv({
				cls: "ws-studio-recent-title",
				text: `${modeLabel}${s.title || s.id}`,
			});
			row.createDiv({
				cls: "ws-studio-recent-meta",
				text: s.updated?.slice(0, 16) ?? "",
			});
			row.addEventListener("click", () => this.callbacks.onOpenSession(s.id));
		}
	}

	private buildStartFresh(): void {
		const wrap = this.container.createDiv({ cls: "ws-studio-fresh-wrap" });
		const btn = wrap.createEl("button", { cls: "ws-studio-fresh-btn" });
		setIcon(btn.createSpan({ cls: "ws-studio-fresh-icon" }), "play");
		btn.createSpan({ text: "开始新对话" });
		btn.addEventListener("click", () => this.callbacks.onStartFresh());
	}

	private async switchWorkspace(name: string): Promise<void> {
		const projectsFolder = this.plugin.settings.harnessProjectsFolder;
		const indexPath = `${projectsFolder}/_INDEX.md`;
		const file = this.app.vault.getAbstractFileByPath(indexPath);
		if (!(file instanceof TFile)) return;
		let content = await this.app.vault.read(file);
		if (/^active_project:/m.test(content)) {
			content = content.replace(/^(active_project:\s*).*$/m, `$1${name}`);
		} else {
			content = `---\nactive_project: ${name}\n---\n\n${content}`;
		}
		await this.app.vault.modify(file, content);
		await this.render();
	}

	private showWorkspaceMenu(name: string, ev: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((it) =>
			it.setTitle("编辑").setIcon("pencil").onClick(() => this.openEditWorkspaceModal(name)),
		);
		menu.addItem((it) =>
			it.setTitle("归档").setIcon("archive").onClick(() => this.archiveWorkspace(name)),
		);
		menu.showAtMouseEvent(ev);
	}

	private openCreateWorkspaceModal(): void {
		new CreateWorkspaceModal(this.app, this.plugin, async (name) => {
			await this.createWorkspace(name);
			await this.render();
		}).open();
	}

	private async createWorkspace(name: string): Promise<void> {
		const projectsFolder = this.plugin.settings.harnessProjectsFolder;
		const adapter = this.app.vault.adapter;
		const wsFolder = `${projectsFolder}/${name}`;

		if (!(await adapter.exists(projectsFolder))) {
			await adapter.mkdir(projectsFolder);
		}
		if (!(await adapter.exists(wsFolder))) {
			await adapter.mkdir(wsFolder);
		}

		const modesPath = `${wsFolder}/modes.md`;
		if (!this.app.vault.getAbstractFileByPath(modesPath)) {
			const template = defaultModesTemplate();
			await this.app.vault.create(modesPath, template);
		}

		const indexPath = `${projectsFolder}/_INDEX.md`;
		const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
		let indexContent: string;
		if (indexFile instanceof TFile) {
			indexContent = await this.app.vault.read(indexFile);
		} else {
			indexContent = `---\nactive_project: ${name}\nactive_work_context: \n---\n\n| 项目 | 状态 | 来源 | 最近更新 |\n|------|------|------|----------|\n`;
		}

		const today = new Date().toISOString().slice(0, 10);
		const newRow = `| ${name} | active | manual | ${today} |`;
		if (!indexContent.includes(`| ${name} |`)) {
			indexContent = indexContent.trimEnd() + "\n" + newRow + "\n";
		}
		if (/^active_project:/m.test(indexContent)) {
			indexContent = indexContent.replace(/^(active_project:\s*).*$/m, `$1${name}`);
		}

		if (indexFile instanceof TFile) {
			await this.app.vault.modify(indexFile, indexContent);
		} else {
			await this.app.vault.create(indexPath, indexContent);
		}

		new Notice(`已创建 workspace「${name}」`);
	}

	private async archiveWorkspace(name: string): Promise<void> {
		await this.setWorkspaceStatus(name, "archive");
		new Notice(`已归档「${name}」`);
		await this.render();
	}

	private async unarchiveWorkspace(name: string): Promise<void> {
		await this.setWorkspaceStatus(name, "active");
		new Notice(`已恢复「${name}」`);
		await this.render();
	}

	private async setWorkspaceStatus(name: string, status: string): Promise<void> {
		const projectsFolder = this.plugin.settings.harnessProjectsFolder;
		const indexPath = `${projectsFolder}/_INDEX.md`;
		const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
		if (!(indexFile instanceof TFile)) return;
		let content = await this.app.vault.read(indexFile);
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const rowRe = new RegExp(`^(\\|\\s*${escaped}\\s*\\|)\\s*\\w+\\s*\\|`, "m");
		content = content.replace(rowRe, `$1 ${status} |`);
		await this.app.vault.modify(indexFile, content);
	}

	private openEditWorkspaceModal(name: string): void {
		new EditWorkspaceModal(this.app, this.plugin, name, async () => {
			await this.render();
		}).open();
	}

	destroy(): void {
		this.container.empty();
		this.container.removeClass("ws-studio");
	}
}

function defaultModesTemplate(): string {
	return `\`\`\`yaml modes
- id: default
  label: 默认
  emoji: "💬"
  files: []
  actions: []
\`\`\`

## default

You are a helpful assistant.
`;
}

// ── Create Workspace Modal ───────────────────────────────

class CreateWorkspaceModal extends Modal {
	private plugin: AIDailyChat;
	private onSubmit: (name: string) => void;
	private nameValue = "";

	constructor(app: App, plugin: AIDailyChat, onSubmit: (name: string) => void) {
		super(app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "新建 Workspace" });

		new Setting(contentEl).setName("名称").addText((text) => {
			text.setPlaceholder("例如: my-project").onChange((v) => {
				this.nameValue = v.trim();
			});
			text.inputEl.focus();
		});

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("创建").setCta().onClick(async () => {
				const name = this.nameValue.trim();
				if (!name) {
					new Notice("请输入 workspace 名称");
					return;
				}
				if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
					new Notice("名称只允许字母、数字、下划线、连字符");
					return;
				}
				this.onSubmit(name);
				this.close();
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ── Edit Workspace Modal ─────────────────────────────────

class EditWorkspaceModal extends Modal {
	private plugin: AIDailyChat;
	private workspaceName: string;
	private modes: HarnessMode[] = [];
	private onSave: () => Promise<void>;

	constructor(
		app: App,
		plugin: AIDailyChat,
		workspaceName: string,
		onSave: () => Promise<void>,
	) {
		super(app);
		this.plugin = plugin;
		this.workspaceName = workspaceName;
		this.onSave = onSave;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass("ws-studio-edit-modal");
		contentEl.empty();

		contentEl.createEl("h3", { text: `编辑: ${this.workspaceName}` });

		const modesPath = `${this.plugin.settings.harnessProjectsFolder}/${this.workspaceName}/modes.md`;
		const file = this.app.vault.getAbstractFileByPath(modesPath);
		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			this.modes = parseModesFromContent(content);
		}

		this.renderModesList();

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("+ 添加新 Mode").onClick(() => {
				this.modes.push({
					id: `mode-${this.modes.length + 1}`,
					label: "新模式",
					emoji: "📋",
					files: [],
					systemPromptAppend: "",
					actions: [],
				});
				this.renderModesList();
			}),
		);

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("归档").setWarning().onClick(async () => {
					if (!confirm(`确定要归档「${this.workspaceName}」吗？文件将保留，可随时恢复。`)) return;
					const projectsFolder = this.plugin.settings.harnessProjectsFolder;
					const indexPath = `${projectsFolder}/_INDEX.md`;
					const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
					if (!(indexFile instanceof TFile)) return;
					let content = await this.app.vault.read(indexFile);
					const escaped = this.workspaceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					const rowRe = new RegExp(`^(\\|\\s*${escaped}\\s*\\|)\\s*\\w+\\s*\\|`, "m");
					content = content.replace(rowRe, `$1 archive |`);
					await this.app.vault.modify(indexFile, content);
					new Notice(`已归档「${this.workspaceName}」`);
					this.close();
					await this.onSave();
				}),
			)
			.addButton((btn) =>
				btn.setButtonText("取消").onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn.setButtonText("保存").setCta().onClick(async () => {
					await this.save();
					this.close();
				}),
			);
	}

	private renderModesList(): void {
		let listEl = this.contentEl.querySelector<HTMLElement>(".ws-studio-edit-modes");
		if (!listEl) {
			listEl = this.contentEl.createDiv({ cls: "ws-studio-edit-modes" });
			const settingItems = this.contentEl.querySelectorAll(":scope > .setting-item");
			const firstSetting = settingItems[0];
			if (firstSetting) {
				this.contentEl.insertBefore(listEl, firstSetting);
			}
		}
		listEl.empty();

		for (let i = 0; i < this.modes.length; i++) {
			const mode = this.modes[i];
			const card = listEl.createDiv({ cls: "ws-studio-edit-mode" });

			new Setting(card)
				.setName("Mode")
				.addText((text) => {
					text.setPlaceholder("🔖").setValue(mode.emoji)
						.onChange((v) => { mode.emoji = v; });
					text.inputEl.addClass("ws-studio-edit-emoji");
					text.inputEl.setAttribute("maxlength", "2");
				})
				.addText((text) => {
					text.setPlaceholder("名称").setValue(mode.label)
						.onChange((v) => { mode.label = v; });
				})
				.addText((text) => {
					text.setPlaceholder("ID").setValue(mode.id)
						.onChange((v) => { mode.id = v; });
					text.inputEl.addClass("ws-studio-edit-id");
				})
				.addButton((btn) => {
					btn.setIcon("trash-2").setWarning().onClick(() => {
						this.modes.splice(i, 1);
						this.renderModesList();
					});
				})
				.then((s) => { s.settingEl.addClass("ws-studio-edit-mode-head"); });

			new Setting(card)
				.setName("Prompt")
				.addTextArea((ta) => {
					ta.setValue(mode.systemPromptAppend)
						.onChange((v) => { mode.systemPromptAppend = v; });
					ta.inputEl.rows = 6;
					ta.inputEl.addClass("ws-studio-edit-prompt");
				})
				.then((s) => { s.settingEl.addClass("ws-studio-edit-prompt-row"); });

			const filesSetting = new Setting(card).setName("Files");
			filesSetting.addButton((btn) => {
				btn.setIcon("plus").setTooltip("添加文件").onClick(() => {
					new FileSuggestModal(this.app, (path) => {
						if (!mode.files.includes(path)) {
							mode.files.push(path);
							renderFilePills();
						}
					}).open();
				});
			});
			const pillsContainer = filesSetting.settingEl.createDiv({ cls: "ws-studio-edit-files-pills" });
			const renderFilePills = () => {
				pillsContainer.empty();
				if (mode.files.length === 0) {
					pillsContainer.createSpan({ cls: "ws-studio-edit-files-empty", text: "无附件" });
					return;
				}
				for (let fi = 0; fi < mode.files.length; fi++) {
					const filePath = mode.files[fi];
					const pill = pillsContainer.createDiv({ cls: "ws-studio-edit-file-pill" });
					const iconSpan = pill.createSpan({ cls: "ws-studio-edit-file-pill-icon" });
					setIcon(iconSpan, "file-text");
					const displayName = filePath.replace(/^.*\//, "").replace(/\.md$/, "");
					pill.createSpan({ cls: "ws-studio-edit-file-pill-name", text: displayName });
					pill.setAttribute("title", filePath);
					const removeBtn = pill.createSpan({ cls: "ws-studio-edit-file-pill-remove" });
					setIcon(removeBtn, "x");
					removeBtn.addEventListener("click", (ev) => {
						ev.stopPropagation();
						mode.files.splice(fi, 1);
						renderFilePills();
					});
				}
			};
			renderFilePills();

			const actionsSetting = new Setting(card).setName("Actions");
			actionsSetting.addButton((btn) => {
				btn.setIcon("plus").setTooltip("添加 Action").onClick(() => {
					mode.actions.push({ label: "新 Action", prompt: "" });
					this.renderActions(actionsContainer, mode);
				});
			});
			const actionsContainer = card.createDiv({ cls: "ws-studio-edit-actions-list" });
			this.renderActions(actionsContainer, mode);
		}
	}

	private renderActions(container: HTMLElement, mode: HarnessMode): void {
		container.empty();
		for (let j = 0; j < mode.actions.length; j++) {
			const action = mode.actions[j];
			new Setting(container)
				.addText((text) => {
					text.setPlaceholder("label").setValue(action.label)
						.onChange((v) => { action.label = v; });
					text.inputEl.addClass("ws-studio-edit-action-label");
				})
				.addText((text) => {
					text.setPlaceholder("prompt").setValue(action.prompt)
						.onChange((v) => { action.prompt = v; });
				})
				.addButton((btn) => {
					btn.setIcon("x").setWarning().onClick(() => {
						mode.actions.splice(j, 1);
						this.renderActions(container, mode);
					});
				});
		}
	}

	private async save(): Promise<void> {
		const modesPath = `${this.plugin.settings.harnessProjectsFolder}/${this.workspaceName}/modes.md`;
		const content = serializeModesToContent(this.modes);
		const adapter = this.app.vault.adapter;
		await adapter.write(modesPath, content);
		new Notice("已保存 modes.md");
		await this.onSave();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ── File Suggest Modal ──────────────────────────────────

class FileSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (path: string) => void;

	constructor(app: App, onChoose: (path: string) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder("搜索 vault 中的文件…");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseSuggestion(item: FuzzyMatch<TFile>): void {
		this.onChoose(item.item.path);
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item.path);
	}
}

// suppress unused warning for HarnessModeAction (kept for future action-icon editing)
type _EnsureUsed = HarnessModeAction;
void (null as unknown as _EnsureUsed);
