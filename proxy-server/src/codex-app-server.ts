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
