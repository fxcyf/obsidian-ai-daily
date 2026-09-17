export interface ConversationContextMessage {
	role: "user" | "assistant";
	content: string;
}

export const CONVERSATION_BACKENDS = [
	"api",
	"local-claude-code",
	"local-codex",
	"proxy-claude-code",
	"proxy-codex",
] as const;

export type ConversationBackend = typeof CONVERSATION_BACKENDS[number];
export type BackendContextStrategy = "client-managed" | "native-seed" | "text-seed";

/**
 * Exhaustive registry: adding a backend requires choosing how it receives
 * pre-existing UI history before TypeScript will compile.
 */
export const BACKEND_CONTEXT_STRATEGIES = {
	api: "client-managed",
	"local-claude-code": "native-seed",
	"local-codex": "text-seed",
	"proxy-claude-code": "native-seed",
	"proxy-codex": "native-seed",
} as const satisfies Record<ConversationBackend, BackendContextStrategy>;

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

export function resolveCliConversationBackend(
	location: "local" | "proxy",
	backend: "claude-code" | "codex",
): Exclude<ConversationBackend, "api"> {
	if (location === "local") {
		return backend === "codex" ? "local-codex" : "local-claude-code";
	}
	return backend === "codex" ? "proxy-codex" : "proxy-claude-code";
}

export interface BackendContextPlan {
	backend: ConversationBackend;
	mode: BackendContextStrategy | "resume";
	history: ConversationContextMessage[];
}

export function planBackendContext(options: {
	backend: ConversationBackend;
	hasSession: boolean;
	messages: ConversationMessageLike[];
}): BackendContextPlan {
	if (options.hasSession) {
		return { backend: options.backend, mode: "resume", history: [] };
	}

	return {
		backend: options.backend,
		mode: BACKEND_CONTEXT_STRATEGIES[options.backend],
		history: historyBeforeCurrentTurn(options.messages),
	};
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
