import { requestUrl } from "obsidian";

export class WebTools {
	async execute(
		name: string,
		input: Record<string, unknown>
	): Promise<string> {
		switch (name) {
			case "web_fetch":
				return this.webFetch(input.url as string);
			default:
				return `Unknown web tool: ${name}`;
		}
	}

	private async webFetch(url: string): Promise<string> {
		if (!url) return "Error: url is required";

		try {
			const resp = await requestUrl({
				url,
				headers: {
					"User-Agent":
						"Mozilla/5.0 (compatible; ObsidianBot/1.0)",
					Accept: "text/html,application/xhtml+xml,text/plain,application/json",
				},
			});

			if (resp.status >= 400) {
				return `HTTP error ${resp.status} fetching ${url}`;
			}

			const contentType = resp.headers["content-type"] || "";

			if (contentType.includes("application/json")) {
				const text = JSON.stringify(resp.json, null, 2);
				return truncate(text, 12_000);
			}

			const html = resp.text;
			const text = htmlToText(html);
			return truncate(text, 12_000);
		} catch (e) {
			return `Error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`;
		}
	}
}

function htmlToText(html: string): string {
	const cleaned = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<nav[\s\S]*?<\/nav>/gi, "")
		.replace(/<footer[\s\S]*?<\/footer>/gi, "")
		.replace(/<header[\s\S]*?<\/header>/gi, "");

	const parser = new DOMParser();
	const doc = parser.parseFromString(cleaned, "text/html");

	const article =
		doc.querySelector("article") ||
		doc.querySelector("main") ||
		doc.querySelector("[role='main']") ||
		doc.body;

	const text = (article?.textContent || "")
		.replace(/\t/g, " ")
		.replace(/ {2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return text;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen) + "\n\n...(truncated)";
}
