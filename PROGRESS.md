# PROGRESS — 经验教训与项目进展

## 2026-04-25 — 移动端 UI 改进 (`409c0aa`)

- **问题**: 移动端多处 UI 问题——历史列表的删除按钮用 `opacity: 0` + `:hover` 显示，触屏设备无 hover 状态导致按钮完全不可见；header 按钮文字小(12px)、tap target 不足；loading 状态仅静态文本
- **修复**:
  - 删除按钮改为 `opacity: 0.4` 常态可见，hover 时增亮到 0.7
  - Header 从文字按钮改为 icon 按钮(rss/history/plus)，40x40 tap target，主操作用 accent 色区分
  - Loading 改为三点弹跳动画(CSS `@keyframes`)
  - Token bar 紧凑化：低使用率(<10%)时隐藏文字标签
  - 输入框从 `rows=2` 固定高度改为 `rows=1` + JS auto-grow，pill 形圆角，send 按钮改圆形
  - 历史面板去掉 margin/border-radius，全宽覆盖
  - 全局收紧 padding/margin，messages 区增加 `scroll-behavior: smooth`
- **教训**: 移动端不能依赖 `:hover` 状态控制可见性，所有可交互元素必须始终可见；icon 比文字在窄屏上更节省空间且 tap target 更大

## 2026-04-25 — 真流式回归 + 三态降级 (`8df25da`, `b068131`, `ee2fc02`)

- **背景**：上次（`fc03352` → `ce3e360`）真流式 fetch 实现因 CORS 全量回滚到伪流，并在
  `de1c9c0` 改用纯 `requestUrl` + 客户端切片。当时的代码注释直接判定"fetch 在
  `app://obsidian.md` 下被 CORS 拦截"，但**没追到真正的根因**。
- **本次根因**：上次的 fetch 头**缺了 `anthropic-dangerous-direct-browser-access: true`**。
  没这个头时 Anthropic 不会发回浏览器友好的 CORS 响应头，预检自然挂。Anthropic 官方
  浏览器 SDK 也是用同一个开关。
- **验证流程**（避免再次踩同一坑）：
  - Phase 0（`8df25da`）先单独写一个 `[Debug] 探测真流式连通性` 命令，最小代价
    在真实 Obsidian 桌面环境跑一次；只有 `firstChunkMs < totalMs` 且 `chunks > 1` 才
    判定真流式生效。**实测 firstChunkMs ≈ 1018ms，chunks = 4**，结论确证。
  - Phase 1（`b068131`）抽离 `src/anthropic-sse.ts` 纯函数模块 + 引入 vitest，
    20 个单测覆盖 LF/CRLF 分隔、跨 chunk 切分、tool_use partial JSON 边界。
  - Phase 2（`ee2fc02`）才动 ClaudeClient，`streamMode: auto/real/typewriter/off`
    三态降级；`auto` 模式 fetch 抛错时静默退化为打字机，UI 无感。
- **教训**：CORS 失败先排查请求头，不要立刻怀疑"Obsidian 沙箱不允许 fetch"。
  浏览器的 CORS 错误和服务端策略错误从外观上看一模一样，根因可能在请求侧。
- **教训**：复杂改动按 Phase 0 → 1 → 2 拆，**每个阶段都能独立验证或撤销**，避免
  上次"一次性写完一改全挂只能整体回滚"的剧情重演。
- **设置迁移**：`chatStreaming: boolean` → `chatStreamMode`，`loadSettings` 内做兼容映射，
  老用户升级无配置丢失。

## 2026-04-25 — 本地图片处理方案拆分 (`9dda7a7`)

- 新增 `plan/feature-local-file-image.md`，将“本地文件处理（先图片）”拆成独立 feature 文档并定义 Phase 1-4
- `roadmap` 增加可点击来源链接，避免专项计划只存在于单一文档导致后续迭代入口不清晰
- **经验**: 对于跨模块功能（解析、IO、请求体、设置），先输出“接口草案 + 测试清单”可显著降低实现阶段的返工风险

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

## 2026-04-14 — 历史记录 + 流式两项根因修复

- **历史记录读不到**：根本原因是默认目录 `.ai-chat` 以 `.` 开头，Obsidian vault **不索引隐藏目录**，`vault.getFiles()` / `getAbstractFileByPath()` 永远返回空；彻底改用 `vault.adapter.read/write/list/remove/exists` 直接操作文件系统，绕过索引。
- **无流式效果**：delta 回调里用了 120ms 防抖 timer，两个 delta 间隔只有 14ms，防抖不断被重置，等所有 delta 发完才渲染一次，看起来整段出现。改为：流式过程中每次 delta 直接 `setText(accumulated)`，结束后做一次完整 Markdown 渲染。

## 待解决

- [ ] 测试覆盖：目前无任何测试文件
- [ ] 版本号统一：manifest.json (0.2.0) 与 package.json (0.1.0) 不一致
