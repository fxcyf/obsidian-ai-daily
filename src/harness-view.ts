import { ItemView, WorkspaceLeaf, setIcon, TFile } from "obsidian";
import type AIDailyChat from "./main";
import type { HarnessMode } from "./settings";

export const HARNESS_VIEW_TYPE = "ai-daily-harness";

interface ProjectIndex {
	activeProject: string;
	activeWorkContext: string;
	projects: { name: string; status: string; updated: string }[];
}

export interface HarnessContext {
	mode: HarnessMode;
	injectedFiles: { path: string; content: string }[];
}

export class HarnessView extends ItemView {
	plugin: AIDailyChat;
	private containerDiv!: HTMLElement;
	private selectedModeId: string | null = null;
	private projectIndex: ProjectIndex | null = null;
	private statusEl: HTMLElement | null = null;
	private projectNameEl: HTMLElement | null = null;
	private startBtn: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AIDailyChat) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return HARNESS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Harness";
	}

	getIcon(): string {
		return "brain";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("ai-daily-harness-container");
		this.containerDiv = container;

		await this.loadProjectIndex();
		this.buildUI();
	}

	private async loadProjectIndex(): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath("KB/Projects/_INDEX.md");
		if (!(file instanceof TFile)) {
			this.projectIndex = null;
			return;
		}

		const content = await this.app.vault.read(file);
		this.projectIndex = this.parseProjectIndex(content);
	}

	private parseProjectIndex(content: string): ProjectIndex {
		const result: ProjectIndex = {
			activeProject: "",
			activeWorkContext: "",
			projects: [],
		};

		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.startsWith("active_project:")) {
				result.activeProject = trimmed.slice("active_project:".length).trim();
			} else if (trimmed.startsWith("active_work_context:")) {
				result.activeWorkContext = trimmed.slice("active_work_context:".length).trim();
			}
		}

		const tableLines = content.split("\n").filter((l) => l.trim().startsWith("|") && !l.includes("---"));
		for (let i = 1; i < tableLines.length; i++) {
			const cols = tableLines[i].split("|").map((c) => c.trim()).filter(Boolean);
			if (cols.length >= 4) {
				result.projects.push({
					name: cols[0],
					status: cols[1],
					updated: cols[3],
				});
			}
		}

		return result;
	}

	private buildUI(): void {
		this.containerDiv.empty();

		const header = this.containerDiv.createDiv({ cls: "ai-daily-harness-header" });
		header.createDiv({ cls: "ai-daily-harness-title", text: "Harness" });

		this.buildProjectSection();
		this.buildModeSection();
		this.buildStatusSection();
		this.buildStartButton();
	}

	private buildProjectSection(): void {
		const section = this.containerDiv.createDiv({ cls: "ai-daily-harness-section" });
		section.createDiv({ cls: "ai-daily-harness-section-label", text: "当前项目" });

		const projectRow = section.createDiv({ cls: "ai-daily-harness-project-row" });
		this.projectNameEl = projectRow.createDiv({ cls: "ai-daily-harness-project-name" });

		if (this.projectIndex?.activeProject) {
			this.projectNameEl.setText(this.projectIndex.activeProject);
		} else {
			this.projectNameEl.setText("未设置");
			this.projectNameEl.addClass("ai-daily-harness-muted");
		}

		const switchBtn = projectRow.createEl("button", {
			cls: "ai-daily-harness-switch-btn",
			text: "切换",
		});
		setIcon(switchBtn, "chevron-down");
		switchBtn.addEventListener("click", () => this.showProjectPicker());
	}

	private buildModeSection(): void {
		const section = this.containerDiv.createDiv({ cls: "ai-daily-harness-section" });
		section.createDiv({ cls: "ai-daily-harness-section-label", text: "模式" });

		const grid = section.createDiv({ cls: "ai-daily-harness-mode-grid" });
		const modes = this.plugin.settings.harnessModes;

		for (const mode of modes) {
			const btn = grid.createEl("button", {
				cls: "ai-daily-harness-mode-btn",
			});
			btn.createSpan({ text: mode.emoji });
			btn.createSpan({ text: ` ${mode.label}` });

			if (this.selectedModeId === mode.id) {
				btn.addClass("ai-daily-harness-mode-active");
			}

			btn.addEventListener("click", () => {
				this.selectedModeId = this.selectedModeId === mode.id ? null : mode.id;
				this.refreshModeButtons(grid, modes);
				this.updateStartButton();
			});
		}

		const freeBtn = grid.createEl("button", {
			cls: "ai-daily-harness-mode-btn",
		});
		freeBtn.createSpan({ text: "💬" });
		freeBtn.createSpan({ text: " 自由对话" });

		if (this.selectedModeId === "__free__") {
			freeBtn.addClass("ai-daily-harness-mode-active");
		}

		freeBtn.addEventListener("click", () => {
			this.selectedModeId = this.selectedModeId === "__free__" ? null : "__free__";
			this.refreshModeButtons(grid, modes);
			this.updateStartButton();
		});
	}

	private refreshModeButtons(grid: HTMLElement, modes: HarnessMode[]): void {
		const buttons = grid.querySelectorAll(".ai-daily-harness-mode-btn");
		const allIds = [...modes.map((m) => m.id), "__free__"];
		buttons.forEach((btn, i) => {
			btn.toggleClass("ai-daily-harness-mode-active", allIds[i] === this.selectedModeId);
		});
	}

	private buildStatusSection(): void {
		const section = this.containerDiv.createDiv({ cls: "ai-daily-harness-section" });
		section.createDiv({ cls: "ai-daily-harness-section-label", text: "状态摘要" });

		this.statusEl = section.createDiv({ cls: "ai-daily-harness-status" });
		this.refreshStatus();
	}

	private async refreshStatus(): Promise<void> {
		if (!this.statusEl) return;
		this.statusEl.empty();

		if (!this.projectIndex?.activeProject) {
			this.statusEl.createDiv({
				cls: "ai-daily-harness-muted",
				text: "无活跃项目",
			});
			return;
		}

		const progressPath = `KB/Projects/${this.projectIndex.activeProject}/PROGRESS.md`;
		const progressFile = this.app.vault.getAbstractFileByPath(progressPath);
		if (progressFile instanceof TFile) {
			const content = await this.app.vault.read(progressFile);
			const summary = this.extractProgressSummary(content);
			if (summary.lastDone) {
				const row = this.statusEl.createDiv({ cls: "ai-daily-harness-status-row" });
				row.createSpan({ cls: "ai-daily-harness-status-label", text: "上次：" });
				row.createSpan({ text: summary.lastDone });
			}
			if (summary.nextStep) {
				const row = this.statusEl.createDiv({ cls: "ai-daily-harness-status-row" });
				row.createSpan({ cls: "ai-daily-harness-status-label", text: "下一步：" });
				row.createSpan({ text: summary.nextStep });
			}
		}

		const inboxFile = this.app.vault.getAbstractFileByPath("KB/Inbox/ideas.md");
		if (inboxFile instanceof TFile) {
			const content = await this.app.vault.read(inboxFile);
			const count = this.countUnprocessedInbox(content);
			if (count > 0) {
				const row = this.statusEl.createDiv({ cls: "ai-daily-harness-status-row" });
				row.createSpan({ cls: "ai-daily-harness-status-label", text: "Inbox：" });
				row.createSpan({ text: `${count} 条待处理` });
			}
		}

		if (!this.statusEl.hasChildNodes()) {
			this.statusEl.createDiv({
				cls: "ai-daily-harness-muted",
				text: "暂无状态信息",
			});
		}
	}

	private extractProgressSummary(content: string): { lastDone: string; nextStep: string } {
		const lines = content.split("\n");
		let lastDone = "";
		let nextStep = "";

		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i].trim();
			if (!lastDone && line.startsWith("- [x]")) {
				lastDone = line.slice(5).trim();
			}
			if (!nextStep && (line.startsWith("- [ ]") || line.startsWith("- []"))) {
				nextStep = line.replace(/^- \[[ ]?\]\s*/, "").trim();
			}
			if (lastDone && nextStep) break;
		}

		if (!lastDone && !nextStep) {
			const headings = lines.filter((l) => l.startsWith("## "));
			if (headings.length > 0) {
				lastDone = headings[headings.length - 1].replace(/^##\s*/, "");
			}
		}

		return { lastDone, nextStep };
	}

	private countUnprocessedInbox(content: string): number {
		return content.split("\n").filter((l) => l.trim().startsWith("- [ ]")).length;
	}

	private buildStartButton(): void {
		const section = this.containerDiv.createDiv({ cls: "ai-daily-harness-start-section" });
		this.startBtn = section.createEl("button", {
			cls: "ai-daily-harness-start-btn",
			text: "开始 →",
		});
		this.startBtn.disabled = !this.selectedModeId;

		this.startBtn.addEventListener("click", () => this.handleStart());
	}

	private updateStartButton(): void {
		if (this.startBtn) {
			this.startBtn.disabled = !this.selectedModeId;
		}
	}

	private async handleStart(): Promise<void> {
		if (!this.selectedModeId) return;

		if (this.selectedModeId === "__free__") {
			await this.plugin.startChatWithContext(null);
			return;
		}

		const mode = this.plugin.settings.harnessModes.find((m) => m.id === this.selectedModeId);
		if (!mode) return;

		const injectedFiles = await this.resolveFiles(mode.files);
		const context: HarnessContext = { mode, injectedFiles };
		await this.plugin.startChatWithContext(context);
	}

	private async resolveFiles(
		filePaths: string[]
	): Promise<{ path: string; content: string }[]> {
		const results: { path: string; content: string }[] = [];

		for (const rawPath of filePaths) {
			const resolvedPath = this.resolveVariables(rawPath);
			const file = this.app.vault.getAbstractFileByPath(resolvedPath);
			if (file instanceof TFile) {
				const content = await this.app.vault.read(file);
				results.push({ path: resolvedPath, content });
			}
		}

		return results;
	}

	private resolveVariables(path: string): string {
		let resolved = path;
		if (this.projectIndex) {
			resolved = resolved.replace(
				/\{active_project\}/g,
				this.projectIndex.activeProject || ""
			);
			resolved = resolved.replace(
				/\{active_work_context\}/g,
				this.projectIndex.activeWorkContext || ""
			);
		}
		return resolved;
	}

	private showProjectPicker(): void {
		if (!this.projectIndex || this.projectIndex.projects.length === 0) return;

		const existing = this.containerDiv.querySelector(".ai-daily-harness-picker");
		if (existing) {
			existing.remove();
			return;
		}

		const picker = this.containerDiv.createDiv({ cls: "ai-daily-harness-picker" });

		for (const project of this.projectIndex.projects) {
			const item = picker.createDiv({ cls: "ai-daily-harness-picker-item" });
			const isActive = project.name === this.projectIndex!.activeProject;

			if (isActive) item.addClass("ai-daily-harness-picker-active");

			const dot = item.createSpan({ cls: "ai-daily-harness-picker-dot" });
			dot.style.background =
				project.status === "active"
					? "var(--interactive-accent)"
					: "var(--text-muted)";
			item.createSpan({ text: project.name });
			item.createSpan({
				cls: "ai-daily-harness-picker-status",
				text: project.status,
			});

			item.addEventListener("click", async () => {
				await this.switchProject(project.name);
				picker.remove();
			});
		}
	}

	private async switchProject(projectName: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath("KB/Projects/_INDEX.md");
		if (!(file instanceof TFile)) return;

		let content = await this.app.vault.read(file);
		content = content.replace(
			/^(active_project:\s*).*$/m,
			`$1${projectName}`
		);
		await this.app.vault.modify(file, content);

		await this.loadProjectIndex();
		this.buildUI();
	}

	async onClose(): Promise<void> {
		this.containerDiv?.empty();
	}
}
