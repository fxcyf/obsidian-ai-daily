export interface CodexHistoryMessage {
	role: string;
	content: string;
}

export function buildCodexHistoryItems(history: CodexHistoryMessage[]): Record<string, unknown>[] {
	return history
		.filter((message) => (message.role === "user" || message.role === "assistant") && message.content)
		.map((message) => ({
			type: "message",
			role: message.role,
			content: [{
				type: message.role === "assistant" ? "output_text" : "input_text",
				text: message.content,
			}],
		}));
}

export function appServerRequest(
	id: number,
	method: string,
	params: Record<string, unknown>,
): string {
	return `${JSON.stringify({ id, method, params })}\n`;
}

export function buildCodexThreadOpenRequest(options: {
	sessionId?: string;
	cwd: string;
	model?: string;
	reasoningEffort?: string;
	systemPrompt?: string;
}): { method: "thread/start" | "thread/resume"; params: Record<string, unknown> } {
	const common = {
		cwd: options.cwd,
		approvalPolicy: "never",
		sandbox: "read-only",
		...(options.model ? { model: options.model } : {}),
		...(options.reasoningEffort
			? { config: { model_reasoning_effort: options.reasoningEffort } }
			: {}),
	};

	if (options.sessionId) {
		return {
			method: "thread/resume",
			params: { threadId: options.sessionId, ...common },
		};
	}

	return {
		method: "thread/start",
		params: {
			...common,
			ephemeral: false,
			...(options.systemPrompt ? { developerInstructions: options.systemPrompt } : {}),
		},
	};
}
