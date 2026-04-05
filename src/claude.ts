/**
 * Claude API client with tool_use support.
 * Uses Obsidian's requestUrl to bypass CORS — works on iOS and desktop.
 */

import { requestUrl } from "obsidian";

const API_URL = "https://api.anthropic.com/v1/messages";

// ── Tool definitions ────────────────────────────────────────────────

export const VAULT_TOOLS = [
	{
		name: "read_note",
		description:
			"读取 vault 中指定路径的笔记内容。用于获取日报或其他笔记的完整文本。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径，如 AI-Daily/2026-04-03.md",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "search_vault",
		description:
			"在 vault 中搜索包含关键词的笔记，返回匹配的文件路径和摘要片段。用于查找历史日报中的相关内容。",
		input_schema: {
			type: "object" as const,
			properties: {
				query: {
					type: "string",
					description: "搜索关键词",
				},
				folder: {
					type: "string",
					description: "限定搜索的文件夹路径（可选）",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "append_to_note",
		description:
			"将内容追加到指定笔记的末尾。用于将对话中的洞察、总结写回日报或笔记。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径",
				},
				content: {
					type: "string",
					description: "要追加的 Markdown 内容",
				},
			},
			required: ["path", "content"],
		},
	},
	{
		name: "list_daily_notes",
		description:
			"列出日报文件夹中的所有日报文件，按日期排序。用于了解有哪些历史日报可用。",
		input_schema: {
			type: "object" as const,
			properties: {
				limit: {
					type: "number",
					description: "返回最近几篇（默认 10）",
				},
			},
			required: [],
		},
	},
];

// ── Types ───────────────────────────────────────────────────────────

interface TextBlock {
	type: "text";
	text: string;
}

interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

type ContentBlock = TextBlock | ToolUseBlock;

interface Message {
	role: "user" | "assistant";
	content: string | ContentBlock[];
}

interface ApiResponse {
	content: ContentBlock[];
	stop_reason: string;
	usage: { input_tokens: number; output_tokens: number };
}

export interface ToolResult {
	type: "tool_result";
	tool_use_id: string;
	content: string;
	is_error?: boolean;
}

export type ToolExecutor = (
	name: string,
	input: Record<string, unknown>
) => Promise<string>;

// ── Client ──────────────────────────────────────────────────────────

export class ClaudeClient {
	private apiKey: string;
	private model: string;
	private messages: Message[] = [];
	private systemPrompt: string;

	constructor(apiKey: string, model: string, systemPrompt: string) {
		this.apiKey = apiKey;
		this.model = model;
		this.systemPrompt = systemPrompt;
	}

	/** Send a user message and run the tool loop until Claude is done. */
	async chat(
		userMessage: string,
		executeTool: ToolExecutor,
		onText?: (text: string) => void
	): Promise<string> {
		this.messages.push({ role: "user", content: userMessage });

		const collectedText: string[] = [];

		// Agentic loop: keep going until Claude stops calling tools
		while (true) {
			const response = await this.callApi();

			// Collect text blocks
			for (const block of response.content) {
				if (block.type === "text") {
					collectedText.push(block.text);
					onText?.(block.text);
				}
			}

			// If no tool calls, we're done
			if (response.stop_reason === "end_turn") {
				this.messages.push({
					role: "assistant",
					content: response.content,
				});
				break;
			}

			// Extract tool calls
			const toolUses = response.content.filter(
				(b): b is ToolUseBlock => b.type === "tool_use"
			);

			if (toolUses.length === 0) {
				this.messages.push({
					role: "assistant",
					content: response.content,
				});
				break;
			}

			// Append assistant message with tool_use blocks
			this.messages.push({
				role: "assistant",
				content: response.content,
			});

			// Execute tools and collect results
			const results: ToolResult[] = [];
			for (const tool of toolUses) {
				try {
					const result = await executeTool(tool.name, tool.input);
					results.push({
						type: "tool_result",
						tool_use_id: tool.id,
						content: result,
					});
				} catch (e) {
					results.push({
						type: "tool_result",
						tool_use_id: tool.id,
						content: `Error: ${e instanceof Error ? e.message : String(e)}`,
						is_error: true,
					});
				}
			}

			this.messages.push({ role: "user", content: results as any });
		}

		return collectedText.join("");
	}

	clearHistory(): void {
		this.messages = [];
	}

	private async callApi(): Promise<ApiResponse> {
		const body = {
			model: this.model,
			max_tokens: 4096,
			system: this.systemPrompt,
			tools: VAULT_TOOLS,
			messages: this.messages,
		};

		const resp = await requestUrl({
			url: API_URL,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": this.apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify(body),
		});

		if (resp.status >= 400) {
			throw new Error(`Claude API error ${resp.status}: ${resp.text}`);
		}

		return resp.json;
	}
}
