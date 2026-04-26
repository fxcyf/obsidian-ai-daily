import { App, PluginSettingTab, Setting } from "obsidian";
import type AIDailyChat from "./main";
import { DEFAULT_FEEDS, type FeedSource } from "./feeds";
import type { StreamMode } from "./claude";

export interface PromptTemplate {
	name: string;
	prompt: string;
	builtin?: boolean;
}

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
	{ name: "总结要点", prompt: "总结这篇文章的要点", builtin: true },
	{ name: "生成 Wiki 条目", prompt: "提取关键概念，生成 Wiki 条目", builtin: true },
	{ name: "翻译为中文", prompt: "翻译为中文", builtin: true },
	{ name: "翻译为英文", prompt: "翻译为英文", builtin: true },
	{ name: "生成闪卡", prompt: "根据这篇笔记生成复习闪卡", builtin: true },
	{ name: "查找相关笔记", prompt: "找出知识库中与当前笔记相关的内容", builtin: true },
];

export interface AIDailyChatSettings {
	apiKey: string;
	knowledgeFolders: string[];
	model: string;
	chatHistoryFolder: string;
	chatHistoryRetentionDays: number;
	chatStreamMode: StreamMode;
	chatCompressThresholdEst: number;
	chatContextBudgetTokens: number;
	enableWebSearch: boolean;
	promptTemplates: PromptTemplate[];
	// Feed settings
	feedFolder: string;
	feedModel: string;
	feedTopics: string[];
	feedSources: FeedSource[];
	feedMaxArticles: number;
}

export const DEFAULT_SETTINGS: AIDailyChatSettings = {
	apiKey: "",
	knowledgeFolders: ["Raw", "Wiki"],
	model: "claude-haiku-4-5",
	chatHistoryFolder: ".ai-chat",
	chatHistoryRetentionDays: 30,
	chatStreamMode: "auto",
	chatCompressThresholdEst: 90_000,
	chatContextBudgetTokens: 200_000,
	enableWebSearch: true,
	promptTemplates: DEFAULT_PROMPT_TEMPLATES,
	feedFolder: "Feed",
	feedModel: "",
	feedTopics: [],
	feedSources: DEFAULT_FEEDS,
	feedMaxArticles: 20,
};

export class AIDailyChatSettingTab extends PluginSettingTab {
	plugin: AIDailyChat;

	constructor(app: App, plugin: AIDailyChat) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Anthropic API Key")
			.setDesc("用于调用 Claude API")
			.addText((text) => {
				text
					.setPlaceholder("sk-ant-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
			});

		new Setting(containerEl)
			.setName("知识库文件夹")
			.setDesc("用逗号分隔多个文件夹路径，如 Raw,Wiki")
			.addText((text) =>
				text
					.setPlaceholder("Raw,Wiki")
					.setValue(this.plugin.settings.knowledgeFolders.join(","))
					.onChange(async (value) => {
						this.plugin.settings.knowledgeFolders = value
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("模型")
			.setDesc("Claude 模型")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("claude-haiku-4-5", "Haiku 4.5 (快速/便宜)")
					.addOption("claude-sonnet-4-6", "Sonnet 4.6 (均衡)")
					.addOption("claude-opus-4-6", "Opus 4.6 (最强)")
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "对话与历史" });

		new Setting(containerEl)
			.setName("对话存档目录")
			.setDesc("会话 JSON 保存在该文件夹（可与笔记一并同步）")
			.addText((text) =>
				text
					.setPlaceholder(".ai-chat")
					.setValue(this.plugin.settings.chatHistoryFolder)
					.onChange(async (value) => {
						this.plugin.settings.chatHistoryFolder = value.trim() || ".ai-chat";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("历史保留天数")
			.setDesc("超过该天数未更新的会话文件会被自动删除；0 表示不自动清理")
			.addSlider((slider) =>
				slider
					.setLimits(0, 365, 1)
					.setValue(this.plugin.settings.chatHistoryRetentionDays)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.chatHistoryRetentionDays = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("流式输出模式")
			.setDesc(
				"auto: 桌面用真流(fetch+SSE)，失败时移动端自动降级为打字机。real: 仅真流(调试用)。typewriter: 整段返回+客户端打字机。off: 一次性整段。"
			)
			.addDropdown((dd) =>
				dd
					.addOption("auto", "Auto（推荐）")
					.addOption("real", "Real（仅真流，调试）")
					.addOption("typewriter", "Typewriter（伪流，最兼容）")
					.addOption("off", "Off（无动画）")
					.setValue(this.plugin.settings.chatStreamMode)
					.onChange(async (value) => {
						this.plugin.settings.chatStreamMode =
							value as typeof this.plugin.settings.chatStreamMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("联网搜索")
			.setDesc(
				"启用后 Claude 可以搜索互联网并抓取网页内容（使用 Anthropic 内置 web_search + web_fetch 工具）"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableWebSearch)
					.onChange(async (value) => {
						this.plugin.settings.enableWebSearch = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("自动摘要阈值（估算 tokens）")
			.setDesc(
				"当估算上下文超过该值时，自动用一次 API 调用压缩更早的对话；0 关闭"
			)
			.addText((text) =>
				text
					.setPlaceholder("90000")
					.setValue(String(this.plugin.settings.chatCompressThresholdEst))
					.onChange(async (value) => {
						const n = parseInt(value.replace(/\s/g, ""), 10);
						this.plugin.settings.chatCompressThresholdEst = Number.isFinite(n)
							? Math.max(0, n)
							: 90_000;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("上下文预算（展示用）")
			.setDesc("底部用量条的总参考值，与模型实际上下文窗口大致对应")
			.addText((text) =>
				text
					.setPlaceholder("200000")
					.setValue(String(this.plugin.settings.chatContextBudgetTokens))
					.onChange(async (value) => {
						const n = parseInt(value.replace(/\s/g, ""), 10);
						this.plugin.settings.chatContextBudgetTokens = Number.isFinite(n)
							? Math.max(1000, n)
							: 200_000;
						await this.plugin.saveSettings();
					})
			);

		// ── Prompt templates ───────────────────────────────────

		containerEl.createEl("h3", { text: "Prompt 模板" });

		this.renderPromptTemplates(containerEl);

		// ── Feed settings ──────────────────────────────────────

		containerEl.createEl("h3", { text: "Feed 设置" });

		new Setting(containerEl)
			.setName("Feed 文件夹")
			.setDesc("生成的 Feed 笔记存放位置")
			.addText((text) =>
				text
					.setPlaceholder("Feed")
					.setValue(this.plugin.settings.feedFolder)
					.onChange(async (value) => {
						this.plugin.settings.feedFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Feed 模型")
			.setDesc("用于生成 Feed 的模型，留空则使用对话模型")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("", "与对话模型相同")
					.addOption("claude-haiku-4-5", "Haiku 4.5 (快速/便宜)")
					.addOption("claude-sonnet-4-6", "Sonnet 4.6 (均衡)")
					.addOption("claude-opus-4-6", "Opus 4.6 (最强)")
					.setValue(this.plugin.settings.feedModel)
					.onChange(async (value) => {
						this.plugin.settings.feedModel = value;
						await this.plugin.saveSettings();
					})
			);

		const topicsSetting = new Setting(containerEl)
			.setName("关注主题")
			.setDesc("用逗号分隔，如: RAG,Agent,多模态")
			.addTextArea((text) =>
				text
					.setPlaceholder("RAG,Agent,LLM,多模态")
					.setValue(this.plugin.settings.feedTopics.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.feedTopics = value
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					})
			);
		topicsSetting.settingEl.addClass("ai-daily-setting-full");
		const topicsTextarea = topicsSetting.settingEl.querySelector("textarea");
		if (topicsTextarea) {
			topicsTextarea.rows = 2;
		}

		new Setting(containerEl)
			.setName("最大文章数")
			.setDesc("每次 Feed 抓取的最大文章数量")
			.addSlider((slider) =>
				slider
					.setLimits(5, 50, 5)
					.setValue(this.plugin.settings.feedMaxArticles)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.feedMaxArticles = value;
						await this.plugin.saveSettings();
					})
			);

		this.renderFeedSourceList(containerEl);
	}

	private renderPromptTemplates(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: "ai-daily-prompt-templates" });

		const desc = new Setting(wrapper)
			.setName("在输入框中键入 / 可快速选择模板")
			.addButton((btn) =>
				btn.setButtonText("添加模板").setCta().onClick(async () => {
					this.plugin.settings.promptTemplates.push({
						name: "",
						prompt: "",
					});
					await this.plugin.saveSettings();
					this.display();
				})
			);
		desc.settingEl.addClass("ai-daily-setting-desc-only");

		for (let i = 0; i < this.plugin.settings.promptTemplates.length; i++) {
			const tpl = this.plugin.settings.promptTemplates[i];
			const s = new Setting(wrapper)
				.setName(tpl.name || "(未命名)")
				.setDesc(tpl.prompt.slice(0, 60) + (tpl.prompt.length > 60 ? "…" : ""));

			s.addButton((btn) =>
				btn
					.setIcon("pencil")
					.setTooltip("编辑")
					.onClick(() => {
						this.openTemplateEditor(wrapper, i);
					})
			);

			if (!tpl.builtin) {
				s.addButton((btn) =>
					btn
						.setIcon("trash-2")
						.setTooltip("删除")
						.onClick(async () => {
							this.plugin.settings.promptTemplates.splice(i, 1);
							await this.plugin.saveSettings();
							this.display();
						})
				);
			}
		}
	}

	private openTemplateEditor(wrapper: HTMLElement, index: number): void {
		const tpl = this.plugin.settings.promptTemplates[index];
		if (!tpl) return;

		wrapper
			.querySelectorAll(".ai-daily-template-editor")
			.forEach((el) => el.remove());

		const editor = wrapper.createDiv({ cls: "ai-daily-template-editor ai-daily-feed-source-editor" });

		const nameField = editor.createDiv({ cls: "ai-daily-feed-editor-field" });
		nameField.createEl("label", { text: "名称" });
		const nameInput = nameField.createEl("input", {
			type: "text",
			placeholder: "模板名称",
			value: tpl.name,
		});

		const promptField = editor.createDiv({ cls: "ai-daily-feed-editor-field" });
		promptField.createEl("label", { text: "Prompt" });
		const promptInput = promptField.createEl("textarea", {
			placeholder: "输入 prompt 内容…",
		});
		promptInput.value = tpl.prompt;
		promptInput.rows = 3;
		promptInput.style.width = "100%";
		promptInput.style.resize = "vertical";

		const btnRow = editor.createDiv({ cls: "ai-daily-feed-editor-btns" });
		const saveBtn = btnRow.createEl("button", { text: "保存", cls: "mod-cta" });
		const cancelBtn = btnRow.createEl("button", { text: "取消" });

		saveBtn.addEventListener("click", async () => {
			const name = nameInput.value.trim();
			const prompt = promptInput.value.trim();
			if (!name || !prompt) {
				saveBtn.textContent = "请填写名称和内容";
				setTimeout(() => { saveBtn.textContent = "保存"; }, 1500);
				return;
			}
			tpl.name = name;
			tpl.prompt = prompt;
			await this.plugin.saveSettings();
			this.display();
		});

		cancelBtn.addEventListener("click", () => {
			if (!tpl.name && !tpl.prompt) {
				this.plugin.settings.promptTemplates.splice(index, 1);
			}
			this.display();
		});
	}

	private renderFeedSourceList(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: "ai-daily-feed-sources" });

		const header = new Setting(wrapper)
			.setName(`订阅源 (${this.plugin.settings.feedSources.length})`)
			.setDesc("管理 RSS、Hacker News、Reddit、GitHub Trending 等内容源")
			.addButton((btn) =>
				btn.setButtonText("添加").setCta().onClick(() => {
					this.plugin.settings.feedSources.push({
						name: "",
						url: "",
						category: "community",
					});
					this.refreshSourceList(wrapper, header.settingEl);
				})
			);

		this.refreshSourceList(wrapper, header.settingEl);
	}

	private refreshSourceList(wrapper: HTMLElement, headerEl: HTMLElement): void {
		wrapper.querySelectorAll(".ai-daily-feed-source-item").forEach((el) => el.remove());

		const sources = this.plugin.settings.feedSources;

		const headerSetting = headerEl.querySelector(".setting-item-name");
		if (headerSetting) {
			headerSetting.textContent = `订阅源 (${sources.length})`;
		}

		const TYPE_LABELS: Record<string, string> = {
			rss: "RSS",
			hn: "HN",
			reddit: "Reddit",
			"github-trending": "GitHub",
		};

		const CAT_LABELS: Record<string, string> = {
			research: "研究",
			community: "社区",
			tools: "工具",
			newsletter: "周刊",
			industry: "行业",
			news: "新闻",
			other: "其他",
		};

		for (let i = 0; i < sources.length; i++) {
			const source = sources[i];
			const row = wrapper.createDiv({ cls: "ai-daily-feed-source-item" });

			const info = row.createDiv({ cls: "ai-daily-feed-source-info" });
			const nameEl = info.createDiv({ cls: "ai-daily-feed-source-name" });
			nameEl.textContent = source.name || "(未命名)";

			const badges = info.createDiv({ cls: "ai-daily-feed-source-badges" });
			const typeBadge = badges.createEl("span", {
				cls: `ai-daily-feed-badge ai-daily-feed-badge-type`,
				text: TYPE_LABELS[source.type ?? "rss"] ?? "RSS",
			});
			typeBadge.dataset.type = source.type ?? "rss";
			badges.createEl("span", {
				cls: "ai-daily-feed-badge ai-daily-feed-badge-cat",
				text: CAT_LABELS[source.category] ?? source.category,
			});

			const urlEl = info.createDiv({ cls: "ai-daily-feed-source-url" });
			urlEl.textContent = source.url || "—";

			const actions = row.createDiv({ cls: "ai-daily-feed-source-actions" });

			const editBtn = actions.createEl("button", {
				cls: "ai-daily-feed-source-btn",
				attr: { "aria-label": "编辑" },
			});
			editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
			editBtn.addEventListener("click", () => {
				this.openSourceEditor(i, wrapper, headerEl);
			});

			const delBtn = actions.createEl("button", {
				cls: "ai-daily-feed-source-btn ai-daily-feed-source-btn-del",
				attr: { "aria-label": "删除" },
			});
			delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
			delBtn.addEventListener("click", async () => {
				sources.splice(i, 1);
				await this.plugin.saveSettings();
				this.refreshSourceList(wrapper, headerEl);
			});

			// Auto-open editor for newly added empty sources
			if (!source.name && !source.url) {
				setTimeout(() => this.openSourceEditor(i, wrapper, headerEl), 50);
			}
		}
	}

	private openSourceEditor(index: number, wrapper: HTMLElement, headerEl: HTMLElement): void {
		const source = this.plugin.settings.feedSources[index];
		if (!source) return;

		const items = wrapper.querySelectorAll(".ai-daily-feed-source-item");
		const row = items[index];
		if (!row) return;

		// Remove any existing editor
		wrapper.querySelectorAll(".ai-daily-feed-source-editor").forEach((el) => el.remove());

		const editor = document.createElement("div");
		editor.className = "ai-daily-feed-source-editor";
		row.after(editor);

		const fields = [
			{ label: "名称", key: "name" as const, placeholder: "ArXiv CS.AI" },
			{ label: "URL", key: "url" as const, placeholder: "https://rss.arxiv.org/rss/cs.AI" },
		];

		for (const field of fields) {
			const fieldRow = editor.createDiv({ cls: "ai-daily-feed-editor-field" });
			fieldRow.createEl("label", { text: field.label });
			const input = fieldRow.createEl("input", {
				type: "text",
				placeholder: field.placeholder,
				value: (source as Record<string, string>)[field.key] ?? "",
			});
			input.addEventListener("input", () => {
				(source as Record<string, string>)[field.key] = input.value.trim();
			});
		}

		const selectRow = editor.createDiv({ cls: "ai-daily-feed-editor-selects" });

		const catGroup = selectRow.createDiv({ cls: "ai-daily-feed-editor-field" });
		catGroup.createEl("label", { text: "分类" });
		const catSelect = catGroup.createEl("select");
		for (const [val, label] of [
			["research", "研究"], ["community", "社区"], ["tools", "工具"],
			["newsletter", "周刊"], ["industry", "行业"], ["news", "新闻"],
		]) {
			const opt = catSelect.createEl("option", { value: val, text: label });
			if (source.category === val) opt.selected = true;
		}
		catSelect.addEventListener("change", () => {
			source.category = catSelect.value;
		});

		const typeGroup = selectRow.createDiv({ cls: "ai-daily-feed-editor-field" });
		typeGroup.createEl("label", { text: "类型" });
		const typeSelect = typeGroup.createEl("select");
		for (const [val, label] of [
			["rss", "RSS"], ["hn", "Hacker News"], ["reddit", "Reddit"],
			["github-trending", "GitHub Trending"],
		]) {
			const opt = typeSelect.createEl("option", { value: val, text: label });
			if ((source.type ?? "rss") === val) opt.selected = true;
		}
		typeSelect.addEventListener("change", () => {
			if (typeSelect.value === "rss") {
				delete source.type;
			} else {
				source.type = typeSelect.value as FeedSource["type"];
			}
		});

		const btnRow = editor.createDiv({ cls: "ai-daily-feed-editor-btns" });
		const saveBtn = btnRow.createEl("button", { text: "保存", cls: "mod-cta" });
		const cancelBtn = btnRow.createEl("button", { text: "取消" });

		saveBtn.addEventListener("click", async () => {
			if (!source.name || !source.url) {
				saveBtn.textContent = "请填写名称和 URL";
				setTimeout(() => { saveBtn.textContent = "保存"; }, 1500);
				return;
			}
			await this.plugin.saveSettings();
			editor.remove();
			this.refreshSourceList(wrapper, headerEl);
		});

		cancelBtn.addEventListener("click", () => {
			if (!source.name && !source.url) {
				this.plugin.settings.feedSources.splice(index, 1);
			}
			editor.remove();
			this.refreshSourceList(wrapper, headerEl);
		});
	}
}
