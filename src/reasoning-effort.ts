export function appendClaudeEffortArg(args: string[], effort?: string): void {
	if (effort) args.push("--effort", effort);
}

export function appendCodexReasoningEffortArg(args: string[], effort?: string): void {
	if (effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
}
