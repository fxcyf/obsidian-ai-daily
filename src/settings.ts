import { App, PluginSettingTab, Setting } from "obsidian";
import type AIDailyChat from "./main";
import { DEFAULT_FEEDS, type FeedSource } from "./feeds";

export interface AIDailyChatSettings {
	apiKey: string;
	dailyFolder: string;
	knowledgeFolders: string[];
	contextDays: number;
	model: string;
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
			.setName("关注主题")
			.setDesc("用逗号分隔，如: RAG,Agent,多模态")
			.addText((text) =>
				text
					.setPlaceholder("RAG,Agent,LLM")
					.setValue(this.plugin.settings.feedTopics.join(","))
					.onChange(async (value) => {
						this.plugin.settings.feedTopics = value
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

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

		new Setting(containerEl)
			.setName("RSS 订阅源")
			.setDesc(
				`当前 ${this.plugin.settings.feedSources.length} 个源。` +
				"编辑格式: 名称|URL|分类，每行一个"
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("ArXiv CS.AI|https://rss.arxiv.org/rss/cs.AI|research")
					.setValue(
						this.plugin.settings.feedSources
							.map((s) => `${s.name}|${s.url}|${s.category}`)
							.join("\n")
					)
					.onChange(async (value) => {
						const sources: FeedSource[] = value
							.split("\n")
							.map((line) => line.trim())
							.filter(Boolean)
							.map((line) => {
								const [name, url, category] = line.split("|").map((s) => s.trim());
								return { name: name || "", url: url || "", category: category || "other" };
							})
							.filter((s) => s.name && s.url);
						this.plugin.settings.feedSources = sources;
						await this.plugin.saveSettings();
					})
			);
	}
}
