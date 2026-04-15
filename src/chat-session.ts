/**
 * Persisted chat session.
 *
 * Hidden-folder note: Obsidian does NOT index files inside folders that start
 * with "." (e.g. ".ai-chat").  vault.getFiles(), vault.getAbstractFileByPath()
 * and vault.create/modify all rely on the vault index, so they silently fail for
 * hidden paths.  We bypass the vault index entirely and use DataAdapter directly.
 */

import { Vault, normalizePath } from "obsidian";

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
	const path = normalizePath(`${folderPath}/${session.id}.json`);
	await vault.adapter.write(path, JSON.stringify(session, null, 2));
}

export async function loadChatSession(
	vault: Vault,
	folderPath: string,
	id: string
): Promise<ChatSessionFile | null> {
	const path = normalizePath(`${folderPath}/${id}.json`);
	try {
		if (!(await vault.adapter.exists(path))) return null;
		const raw = await vault.adapter.read(path);
		return JSON.parse(raw) as ChatSessionFile;
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
		for (const filePath of listed.files) {
			if (!filePath.endsWith(".json")) continue;
			try {
				const raw = await vault.adapter.read(filePath);
				out.push(JSON.parse(raw) as ChatSessionFile);
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
	const path = normalizePath(`${folderPath}/${id}.json`);
	try {
		if (await vault.adapter.exists(path)) {
			await vault.adapter.remove(path);
		}
	} catch {
		/* ignore */
	}
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
