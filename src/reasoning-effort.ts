export function appendClaudeEffortArg(args: string[], effort?: string): void {
	if (effort) args.push("--effort", effort);
}

export function appendClaudeSessionArgs(
	args: string[],
	sessionId?: string,
	systemPrompt?: string,
): void {
	if (sessionId) args.push("--resume", sessionId);
	if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
}

export function appendCodexReasoningEffortArg(args: string[], effort?: string): void {
	if (effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
}
