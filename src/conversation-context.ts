export interface ConversationContextMessage {
	role: "user" | "assistant";
	content: string;
}

interface ConversationMessageLike extends ConversationContextMessage {
	source?: string;
}

/**
 * The UI appends the current user message before dispatching a backend call.
 * A backend handoff must seed everything before that message exactly once.
 */
export function historyBeforeCurrentTurn(
	messages: ConversationMessageLike[],
): ConversationContextMessage[] {
	return messages.slice(0, -1).map(({ role, content }) => ({ role, content }));
}

/**
 * Fallback for backends that cannot accept native role-preserving history.
 * JSON keeps role and message boundaries unambiguous when embedded in a prompt.
 */
export function buildTextHistoryHandoff(
	history: ConversationContextMessage[],
): string {
	if (history.length === 0) return "";

	return [
		"## 历史对话上下文",
		"以下 JSON 是本次切换后端前已经发生的对话。请将它作为连续会话历史，回答当前新消息；不要声称看不到前文，也不要复述整段历史。",
		"```json",
		JSON.stringify(history, null, 2),
		"```",
	].join("\n");
}

export function buildTextSeededFirstTurn(options: {
	systemPrompt: string;
	history: ConversationContextMessage[];
	currentMessage: string;
}): string {
	return [
		options.systemPrompt,
		buildTextHistoryHandoff(options.history),
		options.currentMessage,
	].filter(Boolean).join("\n\n");
}
