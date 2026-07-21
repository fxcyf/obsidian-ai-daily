export const CLAUDE_CODE_MODELS: ReadonlyArray<readonly [string, string]> = [
	["", "CLI 默认（推荐）"],
	["sonnet", "Sonnet（最新）"],
	["opus", "Opus（最新）"],
	["haiku", "Haiku（最新）"],
	["claude-sonnet-5", "Claude Sonnet 5"],
	["claude-sonnet-4-6", "Claude Sonnet 4.6"],
	["claude-opus-4-8", "Claude Opus 4.8"],
	["claude-opus-4-6", "Claude Opus 4.6"],
	["claude-haiku-4-5", "Claude Haiku 4.5"],
];

export function getClaudeCodeModelOptions(current: string): ReadonlyArray<readonly [string, string]> {
	if (!current || CLAUDE_CODE_MODELS.some(([value]) => value === current)) return CLAUDE_CODE_MODELS;
	return [...CLAUDE_CODE_MODELS, [current, `已有自定义模型（${current}）`] as const];
}
