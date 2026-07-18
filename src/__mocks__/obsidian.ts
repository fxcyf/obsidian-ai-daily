export function requestUrl(): never {
	throw new Error("requestUrl is not available in test environment");
}

export function normalizePath(p: string): string {
	return p;
}

export function setIcon(): void {}

export class TFile {
	path = "";
	basename = "";
	extension = "";
}

export class TFolder {
	path = "";
	children: unknown[] = [];
}

export class Vault {}

export class App {
	vault = new Vault();
}

export class Notice {
	constructor(_message: string, _timeout?: number) {}
}

export class Plugin {}
export class Modal {}
export class FuzzySuggestModal {}
export class ItemView {}
export class WorkspaceLeaf {}
export class PluginSettingTab {}
export class Setting {}

export const Platform = { isMobile: false, isDesktop: true, isDesktopApp: true };
