import { App, PluginSettingTab, Setting } from "obsidian";
import type AIDailyChat from "./main";
import { DEFAULT_FEEDS, type FeedSource } from "./feeds";
import type { StreamMode } from "./claude";

export interface AIDailyChatSettings {
	apiKey: string;
	dailyFolder: string;
	knowledgeFolders: string[];
	contextDays: number;
	model: string;
	/** Vault folder for persisted chats (hidden folder recommended). */
	chatHistoryFolder: string;
	/** Delete chat JSON files not updated within this many days (0 = never auto-delete). */
	chatHistoryRetentionDays: number;
	/**
	 * Streaming 调度模式：
	 *   auto       (默认) 真流→打字机自动降级，桌面享流式、移动端兜底
	 *   real       仅真流，失败直接报错（调试用）
	 *   typewriter requestUrl 整段返回 + 客户端切片回放
	 *   off        一次性返回，无动画
	 */
	chatStreamMode: StreamMode;
	/** Estimated token threshold to trigger automatic history summarization (0 = off). */
	chatCompressThresholdEst: number;
	/** Displayed context budget for the token bar (informational). */
	chatContextBudgetTokens: number;
	/** Enable web search and web fetch tools for internet access. */
	enableWebSearch: boolean;
	// Feed settings
	feedFolder: string;
	feedTopics: string[];
	feedSources: FeedSource[];
	feedMaxArticles: number;
}

export const DEFAULT_SETTINGS: AIDailyChatSettings = {
	apiKey: "",
	dailyFolder: "AI-Daily",
	knowledgeFolders: ["Raw", "Wiki"],
	contextDays: 7,
	model: "claude-haiku-4-5",
	chatHistoryFolder: ".ai-chat",
	chatHistoryRetentionDays: 30,
	chatStreamMode: "auto",
	chatCompressThresholdEst: 90_000,
	chatContextBudgetTokens: 200_000,
	enableWebSearch: true,
	feedFolder: "Feed",
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
			.addText((text) =>
				text
					.setPlaceholder("sk-ant-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("日报文件夹")
			.setDesc("AI Daily 日报所在的 vault 子目录")
			.addText((text) =>
				text
					.setPlaceholder("AI-Daily")
					.setValue(this.plugin.settings.dailyFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyFolder = value;
						await this.plugin.saveSettings();
					})
			);

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
			.setName("上下文天数")
			.setDesc("自动加载最近几天的日报作为对话上下文")
			.addSlider((slider) =>
				slider
					.setLimits(1, 30, 1)
					.setValue(this.plugin.settings.contextDays)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.contextDays = value;
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

		const rssSetting = new Setting(containerEl)
			.setName("订阅源")
			.setDesc(
				`当前 ${this.plugin.settings.feedSources.length} 个源。` +
				"编辑格式: 名称|URL|分类|类型，每行一个。类型可选: rss(默认), hn, reddit, github-trending"
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("ArXiv CS.AI|https://rss.arxiv.org/rss/cs.AI|research|rss")
					.setValue(
						this.plugin.settings.feedSources
							.map((s) => {
								const type = s.type && s.type !== "rss" ? `|${s.type}` : "";
								return `${s.name}|${s.url}|${s.category}${type}`;
							})
							.join("\n")
					)
					.onChange(async (value) => {
						const sources: FeedSource[] = value
							.split("\n")
							.map((line) => line.trim())
							.filter(Boolean)
							.map((line) => {
								const parts = line.split("|").map((s) => s.trim());
								const [name, url, category] = parts;
								const type = (parts[3] as FeedSource["type"]) || "rss";
								return {
									name: name || "",
									url: url || "",
									category: category || "other",
									...(type !== "rss" ? { type } : {}),
								};
							})
							.filter((s) => s.name && s.url);
						this.plugin.settings.feedSources = sources;
						await this.plugin.saveSettings();
					})
			);
		rssSetting.settingEl.addClass("ai-daily-setting-full");
		const rssTextarea = rssSetting.settingEl.querySelector("textarea");
		if (rssTextarea) {
			rssTextarea.rows = 12;
		}
	}
}
