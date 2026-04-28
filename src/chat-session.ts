import { Vault, normalizePath } from "obsidian";

export const DEFAULT_CHAT_FOLDER = ".ai-chat";
const PRUNE_THROTTLE_KEY = "ai-daily-last-prune";

export interface PersistedMessage {
	role: "user" | "assistant";
	content: string;
}

export interface ChatSessionFile {
	id: string;
	title: string;
	model: string;
	created: string;
	updated: string;
	messages: PersistedMessage[];
	claudeCodeSessionId?: string;
}

export function newSessionId(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	return `${date}_${time}`;
}

export function titleFromMessages(messages: PersistedMessage[]): string {
	const first = messages.find((m) => m.role === "user");
	const t = (first?.content ?? "新对话").trim().replace(/\s+/g, " ");
	if (t.length <= 30) return t || "新对话";
	return t.slice(0, 30) + "…";
}

export function isValidChatSession(data: unknown): data is ChatSessionFile {
	if (typeof data !== "object" || data === null) return false;
	const obj = data as Record<string, unknown>;
	return (
		typeof obj.id === "string" &&
		typeof obj.title === "string" &&
		typeof obj.model === "string" &&
		typeof obj.created === "string" &&
		typeof obj.updated === "string" &&
		Array.isArray(obj.messages) &&
		obj.messages.every(
			(m: unknown) =>
				typeof m === "object" &&
				m !== null &&
				typeof (m as Record<string, unknown>).role === "string" &&
				typeof (m as Record<string, unknown>).content === "string"
		)
	);
}

async function ensureFolderAdapter(vault: Vault, folderPath: string): Promise<void> {
	const p = normalizePath(folderPath);
	const segments = p.split("/").filter(Boolean);
	let acc = "";
	for (const seg of segments) {
		acc = acc ? `${acc}/${seg}` : seg;
		const exists = await vault.adapter.exists(acc);
		if (!exists) {
			await vault.adapter.mkdir(acc);
		}
	}
}

export async function saveChatSession(
	vault: Vault,
	folderPath: string,
	session: ChatSessionFile
): Promise<void> {
	await ensureFolderAdapter(vault, folderPath);
	const path = normalizePath(`${folderPath}/${session.id}.md`);
	await vault.adapter.write(path, JSON.stringify(session, null, 2));
	// remove legacy .json file if it exists
	const legacy = normalizePath(`${folderPath}/${session.id}.json`);
	try {
		if (await vault.adapter.exists(legacy)) await vault.adapter.remove(legacy);
	} catch { /* ignore */ }
}

export async function loadChatSession(
	vault: Vault,
	folderPath: string,
	id: string
): Promise<ChatSessionFile | null> {
	const path = normalizePath(`${folderPath}/${id}.md`);
	const legacyPath = normalizePath(`${folderPath}/${id}.json`);
	try {
		let raw: string;
		if (await vault.adapter.exists(path)) {
			raw = await vault.adapter.read(path);
		} else if (await vault.adapter.exists(legacyPath)) {
			raw = await vault.adapter.read(legacyPath);
		} else {
			return null;
		}
		const parsed: unknown = JSON.parse(raw);
		if (!isValidChatSession(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function listChatSessions(
	vault: Vault,
	folderPath: string
): Promise<ChatSessionFile[]> {
	const p = normalizePath(folderPath);
	try {
		if (!(await vault.adapter.exists(p))) return [];
		const listed = await vault.adapter.list(p);
		const out: ChatSessionFile[] = [];
		const seen = new Set<string>();
		for (const filePath of listed.files) {
			if (!filePath.endsWith(".md") && !filePath.endsWith(".json")) continue;
			try {
				const raw = await vault.adapter.read(filePath);
				const parsed: unknown = JSON.parse(raw);
				if (isValidChatSession(parsed) && !seen.has(parsed.id)) {
					seen.add(parsed.id);
					out.push(parsed);
				}
			} catch {
				/* skip corrupt */
			}
		}
		out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
		return out;
	} catch {
		return [];
	}
}

export async function deleteChatSessionFile(
	vault: Vault,
	folderPath: string,
	id: string
): Promise<void> {
	const path = normalizePath(`${folderPath}/${id}.md`);
	const legacy = normalizePath(`${folderPath}/${id}.json`);
	try {
		if (await vault.adapter.exists(path)) await vault.adapter.remove(path);
		if (await vault.adapter.exists(legacy)) await vault.adapter.remove(legacy);
	} catch {
		/* ignore */
	}
}

export function shouldPruneToday(): boolean {
	try {
		const last = localStorage.getItem(PRUNE_THROTTLE_KEY);
		const today = new Date().toISOString().slice(0, 10);
		if (last === today) return false;
		localStorage.setItem(PRUNE_THROTTLE_KEY, today);
		return true;
	} catch {
		return true;
	}
}

export async function pruneOldSessions(
	vault: Vault,
	folderPath: string,
	retentionDays: number
): Promise<number> {
	if (retentionDays <= 0) return 0;
	if (!shouldPruneToday()) return 0;
	const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
	const sessions = await listChatSessions(vault, folderPath);
	let removed = 0;
	for (const s of sessions) {
		const t = Date.parse(s.updated);
		if (!Number.isNaN(t) && t < cutoff) {
			await deleteChatSessionFile(vault, folderPath, s.id);
			removed++;
		}
	}
	return removed;
}
