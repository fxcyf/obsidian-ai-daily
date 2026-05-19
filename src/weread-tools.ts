import { requestUrl } from "obsidian";

export const WEREAD_SKILL_VERSION = "1.0.3";
export const WEREAD_GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const MAX_RESPONSE_CHARS = 20_000;

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max) + `\n...(truncated, ${text.length} chars total)`;
}

export class WeReadTools {
	constructor(private apiKey: string) {}

	async execute(
		_name: string,
		input: Record<string, unknown>
	): Promise<string> {
		const apiName = input.api_name as string | undefined;
		if (!apiName) return "Error: api_name is required";

		const params: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(input)) {
			if (k !== "api_name") params[k] = v;
		}
		return this.callGateway(apiName, params);
	}

	private async callGateway(
		apiName: string,
		params: Record<string, unknown>
	): Promise<string> {
		try {
			const body = {
				api_name: apiName,
				skill_version: WEREAD_SKILL_VERSION,
				...params,
			};

			const resp = await requestUrl({
				url: WEREAD_GATEWAY,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});

			if (resp.status >= 400) {
				return `WeRead API error ${resp.status}: ${resp.text}`;
			}

			const json = resp.json;
			if (json?.errcode && json.errcode !== 0) {
				return `WeRead API error (${json.errcode}): ${json.errmsg || JSON.stringify(json)}`;
			}

			const text = JSON.stringify(json, null, 2);
			return truncate(text, MAX_RESPONSE_CHARS);
		} catch (e) {
			return `Error calling WeRead API ${apiName}: ${e instanceof Error ? e.message : String(e)}`;
		}
	}
}
