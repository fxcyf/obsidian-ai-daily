/**
 * Harness View — per-project mode system.
 *
 * Data sources:
 *
 * KB/Projects/_INDEX.md (frontmatter):
 *   active_project: string        — which project is active
 *   active_work_context: string   — replaces {active_work_context} in file paths
 *   Body: markdown table (项目 | 状态 | 来源 | 最近更新) for project picker
 *
 * KB/Projects/{active_project}/modes.md:
 *   Body contains a ```yaml modes fenced block with mode definitions:
 *     - id: string (required)     — unique identifier, matches ## heading
 *       label: string (required)  — button display text
 *       emoji: string             — defaults to "📋"
 *       files: string[]           — vault paths to inject, supports {active_project} / {active_work_context}
 *   Body also has ## {mode-id} sections — each is the system prompt for that mode
 *
 * Status summary:
 *   KB/Projects/{active_project}/PROGRESS.md — last "- [x]" and first "- [ ]" from bottom
 *   KB/Inbox/ideas.md — count of "- [ ]" lines
 */

import { ItemView, WorkspaceLeaf, setIcon, TFile } from "obsidian";
import type AIDailyChat from "./main";
import type { HarnessMode } from "./settings";

export const HARNESS_VIEW_TYPE = "ai-daily-harness";

interface ProjectIndex {
	activeProject: string;
	activeWorkContext: string;
	projects: { name: string; status: string; updated: string }[];
	modes: HarnessMode[];
}

export interface HarnessContext {
	mode: HarnessMode;
	injectedFiles: { path: string }[];
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

		this.selectedModeId = localStorage.getItem("ai-daily-harness-mode") ?? null;
		await this.loadProjectIndex();
		this.buildUI();
	}

	private async loadProjectIndex(): Promise<void> {
		const indexFile = this.app.vault.getAbstractFileByPath("KB/Projects/_INDEX.md");
		if (!(indexFile instanceof TFile)) {
			this.projectIndex = null;
			return;
		}

		const indexContent = await this.app.vault.read(indexFile);
		const indexFm = this.app.metadataCache.getFileCache(indexFile)?.frontmatter ?? {};

		const activeProject = String(indexFm.active_project ?? "");
		const activeWorkContext = String(indexFm.active_work_context ?? "");

		let modes: HarnessMode[] = [];
		if (activeProject) {
			const modesPath = `KB/Projects/${activeProject}/modes.md`;
			const modesFile = this.app.vault.getAbstractFileByPath(modesPath);
			if (modesFile instanceof TFile) {
				const modesContent = await this.app.vault.read(modesFile);
				modes = this.parseModes(modesContent);
			}
		}

		this.projectIndex = {
			activeProject,
			activeWorkContext,
			projects: this.parseProjectTable(indexContent),
			modes,
		};
	}

	private parseProjectTable(content: string): { name: string; status: string; updated: string }[] {
		const projects: { name: string; status: string; updated: string }[] = [];
		const tableLines = content.split("\n").filter(
			(l) => l.trim().startsWith("|") && !l.includes("---")
		);
		for (let i = 1; i < tableLines.length; i++) {
			const cols = tableLines[i].split("|").map((c) => c.trim()).filter(Boolean);
			if (cols.length >= 4) {
				projects.push({ name: cols[0], status: cols[1], updated: cols[3] });
			}
		}
		return projects;
	}

	private parseModes(content: string): HarnessMode[] {
		const raw = this.parseModesYamlBlock(content);
		if (raw.length === 0) return [];

		const sections = this.parseModeSections(content);

		return raw
			.map((m) => {
				const id = String(m.id ?? "");
				return {
					id,
					label: String(m.label ?? ""),
					emoji: String(m.emoji ?? "📋"),
					files: Array.isArray(m.files) ? m.files.map(String) : [],
					systemPromptAppend: sections.get(id) ?? "",
				};
			})
			.filter((m) => m.id && m.label);
	}

	private parseModesYamlBlock(content: string): Record<string, unknown>[] {
		const match = content.match(/```ya?ml\s+modes\s*\n([\s\S]*?)```/);
		if (!match) return [];

		const yaml = match[1];
		const modes: Record<string, unknown>[] = [];
		let current: Record<string, unknown> | null = null;
		let inFiles = false;

		for (const line of yaml.split("\n")) {
			if (line.match(/^- id:\s*/)) {
				if (current) modes.push(current);
				current = { id: line.replace(/^- id:\s*/, "").trim() };
				inFiles = false;
			} else if (current && line.match(/^\s+label:\s*/)) {
				current.label = line.replace(/^\s+label:\s*/, "").trim();
				inFiles = false;
			} else if (current && line.match(/^\s+emoji:\s*/)) {
				current.emoji = line.replace(/^\s+emoji:\s*/, "").trim().replace(/^["']|["']$/g, "");
				inFiles = false;
			} else if (current && line.match(/^\s+files:\s*$/)) {
				current.files = [];
				inFiles = true;
			} else if (current && line.match(/^\s+files:\s*\[\s*\]\s*$/)) {
				current.files = [];
				inFiles = false;
			} else if (inFiles && current && line.match(/^\s+-\s+/)) {
				(current.files as string[]).push(line.replace(/^\s+-\s+/, "").trim());
			} else {
				inFiles = false;
			}
		}
		if (current) modes.push(current);

		return modes;
	}

	private parseModeSections(content: string): Map<string, string> {
		const sections = new Map<string, string>();
		const lines = content.split("\n");
		let currentId = "";
		let currentLines: string[] = [];

		const fmEnd = content.match(/^---\n[\s\S]*?\n---\n/);
		const startLine = fmEnd ? fmEnd[0].split("\n").length - 1 : 0;

		for (let i = startLine; i < lines.length; i++) {
			const match = lines[i].match(/^## (.+)$/);
			if (match) {
				if (currentId) {
					sections.set(currentId, currentLines.join("\n").trim());
				}
				currentId = match[1].trim();
				currentLines = [];
			} else if (currentId) {
				currentLines.push(lines[i]);
			}
		}
		if (currentId) {
			sections.set(currentId, currentLines.join("\n").trim());
		}

		return sections;
	}

	private async buildUI(): Promise<void> {
		this.containerDiv.empty();

		const header = this.containerDiv.createDiv({ cls: "ai-daily-harness-header" });
		header.createDiv({ cls: "ai-daily-harness-title", text: "Harness" });

		this.buildProjectSection();
		await this.buildModeSection();
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

	private async buildModeSection(): Promise<void> {
		const section = this.containerDiv.createDiv({ cls: "ai-daily-harness-section" });
		section.createDiv({ cls: "ai-daily-harness-section-label", text: "模式" });

		const grid = section.createDiv({ cls: "ai-daily-harness-mode-grid" });
		const modes = this.projectIndex?.modes ?? [];

		if (modes.length === 0) {
			section.createDiv({
				cls: "ai-daily-harness-muted",
				text: "当前项目没有 modes.md",
			});
			return;
		}

		const inboxCount = await this.getInboxCount();

		for (const mode of modes) {
			const btn = grid.createEl("button", {
				cls: "ai-daily-harness-mode-btn",
			});
			btn.createSpan({ text: mode.emoji });
			btn.createSpan({ text: ` ${mode.label}` });

			if (mode.id === "inbox" && inboxCount > 0) {
				btn.createSpan({
					cls: "ai-daily-harness-badge",
					text: String(inboxCount),
				});
			}

			if (this.selectedModeId === mode.id) {
				btn.addClass("ai-daily-harness-mode-active");
			}

			btn.addEventListener("click", () => {
				this.selectedModeId = this.selectedModeId === mode.id ? null : mode.id;
				this.persistModeSelection();
				this.refreshModeButtons(grid, modes);
				this.updateStartButton();
			});
		}
	}

	private refreshModeButtons(grid: HTMLElement, modes: HarnessMode[]): void {
		const buttons = grid.querySelectorAll(".ai-daily-harness-mode-btn");
		const allIds = modes.map((m) => m.id);
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

	private async getInboxCount(): Promise<number> {
		const file = this.app.vault.getAbstractFileByPath("KB/Inbox/ideas.md");
		if (!(file instanceof TFile)) return 0;
		const content = await this.app.vault.read(file);
		return this.countUnprocessedInbox(content);
	}

	private persistModeSelection(): void {
		if (this.selectedModeId) {
			localStorage.setItem("ai-daily-harness-mode", this.selectedModeId);
		} else {
			localStorage.removeItem("ai-daily-harness-mode");
		}
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

		const modes = this.projectIndex?.modes ?? [];
		const mode = modes.find((m) => m.id === this.selectedModeId);
		if (!mode) return;

		const injectedFiles = this.resolveFiles(mode.files);
		const context: HarnessContext = { mode, injectedFiles };
		await this.plugin.startChatWithContext(context);
	}

	private resolveFiles(filePaths: string[]): { path: string }[] {
		const results: { path: string }[] = [];
		for (const rawPath of filePaths) {
			const resolvedPath = this.resolveVariables(rawPath);
			results.push({ path: resolvedPath });
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

		const projectSection = this.containerDiv.querySelector(".ai-daily-harness-section");
		if (!projectSection) return;

		const picker = createDiv({ cls: "ai-daily-harness-picker" });
		projectSection.after(picker);

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
		await this.buildUI();
	}

	async onClose(): Promise<void> {
		this.containerDiv?.empty();
	}
}
