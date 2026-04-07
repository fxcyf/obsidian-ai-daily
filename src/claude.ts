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
			"读取 vault 中指定路径的笔记全文。可用于读取日报、采集的文章（Raw/）、整理的知识条目（Wiki/）等。",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description: "笔记路径，如 Raw/some-article.md 或 Wiki/concept.md",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "search_vault",
		description:
			"在 vault 中搜索笔记。支持关键词全文搜索，可按文件夹和标签过滤。用于在知识库中查找相关内容。",
		input_schema: {
			type: "object" as const,
			properties: {
				query: {
					type: "string",
					description: "搜索关键词",
				},
				folder: {
					type: "string",
					description: "限定搜索的文件夹路径，如 Raw、Wiki（可选）",
				},
				tag: {
					type: "string",
					description: "按标签过滤，如 ai、rag（可选，匹配 frontmatter 中的 tags）",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "append_to_note",
		description:
			"将内容追加到指定笔记末尾。用于将对话中的洞察、总结写回笔记。",
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
		name: "list_notes",
		description:
			"列出指定文件夹中的笔记，按修改时间排序。不指定文件夹则列出所有知识库文件夹（Daily、Raw、Wiki 等）的笔记。",
		input_schema: {
			type: "object" as const,
			properties: {
				folder: {
					type: "string",
					description: "文件夹路径，如 Raw、Wiki、AI-Daily（可选，不填则列出全部）",
				},
				limit: {
					type: "number",
					description: "返回最近几篇（默认 20）",
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
