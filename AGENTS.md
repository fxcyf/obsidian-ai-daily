# obsidian-ai-daily — Codex 入口

本仓库的 agent 规范单一来源是 `CLAUDE.md`。

Codex 开始任务前必须先阅读根目录 `CLAUDE.md`，并遵守其中的项目规范、测试要求、版本管理和任务完成后的 git 流程。

维护规则：
- 修改项目级 agent 指令时，优先更新 `CLAUDE.md`
- `AGENTS.md` 只作为 Codex 自动发现入口，保持简短
- 开发 worktree、任务状态和长期上下文使用中性命名；只有 Claude Code 专属权限/启动机制才放进 `.claude/`
- 如果 `CLAUDE.md` 的文件名、位置或维护策略变化，必须同步更新本文件
