# obsidian-ai-daily — 项目指南

> **重要：Claude 必须自主维护本文件。** 架构或约定变化时更新，保持简洁。

## Git 信息

- Remote: git@github-fxcyf.com:fxcyf/obsidian-ai-daily.git
- 默认分支: main

## 任务生命周期

你收到任务后，按以下 9 步流程自主完成：

1. **领取任务** — 你已被分配任务，阅读本文件和项目代码理解上下文
2. **创建工作区**:
   - `git fetch origin`（如有 remote）
   - `git worktree add -b task-<简短描述> .claude-manager/worktrees/task-<简短描述> origin/main`
   - 进入 worktree 目录工作（后续所有操作在 worktree 中）
   - 如果 worktree 创建失败，直接在当前分支工作
3. **实现功能** — 编写代码，确保可运行
4. **提交代码** — `git add` + `git commit`，commit message 简洁描述改动
5. **Merge + 测试**:
   - `git fetch origin && git merge origin/main`（集成最新代码，如有 remote）
   - 运行测试（如有测试命令）
6. **自动合并到 main**（如有 remote）:
   - `git fetch origin main`
   - `git rebase origin/main`，如果冲突则自行 resolve
   - 如果成功：`git checkout main && git merge <task-branch> && git push origin main`
   - 如果这一步有任何失败，退回到步骤 5 重试
   - （纯本地项目跳过本步）
7. **标记完成** — 更新文档（必须在清理之前，防止进程被杀时状态丢失）
8. **清理** — 回到项目根目录:
   - `git worktree remove .claude-manager/worktrees/<worktree名>`
   - `git branch -D <task-branch>`
   - 如有 remote: `git push origin --delete <task-branch>`
9. **经验沉淀** — 在 PROGRESS.md 记录经验教训（可选）

### 冲突处理

rebase 发生冲突时：
1. 查看冲突文件: `git diff --name-only --diff-filter=U`
2. 逐个解决冲突
3. `git add <resolved-files> && git rebase --continue`
4. 如果无法解决: `git rebase --abort`，退回步骤 5

### 状态判断

- 通过 `git remote -v` 判断是否有 remote
- 有 remote → 必须完成步骤 6（merge + push）
- 无 remote → 跳过步骤 5 的 fetch、步骤 6 和步骤 8 的远程分支删除

## 文件维护规则

> **以下文件都由 Claude Code 自主维护，每次功能变更后必须同步更新。**

- **CLAUDE.md**（本文件）：架构、约定、关键路径变化时更新，只改变化的部分，保持简洁
- **README.md**：面向用户的文档，功能、使用流程变化时同步更新，保持与实际代码一致
- **TEST.md**：测试指南，新增功能时同步添加测试用例和文档
- **PROGRESS.md**：见下方「经验教训沉淀」
- **plan/roadmap.md**：每次新增或修改 `plan/` 下的计划文档后，必须在 `plan/roadmap.md` 中添加索引和组织，确保 roadmap 始终是所有计划的完整入口

## 测试规范

**开发时必须主动使用测试，不是事后补充！**

- **改代码前**：先跑测试，确认基线全绿
- **改代码后**：再跑一遍确认无回归
- **新增功能**：同步新增测试用例，更新 TEST.md
- **修 bug**：先写复现 bug 的测试（红），修复后确认变绿

## 经验教训沉淀

每次遇到问题或完成重要改动后，要在 PROGRESS.md 中记录：
- 遇到了什么问题
- 如何解决的
- 以后如何避免
- **必须附上 git commit ID**

**同样的问题不要犯两次！**

## 架构概览

- `src/main.ts` — 插件入口，注册视图、命令、设置
- `src/chat-view.ts` — 聊天侧边栏 UI
- `src/claude.ts` — Claude API client，支持 tool_use agentic loop 和 real/typewriter/off 流式调度
- `src/anthropic-sse.ts` — Anthropic SSE 解析与组装（纯函数，单测覆盖）
- `src/anthropic-sse.test.ts` — `npm test` 入口（vitest）
- `src/vault-tools.ts` — Vault 工具实现（read/search/append/list/create/edit/rename/delete/update_frontmatter/get_links）
- `src/vault-tools.test.ts` — vault-tools 纯函数单测（frontmatter 解析、heading 定位）
- `src/image-tools.ts` — 本地图片处理（提取引用、二进制读取、base64 编码）
- `src/image-tools.test.ts` — image-tools 单测（extractLocalImageRefs）
- `src/auto-tagger.ts` — 笔记自动标注（debounce + Claude API 生成 tags/summary + frontmatter 写入）
- `src/auto-tagger.test.ts` — auto-tagger 单测（parseTaggingResponse）
- `src/knowledge-agent.ts` — 知识整理辅助（findUnorganizedNotes 扫描 + distillConversation 对话蒸馏），整理流程通过聊天交互完成
- `src/web-tools.ts` — Web 工具实现（web_fetch 网页抓取）
- `src/settings.ts` — 插件设置（含 Feed 配置）
- `src/feeds.ts` — 多源抓取（RSS/HN API/Reddit/GitHub Trending）、社交热度评分、时间衰减、爆发检测
- `src/feed-generator.ts` — Feed 生成器，编排 RSS + vault 搜索 + Claude 汇总
- `mcp-server/` — 独立 MCP server，用于 Claude Code 直接操作 vault（纯 Node.js 文件操作，不依赖 Obsidian API）

## 版本管理

- **每次 push 到远端之前，必须升级版本号**（方便在移动端验证更新是否生效）
- 版本号需要同步更新三处：`manifest.json`、`package.json`、`src/chat-view.ts` 中的欢迎页标题
- 使用 patch 版本递增（如 0.2.1 → 0.2.2），除非是重大功能变更

## 注意事项

- 在 worktree 中工作时，不要切换到其他分支
- 完成任务后确保代码可运行、测试通过
