# PROGRESS — 经验教训与项目进展

## 2026-04-03 — 初始化插件 (`3422d58`)

- 搭建 Obsidian 插件基础结构：esbuild 构建、manifest.json、main.ts 入口
- 实现侧边栏聊天 UI、Claude API 客户端（tool_use）、Vault 工具套件
- **经验**: 初始架构选择直接调用 HTTP API 而非 SDK，减少依赖，便于 Obsidian 移动端兼容

## 2026-04-04 — CORS 修复与部署流程 (`13fb044`, `ef96c3d`, `7aab4fe`)

- **问题**: 原生 `fetch` 在 Obsidian 桌面端/iOS 均遇到 CORS 限制，无法调用 Claude API
- **解决**: 改用 Obsidian 内置 `requestUrl` 绕过 CORS（commit `13fb044`）
- **教训**: Obsidian 插件中所有外部 HTTP 请求都应使用 `requestUrl`，不要用原生 fetch
- 新增 GitHub Actions self-hosted runner 自动部署工作流（`ef96c3d`）
- 在欢迎标题添加版本号用于部署验证（`7aab4fe`）

## 2026-04-07 — 知识库转型 (`eccb68d`)

- 从"AI 日记助手"转型为"AI 知识库对话"
- 新增 Raw/Wiki 文件夹支持，自动加载知识库文件作为上下文
- **经验**: 上下文窗口管理很重要，需要控制加载的文件数量避免超出 token 限制

## 2026-04-14 — 流式与历史记录修复（SSE CRLF + vault.create）

- **问题**: 侧栏「历史」为空、流式无感 — SSE 事件以 `\r\n\r\n` 分隔时用 `\n\n` 切分永远得不到完整事件，增量解析不触发；`adapter.write` 不落 vault 索引，`getFiles`/列表不可靠。
- **修复**: `consumeOneSseEvent` 同时识别 `\r\n\r\n` 与 `\n\n`；`fetch` 失败或 CORS 时用 `requestUrl` 拉取完整 SSE 正文再走同一解析器（仍会触发 `text_delta` 回调）；存档改用 `vault.create`/`modify` + `normalizePath`，列表用 `vault.getFiles()` 前缀过滤。
- **Commit**: `2eb571c`

## 2026-04-14 — 对话体验：流式、存档、token 与摘要 (`fc03352`)

- **流式输出**: 使用 `fetch` + SSE 解析 Anthropic 流；失败时回退到 `requestUrl` 非流式（与既有 CORS 策略兼容）
- **多轮工具**: 流式回调按轮次累加 `priorAssistantText`，避免仅显示最后一轮模型输出
- **持久化**: `src/chat-session.ts` 将 `ChatSessionFile` 写入 vault；标题取首条用户消息前 30 字
- **压缩上下文**: 估算 tokens 超阈值时用一次无 tools 的 API 调用生成摘要，再截断早期消息
- **教训**: 勿在 `initClient` 用 UI 消息 `setHistoryFromStrings` 后又 `chat()` 推同一用户句，会重复；仅在「恢复历史」后注入客户端历史

## 待解决

- [ ] 测试覆盖：目前无任何测试文件
- [ ] 版本号统一：manifest.json (0.2.0) 与 package.json (0.1.0) 不一致
