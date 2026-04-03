import { App, PluginSettingTab, Setting } from "obsidian";
import type AIDailyChat from "./main";

export interface AIDailyChatSettings {
	apiKey: string;
	dailyFolder: string;
	contextDays: number;
	model: string;
}

export const DEFAULT_SETTINGS: AIDailyChatSettings = {
	apiKey: "",
	dailyFolder: "AI-Daily",
	contextDays: 7,
	model: "claude-haiku-4-5",
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
	}
}
