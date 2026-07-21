export function claudeEffortArgs(effort?: string): string[] {
	return effort ? ["--effort", effort] : [];
}

export function codexReasoningConfig(effort?: string): Record<string, string> | undefined {
	return effort ? { model_reasoning_effort: effort } : undefined;
}
