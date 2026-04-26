export function requestUrl(): never {
	throw new Error("requestUrl is not available in test environment");
}

export function normalizePath(p: string): string {
	return p;
}

export class TFile {}
export class TFolder {}
export class Vault {}
export const Platform = { isMobile: false };
