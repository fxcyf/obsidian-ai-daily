export function claudeEffortArgs(effort?: string): string[] {
	return effort ? ["--effort", effort] : [];
}

export function claudeSessionArgs(sessionId?: string, systemPrompt?: string): string[] {
	return [
		...(sessionId ? ["--resume", sessionId] : []),
		...(systemPrompt ? ["--append-system-prompt", systemPrompt] : []),
	];
}

export function codexReasoningConfig(effort?: string): Record<string, string> | undefined {
	return effort ? { model_reasoning_effort: effort } : undefined;
}
