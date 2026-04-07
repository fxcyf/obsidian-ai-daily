import { Plugin } from "obsidian";
import {
	AIDailyChatSettings,
	DEFAULT_SETTINGS,
	AIDailyChatSettingTab,
} from "./settings";
import { ChatView, VIEW_TYPE } from "./chat-view";

export default class AIDailyChat extends Plugin {
	settings: AIDailyChatSettings = DEFAULT_SETTINGS;

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

		// Settings tab
		this.addSettingTab(new AIDailyChatSettingTab(this.app, this));
	}

	async chatAboutCurrentNote(): Promise<void> {
		await this.activateView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (leaf) {
			const view = leaf.view as ChatView;
			view.sendMessage("请总结这篇笔记的要点，并指出最值得深入了解的部分。");
		}
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	onunload(): void {
		// Views are cleaned up automatically
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
