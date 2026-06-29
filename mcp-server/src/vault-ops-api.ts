const DEFAULT_API_URL = "http://127.0.0.1:27080";

export class VaultOpsApi {
	private apiUrl: string;

	constructor(apiUrl?: string) {
		this.apiUrl = apiUrl || DEFAULT_API_URL;
	}

	async healthCheck(): Promise<boolean> {
		try {
			const resp = await fetch(`${this.apiUrl}/api/health`, {
				signal: AbortSignal.timeout(3000),
			});
			return resp.ok;
		} catch {
			return false;
		}
	}

	async readNote(path: string): Promise<string> {
		return this.call("/api/read_note", { path });
	}

	async searchVault(query: string, folder?: string, tag?: string): Promise<string> {
		return this.call("/api/search_vault", { query, folder, tag });
	}

	async appendToNote(path: string, content: string): Promise<string> {
		return this.call("/api/append_to_note", { path, content });
	}

	async listNotes(folder?: string, limit?: number): Promise<string> {
		return this.call("/api/list_notes", { folder, limit });
	}

	async createNote(path: string, content: string, frontmatter?: Record<string, unknown>): Promise<string> {
		return this.call("/api/create_note", { path, content, frontmatter });
	}

	async editNote(path: string, mode: string, target: unknown, replacement: string): Promise<string> {
		return this.call("/api/edit_note", { path, mode, target, replacement });
	}

	async renameNote(path: string, newPath: string): Promise<string> {
		return this.call("/api/rename_note", { path, new_path: newPath });
	}

	async deleteNote(path: string, confirmed: boolean): Promise<string> {
		return this.call("/api/delete_note", { path, confirmed });
	}

	async getLinks(path: string): Promise<string> {
		return this.call("/api/get_links", { path });
	}

	async updateFrontmatter(path: string, set?: Record<string, unknown>, del?: string[]): Promise<string> {
		return this.call("/api/update_frontmatter", { path, set, delete: del });
	}

	async readImage(path: string): Promise<string> {
		return this.call("/api/read_image", { path });
	}

	async podcastSearch(query: string, limit?: number): Promise<string> {
		return this.call("/api/podcast_search", { query, limit });
	}

	async podcastEpisodes(url: string, limit?: number): Promise<string> {
		return this.call("/api/podcast_episodes", { url, limit });
	}

	async podcastTranscript(url: string, episodeIndex?: number): Promise<string> {
		return this.call("/api/podcast_transcript", { url, episode_index: episodeIndex });
	}

	private async call(endpoint: string, body: Record<string, unknown>): Promise<string> {
		const resp = await fetch(`${this.apiUrl}${endpoint}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!resp.ok) {
			const err = await resp.text().catch(() => "unknown error");
			return `Error: HTTP ${resp.status} — ${err}`;
		}

		const data = await resp.json() as { result?: string; error?: string };
		if (data.error) return `Error: ${data.error}`;
		return data.result ?? "";
	}
}
