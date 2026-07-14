/**
 * Harness View — per-project mode system.
 *
 * Data sources:
 *
 * {harnessProjectsFolder}/_INDEX.md (frontmatter):
 *   active_project: string        — which project is active
 *   active_work_context: string   — replaces {active_work_context} in file paths
 *   Body: markdown table (项目 | 状态 | 来源 | 最近更新) for project picker
 *
 * {harnessProjectsFolder}/{active_project}/modes.md:
 *   Body contains a ```yaml modes fenced block with mode definitions:
 *     - id: string (required)     — unique identifier, matches ## heading
 *       label: string (required)  — button display text
 *       emoji: string             — defaults to "📋"
 *       files: string[]           — vault paths or [[wikilinks]] to inject, supports {active_project} / {active_work_context}
 *   Body also has ## {mode-id} sections — each is the system prompt for that mode
 *
 * Status summary:
 *   {harnessProjectsFolder}/{active_project}/PROGRESS.md — last "- [x]" and first "- [ ]" from bottom
 *   {harnessInboxFile} — count of "- [ ]" lines
 *
 * Both paths are configurable in plugin settings (defaults: KB/Projects, KB/Inbox/ideas.md).
 */

import { ItemView, WorkspaceLeaf, setIcon, TFile, type App } from "obsidian";
import type AIDailyChat from "./main";
import type { HarnessMode } from "./settings";

export const HARNESS_VIEW_TYPE = "ai-daily-harness";

export interface HarnessContext {
	mode: HarnessMode;
	injectedFiles: { path: string }[];
	workspace?: string;
}

export interface ProjectIndex {
	activeProject: string;
	activeWorkContext: string;
	projects: { name: string; status: string; updated: string }[];
	modes: HarnessMode[];
}

export function resolveFileEntries(
	filePaths: string[],
	app: App,
	resolveVars: (p: string) => string,
): { path: string }[] {
	const results: { path: string }[] = [];
	for (const rawPath of filePaths) {
		const resolved = resolveVars(rawPath);
		const wikiMatch = resolved.match(/^\[\[(.+?)(?:\|.*)?\]\]$/);
		if (wikiMatch) {
			const linked = app.metadataCache.getFirstLinkpathDest(wikiMatch[1], "");
			if (linked) {
				results.push({ path: linked.path });
			}
		} else {
			results.push({ path: resolved });
		}
	}
	return results;
}

export async function loadProjectIndex(
	vault: import("obsidian").Vault,
	metadataCache: import("obsidian").MetadataCache,
	projectsFolder: string,
): Promise<ProjectIndex | null> {
	const indexFile = vault.getAbstractFileByPath(`${projectsFolder}/_INDEX.md`);
	if (!(indexFile instanceof TFile)) return null;

	const indexContent = await vault.read(indexFile);
	const indexFm = metadataCache.getFileCache(indexFile)?.frontmatter ?? {};

	const activeProject = String(indexFm.active_project ?? "");
	const activeWorkContext = String(indexFm.active_work_context ?? "");

	let modes: HarnessMode[] = [];
	if (activeProject) {
		const modesPath = `${projectsFolder}/${activeProject}/modes.md`;
		const modesFile = vault.getAbstractFileByPath(modesPath);
		if (modesFile instanceof TFile) {
			const modesContent = await vault.read(modesFile);
			modes = parseModesFromContent(modesContent);
		}
	}

	const projects = parseProjectTable(indexContent);
	return { activeProject, activeWorkContext, projects, modes };
}

function parseProjectTable(content: string): { name: string; status: string; updated: string }[] {
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

export function parseModesFromContent(content: string): HarnessMode[] {
	const raw = parseModesYamlBlock(content);
	if (raw.length === 0) return [];
	const sections = parseModeSections(content);
	return raw
		.map((m) => {
			const id = String(m.id ?? "");
			const rawActions = Array.isArray(m.actions) ? m.actions : [];
			const actions = rawActions
				.filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
				.map((a) => ({
					label: String(a.label ?? ""),
					icon: a.icon ? String(a.icon) : undefined,
					prompt: String(a.prompt ?? ""),
				}))
				.filter((a) => a.label && a.prompt);
			return {
				id,
				label: String(m.label ?? ""),
				emoji: String(m.emoji ?? "📋"),
				files: Array.isArray(m.files) ? m.files.map(String) : [],
				systemPromptAppend: sections.get(id) ?? "",
				actions,
			};
		})
		.filter((m) => m.id && m.label);
}

function parseModesYamlBlock(content: string): Record<string, unknown>[] {
	const match = content.match(/```ya?ml\s+modes\s*\n([\s\S]*?)```/);
	if (!match) return [];
	const yaml = match[1];
	const modes: Record<string, unknown>[] = [];
	let current: Record<string, unknown> | null = null;
	let listKey: "files" | "actions" | null = null;
	let currentAction: Record<string, string> | null = null;
	for (const line of yaml.split("\n")) {
		if (line.match(/^- id:\s*/)) {
			if (currentAction && current) (current.actions as Record<string, string>[]).push(currentAction);
			currentAction = null;
			if (current) modes.push(current);
			current = { id: line.replace(/^- id:\s*/, "").trim() };
			listKey = null;
		} else if (current && line.match(/^\s+label:\s*/) && listKey !== "actions") {
			current.label = line.replace(/^\s+label:\s*/, "").trim();
			listKey = null;
		} else if (current && line.match(/^\s+emoji:\s*/)) {
			current.emoji = line.replace(/^\s+emoji:\s*/, "").trim().replace(/^["']|["']$/g, "");
			listKey = null;
		} else if (current && line.match(/^\s+files:\s*$/)) {
			current.files = [];
			listKey = "files";
		} else if (current && line.match(/^\s+files:\s*\[\s*\]\s*$/)) {
			current.files = [];
			listKey = null;
		} else if (current && line.match(/^\s+actions:\s*$/)) {
			current.actions = [];
			listKey = "actions";
			currentAction = null;
		} else if (listKey === "files" && current && line.match(/^\s+-\s+/)) {
			(current.files as string[]).push(line.replace(/^\s+-\s+/, "").trim());
		} else if (listKey === "actions" && current && line.match(/^\s+-\s+label:\s*/)) {
			if (currentAction) (current.actions as Record<string, string>[]).push(currentAction);
			currentAction = { label: line.replace(/^\s+-\s+label:\s*/, "").trim() };
		} else if (listKey === "actions" && currentAction && line.match(/^\s+icon:\s*/)) {
			currentAction.icon = line.replace(/^\s+icon:\s*/, "").trim();
		} else if (listKey === "actions" && currentAction && line.match(/^\s+prompt:\s*/)) {
			currentAction.prompt = line.replace(/^\s+prompt:\s*/, "").trim().replace(/^["']|["']$/g, "");
		} else {
			if (listKey !== "actions") listKey = null;
		}
	}
	if (currentAction && current) (current.actions as Record<string, string>[]).push(currentAction);
	if (current) modes.push(current);
	return modes;
}

function parseModeSections(content: string): Map<string, string> {
	const sections = new Map<string, string>();
	const lines = content.split("\n");
	let currentId = "";
	let currentLines: string[] = [];
	const fmEnd = content.match(/^---\n[\s\S]*?\n---\n/);
	const startLine = fmEnd ? fmEnd[0].split("\n").length - 1 : 0;
	for (let i = startLine; i < lines.length; i++) {
		const match = lines[i].match(/^## (.+)$/);
		if (match) {
			if (currentId) sections.set(currentId, currentLines.join("\n").trim());
			currentId = match[1].trim();
			currentLines = [];
		} else if (currentId) {
			currentLines.push(lines[i]);
		}
	}
	if (currentId) sections.set(currentId, currentLines.join("\n").trim());
	return sections;
}

export class HarnessView extends ItemView {
	plugin: AIDailyChat;
	private containerDiv!: HTMLElement;
	private selectedModeId: string | null = null;
	private projectIndex: ProjectIndex | null = null;
	private statusEl: HTMLElement | null = null;
	private startBtn: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AIDailyChat) {
		super(leaf);
		this.plugin = plugin;
	}

	private get projectsFolder(): string {
		return this.plugin.settings.harnessProjectsFolder;
	}

	private get inboxFile(): string {
		return this.plugin.settings.harnessInboxFile;
	}

	getViewType(): string {
		return HARNESS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Harness";
	}

	getIcon(): string {
		return "sliders-horizontal";
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
		this.projectIndex = await loadProjectIndex(
			this.app.vault,
			this.app.metadataCache,
			this.projectsFolder,
		);
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
		section.createDiv({ cls: "ai-daily-harness-section-label", text: "项目" });

		const projects = this.projectIndex?.projects ?? [];
		if (projects.length === 0) {
			section.createDiv({ cls: "ai-daily-harness-muted", text: "无项目" });
			return;
		}

		const gallery = section.createDiv({ cls: "ai-daily-harness-project-gallery" });
		for (const project of projects) {
			const isActive = project.name === this.projectIndex?.activeProject;
			const card = gallery.createDiv({ cls: "ai-daily-harness-project-card" });
			if (isActive) card.addClass("ai-daily-harness-project-card-active");

			const dot = card.createSpan({ cls: "ai-daily-harness-picker-dot" });
			dot.style.background =
				project.status === "active"
					? "var(--interactive-accent)"
					: "var(--text-muted)";
			card.createSpan({ cls: "ai-daily-harness-project-card-name", text: project.name });

			card.addEventListener("click", async () => {
				await this.switchProject(project.name);
			});
		}
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

		const progressPath = `${this.projectsFolder}/${this.projectIndex.activeProject}/PROGRESS.md`;
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

		const inboxAbstractFile = this.app.vault.getAbstractFileByPath(this.inboxFile);
		if (inboxAbstractFile instanceof TFile) {
			const content = await this.app.vault.read(inboxAbstractFile);
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
		const file = this.app.vault.getAbstractFileByPath(this.inboxFile);
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

		await this.loadProjectIndex();

		const modes = this.projectIndex?.modes ?? [];
		const mode = modes.find((m) => m.id === this.selectedModeId);
		if (!mode) return;

		const injectedFiles = this.resolveFiles(mode.files);
		const context: HarnessContext = {
			mode,
			injectedFiles,
			workspace: this.projectIndex?.activeProject || undefined,
		};
		await this.plugin.startChatWithContext(context);
	}

	private resolveFiles(filePaths: string[]): { path: string }[] {
		return resolveFileEntries(filePaths, this.app, (p) => this.resolveVariables(p));
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


	private async switchProject(projectName: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(`${this.projectsFolder}/_INDEX.md`);
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
