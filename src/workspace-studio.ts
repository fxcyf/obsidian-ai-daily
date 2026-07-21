/**
 * Workspace Studio — three-layer navigation for managing workspaces and modes.
 *
 * Screens:
 *   3c  Studio Home — all workspaces list (active / archived)
 *   3a  Workspace Overview — modes list with counts, workspace-level injection
 *   3b  Mode Editor — name / system prompt / injected context / actions
 *
 * Rendered inside Chat View (not a standalone Obsidian View).
 */

import { App, TFile, setIcon, Modal, Setting, Notice, FuzzySuggestModal, type FuzzyMatch } from "obsidian";
import type AIDailyChat from "./main";
import {
	loadProjectIndex,
	parseModesFromContent,
	type ProjectIndex,
	type HarnessContext,
} from "./harness-view";
import type { HarnessMode } from "./settings";
import type { ChatSessionFile } from "./chat-session";
import { listChatSessions } from "./chat-session";
import { serializeModesToContent } from "./modes-serializer";

export interface StudioCallbacks {
	onStartWithContext: (ctx: HarnessContext) => void;
	onOpenSession: (sessionId: string) => void;
	onStartFresh: () => void;
	onClose: () => void;
}

type Screen = "home" | "workspace" | "mode";

export class WorkspaceStudio {
	private container: HTMLElement;
	private app: App;
	private plugin: AIDailyChat;
	private callbacks: StudioCallbacks;
	private projectIndex: ProjectIndex | null = null;
	private sessions: ChatSessionFile[] = [];

	private screen: Screen = "home";
	private selectedWorkspace: string | null = null;
	private selectedModeIndex: number = -1;
	private editingModes: HarnessMode[] = [];
	private workspaceLevelFiles: string[] = [];
	private dirty = false;

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

		switch (this.screen) {
			case "home":
				this.renderHome();
				break;
			case "workspace":
				await this.renderWorkspace();
				break;
			case "mode":
				this.renderMode();
				break;
		}
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

	// ── 3c: Studio Home ─────────────────────────────────────

	private renderHome(): void {
		const head = this.container.createDiv({ cls: "ws-studio-head" });
		const backBtn = head.createEl("button", { cls: "ws-studio-back", attr: { "aria-label": "返回" } });
		const backIcon = backBtn.createSpan({ cls: "ws-studio-back-icon" });
		setIcon(backIcon, "chevron-left");
		backBtn.addEventListener("click", () => this.callbacks.onClose());

		const addBtn = head.createEl("button", { cls: "ws-studio-head-action" });
		const addIcon = addBtn.createSpan({ cls: "ws-studio-head-action-icon" });
		setIcon(addIcon, "plus");
		addBtn.createSpan({ text: "新建" });
		addBtn.addEventListener("click", () => this.openCreateWorkspaceModal());

		// Search
		const searchWrap = this.container.createDiv({ cls: "ws-studio-search" });
		const searchIcon = searchWrap.createSpan({ cls: "ws-studio-search-icon" });
		setIcon(searchIcon, "search");
		const searchInput = searchWrap.createEl("input", {
			cls: "ws-studio-search-input",
			attr: { placeholder: "搜索工作区…", type: "text" },
		});
		searchInput.addEventListener("input", () => {
			const q = searchInput.value.toLowerCase();
			const rows = this.container.querySelectorAll<HTMLElement>(".ws-studio-ws-row");
			rows.forEach((row) => {
				const name = row.dataset.name?.toLowerCase() ?? "";
				row.style.display = name.includes(q) ? "" : "none";
			});
		});

		const allProjects = this.projectIndex?.projects ?? [];
		const activeProjects = allProjects.filter((p) => p.status !== "archive");
		const archivedProjects = allProjects.filter((p) => p.status === "archive");

		// Active section
		if (activeProjects.length > 0) {
			const secHead = this.container.createDiv({ cls: "ws-studio-sec-head" });
			secHead.createSpan({ cls: "ws-studio-sec-label", text: "活跃" });
			secHead.createSpan({ cls: "ws-studio-sec-count", text: String(activeProjects.length) });

			const list = this.container.createDiv({ cls: "ws-studio-ws-list" });
			for (const p of activeProjects) {
				this.renderWorkspaceRow(list, p.name, false);
			}
		}

		// Archived section
		if (archivedProjects.length > 0) {
			const secHead = this.container.createDiv({ cls: "ws-studio-sec-head" });
			secHead.createSpan({ cls: "ws-studio-sec-label", text: "已归档" });
			secHead.createSpan({ cls: "ws-studio-sec-count", text: String(archivedProjects.length) });

			const list = this.container.createDiv({ cls: "ws-studio-ws-list" });
			for (const p of archivedProjects) {
				this.renderWorkspaceRow(list, p.name, true);
			}
		}
	}

	private renderWorkspaceRow(parent: HTMLElement, name: string, archived: boolean): void {
		const row = parent.createDiv({ cls: "ws-studio-ws-row" });
		row.dataset.name = name;
		if (archived) row.addClass("ws-studio-ws-archived");

		const iconWrap = row.createDiv({ cls: "ws-studio-ws-icon" });
		setIcon(iconWrap, archived ? "archive" : "folder");

		const info = row.createDiv({ cls: "ws-studio-ws-info" });
		info.createDiv({ cls: "ws-studio-ws-name", text: name });

		// Compute metadata
		const projectsFolder = this.plugin.settings.harnessProjectsFolder;
		const modesPath = `${projectsFolder}/${name}/modes.md`;
		const modesFile = this.app.vault.getAbstractFileByPath(modesPath);
		const wsSessions = this.sessions.filter(
			(s) => (s.workspace || s.harnessContext?.workspace) === name,
		);
		const lastUsed = wsSessions.length > 0 ? this.formatRelativeTime(wsSessions[0].updated) : "";

		if (modesFile instanceof TFile) {
			void this.app.vault.read(modesFile).then((content) => {
				const modes = parseModesFromContent(content);
				const actionCount = modes.reduce((sum, m) => sum + m.actions.length, 0);
				const metaParts: string[] = [];
				metaParts.push(`${modes.length} 模式`);
				if (actionCount > 0) metaParts.push(`${actionCount} action`);
				if (archived) {
					const archivedDate = this.getArchivedDate(name);
					if (archivedDate) metaParts.push(`归档于 ${archivedDate}`);
				} else if (lastUsed) {
					metaParts.push(lastUsed);
				}
				const metaEl = info.querySelector<HTMLElement>(".ws-studio-ws-meta");
				if (metaEl) metaEl.textContent = metaParts.join(" · ");
			});
		}

		info.createDiv({ cls: "ws-studio-ws-meta", text: "…" });

		if (archived) {
			const restoreBtn = row.createEl("button", { cls: "ws-studio-ws-restore", text: "恢复" });
			restoreBtn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				void this.unarchiveWorkspace(name);
			});
		} else {
			// Active dot for most recently used workspace
			const active = this.projectIndex?.activeProject;
			if (name === active) {
				row.createSpan({ cls: "ws-studio-ws-dot" });
			}
			const chevron = row.createSpan({ cls: "ws-studio-ws-chevron" });
			setIcon(chevron, "chevron-right");
		}

		row.addEventListener("click", () => {
			if (archived) return;
			this.navigateTo("workspace", name);
		});
	}

	// ── 3a: Workspace Overview ──────────────────────────────

	private async renderWorkspace(): Promise<void> {
		const name = this.selectedWorkspace!;

		// Load modes if not already editing
		if (this.editingModes.length === 0 || !this.dirty) {
			const projectsFolder = this.plugin.settings.harnessProjectsFolder;
			const modesPath = `${projectsFolder}/${name}/modes.md`;
			const file = this.app.vault.getAbstractFileByPath(modesPath);
			if (file instanceof TFile) {
				const content = await this.app.vault.read(file);
				this.editingModes = parseModesFromContent(content);
			} else {
				this.editingModes = [];
			}
			this.dirty = false;
		}

		// Header
		const head = this.container.createDiv({ cls: "ws-studio-head" });
		const backBtn = head.createEl("button", { cls: "ws-studio-back", attr: { "aria-label": "返回" } });
		const backIcon = backBtn.createSpan({ cls: "ws-studio-back-icon" });
		setIcon(backIcon, "chevron-left");
		backBtn.addEventListener("click", () => this.navigateTo("home"));

		const addBtn = head.createEl("button", { cls: "ws-studio-head-action" });
		const addIcon = addBtn.createSpan({ cls: "ws-studio-head-action-icon" });
		setIcon(addIcon, "plus");
		addBtn.createSpan({ text: "新建工作区" });
		addBtn.addEventListener("click", () => this.openCreateWorkspaceModal());

		// Workspace identity
		const identity = this.container.createDiv({ cls: "ws-studio-identity" });
		identity.createDiv({ cls: "ws-studio-identity-label", text: "工作区" });
		const nameRow = identity.createDiv({ cls: "ws-studio-identity-name-row" });
		const wsIcon = nameRow.createDiv({ cls: "ws-studio-identity-icon" });
		setIcon(wsIcon, "folder");
		const nameInput = nameRow.createEl("input", {
			cls: "ws-studio-identity-input",
			attr: { value: name, readonly: "" },
		});

		// Workspace-level injection
		const injLabel = identity.createDiv({ cls: "ws-studio-inject-label" });
		injLabel.createSpan({ text: "工作区级注入" });
		injLabel.createSpan({ cls: "ws-studio-inject-sep" });

		const injPills = identity.createDiv({ cls: "ws-studio-inject-pills" });
		this.renderWorkspaceLevelFiles(injPills);

		// Modes section
		const modesSec = this.container.createDiv({ cls: "ws-studio-sec-head" });
		modesSec.createSpan({ cls: "ws-studio-sec-label", text: "模式" });
		const totalActions = this.editingModes.reduce((s, m) => s + m.actions.length, 0);
		modesSec.createSpan({
			cls: "ws-studio-sec-count",
			text: `${this.editingModes.length} 个模式 · ${totalActions} 个 Action`,
		});

		const modeList = this.container.createDiv({ cls: "ws-studio-mode-list" });
		for (let i = 0; i < this.editingModes.length; i++) {
			this.renderModeRow(modeList, i);
		}

		// Add mode
		const addMode = modeList.createDiv({ cls: "ws-studio-mode-add" });
		const addModeIcon = addMode.createSpan({ cls: "ws-studio-mode-add-icon" });
		setIcon(addModeIcon, "plus");
		addMode.createSpan({ text: "新建模式" });
		addMode.addEventListener("click", () => {
			this.editingModes.push({
				id: `mode-${this.editingModes.length + 1}`,
				label: "新模式",
				emoji: "📋",
				files: [],
				systemPromptAppend: "",
				actions: [],
			});
			this.dirty = true;
			this.navigateTo("mode", this.selectedWorkspace!, this.editingModes.length - 1);
		});

		// Footer buttons
		const footer = this.container.createDiv({ cls: "ws-studio-footer" });
		const saveBtn = footer.createEl("button", { cls: "ws-studio-save-btn" });
		const saveIcon = saveBtn.createSpan({ cls: "ws-studio-save-icon" });
		setIcon(saveIcon, "check");
		saveBtn.createSpan({ text: "保存工作区" });
		saveBtn.addEventListener("click", async () => {
			await this.save();
		});

		const deleteBtn = footer.createEl("button", { cls: "ws-studio-delete-btn" });
		setIcon(deleteBtn, "trash-2");
		deleteBtn.addEventListener("click", async () => {
			await this.archiveWorkspace(name);
			this.navigateTo("home");
		});
	}

	private renderModeRow(parent: HTMLElement, index: number): void {
		const mode = this.editingModes[index];
		const row = parent.createDiv({ cls: "ws-studio-mode-row" });

		const iconWrap = row.createDiv({ cls: "ws-studio-mode-icon" });
		iconWrap.textContent = mode.emoji;

		const info = row.createDiv({ cls: "ws-studio-mode-info" });
		info.createDiv({ cls: "ws-studio-mode-name", text: mode.label });
		const metaParts: string[] = [];
		metaParts.push(`${mode.files.length} files`);
		if (mode.actions.length > 0) {
			metaParts.push(`${mode.actions.length} action${mode.actions.length > 1 ? "s" : ""}`);
		} else {
			metaParts.push("无 action");
		}
		info.createDiv({ cls: "ws-studio-mode-meta", text: metaParts.join(" · ") });

		if (mode.actions.length > 0) {
			const badge = row.createSpan({ cls: "ws-studio-mode-badge" });
			badge.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>';
			badge.createSpan({ text: String(mode.actions.length) });
		}

		const chevron = row.createSpan({ cls: "ws-studio-mode-chevron" });
		setIcon(chevron, "chevron-right");

		row.addEventListener("click", () => {
			this.navigateTo("mode", this.selectedWorkspace!, index);
		});
	}

	private renderWorkspaceLevelFiles(container: HTMLElement): void {
		container.empty();
		// Currently workspace-level files aren't stored separately — this is a placeholder
		// for future workspace-level context injection. For now, show an "add" button.
		const addPill = container.createDiv({ cls: "ws-studio-inject-add" });
		const addIcon = addPill.createSpan({ cls: "ws-studio-inject-add-icon" });
		setIcon(addIcon, "plus");
		addPill.createSpan({ text: "添加" });
	}

	// ── 3b: Mode Editor ─────────────────────────────────────

	private renderMode(): void {
		const mode = this.editingModes[this.selectedModeIndex];
		if (!mode) return;

		// Header
		const head = this.container.createDiv({ cls: "ws-studio-head" });
		const backBtn = head.createEl("button", { cls: "ws-studio-back" });
		const backIcon = backBtn.createSpan({ cls: "ws-studio-back-icon" });
		setIcon(backIcon, "chevron-left");
		const breadcrumb = backBtn.createSpan();
		breadcrumb.createSpan({ cls: "ws-studio-breadcrumb-ws", text: this.selectedWorkspace! });
		breadcrumb.createSpan({ cls: "ws-studio-breadcrumb-sep", text: " / " });
		breadcrumb.createSpan({ cls: "ws-studio-breadcrumb-mode", text: mode.label });
		backBtn.addEventListener("click", () => this.navigateTo("workspace", this.selectedWorkspace!));

		const saveLink = head.createEl("button", { cls: "ws-studio-head-save", text: "保存" });
		saveLink.addEventListener("click", async () => {
			await this.save();
		});

		// Mode name section
		const nameSection = this.container.createDiv({ cls: "ws-studio-editor-section" });
		nameSection.createDiv({ cls: "ws-studio-editor-label", text: "模式名称" });
		const nameRow = nameSection.createDiv({ cls: "ws-studio-identity-name-row" });
		const nameInput = nameRow.createEl("input", {
			cls: "ws-studio-identity-input",
			attr: { value: mode.label },
		});
		nameInput.addEventListener("input", () => {
			mode.label = nameInput.value;
			this.dirty = true;
		});

		// ID / emoji meta row
		const metaRow = nameSection.createDiv({ cls: "ws-studio-mode-meta-row" });
		const idWrap = metaRow.createDiv({ cls: "ws-studio-mode-meta-field" });
		idWrap.createSpan({ cls: "ws-studio-mode-meta-label", text: "ID" });
		const idInput = idWrap.createEl("input", {
			cls: "ws-studio-mode-meta-input",
			attr: { value: mode.id },
		});
		idInput.addEventListener("input", () => {
			mode.id = idInput.value;
			this.dirty = true;
		});

		const emojiWrap = metaRow.createDiv({ cls: "ws-studio-mode-meta-field" });
		emojiWrap.createSpan({ cls: "ws-studio-mode-meta-label", text: "图标" });
		const emojiInput = emojiWrap.createEl("input", {
			cls: "ws-studio-mode-meta-input ws-studio-mode-meta-emoji",
			attr: { value: mode.emoji, maxlength: "2" },
		});
		emojiInput.addEventListener("input", () => {
			mode.emoji = emojiInput.value;
			this.dirty = true;
		});

		// System prompt section
		const promptSection = this.container.createDiv({ cls: "ws-studio-editor-section" });
		const promptHead = promptSection.createDiv({ cls: "ws-studio-editor-label-row" });
		promptHead.createSpan({ cls: "ws-studio-editor-label", text: "系统提示" });
		const charCount = promptSection.createSpan({
			cls: "ws-studio-editor-count",
			text: `${mode.systemPromptAppend.length} 字`,
		});
		promptHead.appendChild(charCount);

		const promptEl = promptSection.createEl("textarea", { cls: "ws-studio-editor-prompt" });
		promptEl.value = mode.systemPromptAppend;
		promptEl.rows = 6;
		promptEl.setAttribute("placeholder", "System prompt...");
		promptEl.addEventListener("input", () => {
			mode.systemPromptAppend = promptEl.value;
			charCount.textContent = `${promptEl.value.length} 字`;
			this.dirty = true;
		});

		// Injected context section
		const ctxSection = this.container.createDiv({ cls: "ws-studio-editor-section" });
		ctxSection.createDiv({
			cls: "ws-studio-editor-label",
			text: `注入上下文 · ${mode.files.length}`,
		});
		const filesList = ctxSection.createDiv({ cls: "ws-studio-editor-files" });
		const renderFiles = () => {
			filesList.empty();
			for (let fi = 0; fi < mode.files.length; fi++) {
				const filePath = mode.files[fi];
				const fileRow = filesList.createDiv({ cls: "ws-studio-editor-file" });
				const fIcon = fileRow.createSpan({ cls: "ws-studio-editor-file-icon" });
				setIcon(fIcon, "file-text");
				const displayName = filePath.replace(/^.*\//, "").replace(/\.md$/, "");
				fileRow.createSpan({ cls: "ws-studio-editor-file-name", text: displayName });
				fileRow.setAttribute("title", filePath);
				const removeBtn = fileRow.createSpan({ cls: "ws-studio-editor-file-remove" });
				setIcon(removeBtn, "x");
				removeBtn.addEventListener("click", (ev) => {
					ev.stopPropagation();
					mode.files.splice(fi, 1);
					this.dirty = true;
					renderFiles();
					ctxSection.querySelector(".ws-studio-editor-label")!.textContent =
						`注入上下文 · ${mode.files.length}`;
				});
			}
			const addFileBtn = filesList.createDiv({ cls: "ws-studio-editor-file-add" });
			const afIcon = addFileBtn.createSpan({ cls: "ws-studio-editor-file-add-icon" });
			setIcon(afIcon, "plus");
			addFileBtn.createSpan({ text: "添加文件 / 文件夹" });
			addFileBtn.addEventListener("click", () => {
				new FileSuggestModal(this.app, (path) => {
					if (!mode.files.includes(path)) {
						mode.files.push(path);
						this.dirty = true;
						renderFiles();
						ctxSection.querySelector(".ws-studio-editor-label")!.textContent =
							`注入上下文 · ${mode.files.length}`;
					}
				}).open();
			});
		};
		renderFiles();

		// Actions section
		const actSection = this.container.createDiv({ cls: "ws-studio-editor-section ws-studio-editor-actions" });
		const actHead = actSection.createDiv({ cls: "ws-studio-editor-label-row ws-studio-editor-actions-head" });
		const boltIcon = actHead.createSpan({ cls: "ws-studio-editor-bolt" });
		boltIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>';
		actHead.createSpan({
			cls: "ws-studio-editor-label ws-studio-editor-label--accent",
			text: `一键 Action · ${mode.actions.length}`,
		});

		const actionsList = actSection.createDiv({ cls: "ws-studio-editor-actions-list" });
		const renderActions = () => {
			actionsList.empty();
			for (let j = 0; j < mode.actions.length; j++) {
				const action = mode.actions[j];
				const actionCard = actionsList.createDiv({ cls: "ws-studio-editor-action" });
				const actionRow = actionCard.createDiv({ cls: "ws-studio-editor-action-head" });
				const labelInput = actionRow.createEl("input", {
					cls: "ws-studio-editor-action-label",
					attr: { value: action.label, placeholder: "Action 名称" },
				});
				labelInput.addEventListener("input", () => {
					action.label = labelInput.value;
					this.dirty = true;
				});
				const editBtn = actionRow.createSpan({ cls: "ws-studio-editor-action-edit" });
				setIcon(editBtn, "pencil");
				const removeBtn = actionRow.createSpan({ cls: "ws-studio-editor-action-remove" });
				setIcon(removeBtn, "x");
				removeBtn.addEventListener("click", () => {
					mode.actions.splice(j, 1);
					this.dirty = true;
					renderActions();
					actHead.querySelector(".ws-studio-editor-label")!.textContent =
						`一键 Action · ${mode.actions.length}`;
				});

				const promptInput = actionCard.createEl("textarea", {
					cls: "ws-studio-editor-action-prompt",
					attr: { placeholder: "Action prompt…", rows: "2" },
				});
				promptInput.value = action.prompt;
				promptInput.addEventListener("input", () => {
					action.prompt = promptInput.value;
					this.dirty = true;
				});
			}

			const addAction = actionsList.createDiv({ cls: "ws-studio-editor-action-add" });
			const addAIcon = addAction.createSpan({ cls: "ws-studio-editor-action-add-icon" });
			setIcon(addAIcon, "plus");
			addAction.createSpan({ text: "新建 Action" });
			addAction.addEventListener("click", () => {
				mode.actions.push({ label: "新 Action", prompt: "" });
				this.dirty = true;
				renderActions();
				actHead.querySelector(".ws-studio-editor-label")!.textContent =
					`一键 Action · ${mode.actions.length}`;
			});
		};
		renderActions();

		// Delete mode
		const dangerSection = this.container.createDiv({ cls: "ws-studio-editor-danger" });
		const deleteBtn = dangerSection.createEl("button", { cls: "ws-studio-editor-delete-mode" });
		setIcon(deleteBtn, "trash-2");
		deleteBtn.createSpan({ text: "删除此模式" });
		deleteBtn.addEventListener("click", () => {
			this.editingModes.splice(this.selectedModeIndex, 1);
			this.dirty = true;
			this.navigateTo("workspace", this.selectedWorkspace!);
		});
	}

	// ── Navigation ──────────────────────────────────────────

	private navigateTo(screen: "home"): void;
	private navigateTo(screen: "workspace", workspace: string): void;
	private navigateTo(screen: "mode", workspace: string, modeIndex: number): void;
	private navigateTo(screen: Screen, workspace?: string, modeIndex?: number): void {
		this.screen = screen;
		if (workspace !== undefined) this.selectedWorkspace = workspace;
		if (modeIndex !== undefined) this.selectedModeIndex = modeIndex;
		if (screen === "home") {
			this.selectedWorkspace = null;
			this.selectedModeIndex = -1;
			this.editingModes = [];
			this.dirty = false;
		}
		void this.render();
	}

	// ── Data helpers ────────────────────────────────────────

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
		if (days === 1) return "昨天";
		if (days < 7) return `${days} 天前`;
		if (days < 30) return "上周";
		return `${Math.floor(days / 30)} 月前`;
	}

	private getArchivedDate(_name: string): string {
		// Could parse from _INDEX.md updated field; simplified for now
		return "";
	}

	// ── CRUD ────────────────────────────────────────────────

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

	private async save(): Promise<void> {
		if (!this.selectedWorkspace) return;
		const modesPath = `${this.plugin.settings.harnessProjectsFolder}/${this.selectedWorkspace}/modes.md`;
		const content = serializeModesToContent(this.editingModes);
		const adapter = this.app.vault.adapter;
		await adapter.write(modesPath, content);
		this.dirty = false;
		new Notice("已保存 modes.md");
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
		this.modalEl.addClass("ai-daily-modal-sm");
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
