/**
 * Persisted chat session (stored under `.ai-chat/` in the vault).
 */

import { TFile, Vault, normalizePath } from "obsidian";

export const DEFAULT_CHAT_FOLDER = ".ai-chat";

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

export async function ensureChatFolder(
	vault: Vault,
	folderPath: string
): Promise<void> {
	const p = normalizePath(folderPath);
	if (vault.getFolderByPath(p)) return;

	const stat = await vault.adapter.stat(p);
	if (stat?.type === "folder") return;
	if (stat?.type === "file") {
		throw new Error(
			`无法存档：路径「${p}」已存在且为文件，请更换设置中的「对话存档目录」或移除该文件`
		);
	}

	try {
		await vault.createFolder(p);
	} catch (e) {
		// TOCTOU: folder appeared between stat() and create (sync / other pane / OS).
		const after = await vault.adapter.stat(p);
		if (after?.type === "folder") return;
		throw e;
	}
}

export async function saveChatSession(
	vault: Vault,
	folderPath: string,
	session: ChatSessionFile
): Promise<void> {
	await ensureChatFolder(vault, folderPath);
	const path = normalizePath(`${folderPath}/${session.id}.json`);
	const data = JSON.stringify(session, null, 2);
	const existing = vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await vault.modify(existing, data);
	} else {
		await vault.create(path, data);
	}
}

export async function loadChatSession(
	vault: Vault,
	folderPath: string,
	id: string
): Promise<ChatSessionFile | null> {
	const path = normalizePath(`${folderPath}/${id}.json`);
	const f = vault.getAbstractFileByPath(path);
	if (!f || !(f instanceof TFile)) return null;
	try {
		const raw = await vault.read(f);
		return JSON.parse(raw) as ChatSessionFile;
	} catch {
		return null;
	}
}

export async function listChatSessions(
	vault: Vault,
	folderPath: string
): Promise<ChatSessionFile[]> {
	const prefix = normalizePath(folderPath);
	const prefixSlash = prefix + "/";
	const files = vault
		.getFiles()
		.filter(
			(f) =>
				f.path.startsWith(prefixSlash) &&
				f.extension === "json" &&
				!f.path.slice(prefixSlash.length).includes("/")
		);
	const out: ChatSessionFile[] = [];
	for (const f of files) {
		try {
			const raw = await vault.read(f);
			out.push(JSON.parse(raw) as ChatSessionFile);
		} catch {
			/* skip corrupt */
		}
	}
	out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
	return out;
}

export async function deleteChatSessionFile(
	vault: Vault,
	folderPath: string,
	id: string
): Promise<void> {
	const path = normalizePath(`${folderPath}/${id}.json`);
	const f = vault.getAbstractFileByPath(path);
	if (f instanceof TFile) await vault.delete(f, true);
}

/** Remove sessions older than `retentionDays` (by `updated`). */
export async function pruneOldSessions(
	vault: Vault,
	folderPath: string,
	retentionDays: number
): Promise<number> {
	if (retentionDays <= 0) return 0;
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
