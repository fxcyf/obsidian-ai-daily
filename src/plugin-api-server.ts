import { App, TFile } from "obsidian";
import type { IncomingMessage, ServerResponse } from "http";
import { VaultTools } from "./vault-tools";
import { PodcastTools } from "./podcast-tools";
import { FeedTools } from "./feed-tools";
import { prepareLocalImages, type ImageRef } from "./image-tools";

type HttpServer = import("http").Server;

export class PluginApiServer {
	private app: App;
	private port: number;
	private server: HttpServer | null = null;
	private vaultTools: VaultTools;
	private podcastTools: PodcastTools;
	private feedTools: FeedTools;

	constructor(app: App, port: number, knowledgeFolders: string[] = [], feedSources: import("./feeds").FeedSource[] = []) {
		this.app = app;
		this.port = port;
		this.vaultTools = new VaultTools(app, knowledgeFolders);
		this.podcastTools = new PodcastTools();
		this.feedTools = new FeedTools(feedSources);
	}

	async start(): Promise<void> {
		const http = require("http") as typeof import("http");
		this.server = http.createServer((req, res) => this.handleRequest(req, res));
		this.server.listen(this.port, "127.0.0.1", () => {
			console.log(`[Cortex] Plugin API server listening on 127.0.0.1:${this.port}`);
		});
		this.server.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE") {
				console.warn(`[Cortex] Port ${this.port} in use, API server not started`);
			} else {
				console.error("[Cortex] API server error:", err);
			}
		});
	}

	stop(): void {
		if (this.server) {
			this.server.close();
			this.server = null;
			console.log("[Cortex] Plugin API server stopped");
		}
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		res.setHeader("Content-Type", "application/json");

		const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
		const path = url.pathname;

		if (path === "/api/health" && req.method === "GET") {
			res.end(JSON.stringify({ status: "ok" }));
			return;
		}

		if (req.method !== "POST") {
			res.statusCode = 405;
			res.end(JSON.stringify({ error: "Method not allowed" }));
			return;
		}

		let body: Record<string, unknown>;
		try {
			body = await this.readBody(req);
		} catch {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: "Invalid JSON body" }));
			return;
		}

		try {
			const result = await this.route(path, body);
			res.end(JSON.stringify({ result }));
		} catch (e) {
			res.statusCode = 500;
			const message = e instanceof Error ? e.message : String(e);
			res.end(JSON.stringify({ error: message }));
		}
	}

	private async route(path: string, body: Record<string, unknown>): Promise<string> {
		switch (path) {
			case "/api/read_note":
			case "/api/search_vault":
			case "/api/append_to_note":
			case "/api/list_notes":
			case "/api/create_note":
			case "/api/edit_note":
			case "/api/rename_note":
			case "/api/delete_note":
			case "/api/get_links":
			case "/api/update_frontmatter": {
				const toolName = path.replace("/api/", "");
				return this.vaultTools.execute(toolName, body);
			}

			case "/api/read_image":
				return this.handleReadImage(body);

			case "/api/podcast_search":
			case "/api/podcast_episodes":
			case "/api/podcast_transcript": {
				const toolName = path.replace("/api/", "");
				return this.podcastTools.execute(toolName, body);
			}

			case "/api/fetch_feeds":
			case "/api/fetch_rss": {
				const toolName = path.replace("/api/", "");
				return this.feedTools.execute(toolName, body);
			}

			default:
				throw new Error(`Unknown endpoint: ${path}`);
		}
	}

	private async handleReadImage(input: Record<string, unknown>): Promise<string> {
		const path = typeof input.path === "string" ? input.path : "";
		if (!path) return "Error: path is required";

		const ref: ImageRef = { raw: `![[${path}]]`, path };
		const { images, skipped } = await prepareLocalImages(this.app, [ref]);

		if (skipped.length > 0) {
			return `Error: ${skipped[0].reason}`;
		}
		if (images.length === 0) {
			return "Error: image not found";
		}

		return JSON.stringify({
			mediaType: images[0].mediaType,
			base64: images[0].base64,
		});
	}

	private readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => {
				try {
					const text = Buffer.concat(chunks).toString("utf-8");
					resolve(text ? JSON.parse(text) : {});
				} catch (e) {
					reject(e);
				}
			});
			req.on("error", reject);
		});
	}
}
