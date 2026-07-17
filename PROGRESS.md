# PROGRESS — 经验教训与项目进展

## 2026-07-17 — Agent 工具策略单一来源 (`01cae33`)

- **重构**：新增 `agent-tool-policy.json`，统一维护 Claude Code 桌面/Proxy 内置工具与 Codex MCP 只读、可写、永久禁用分组。
- **消费方**：桌面插件构建时打包该策略；Proxy 启动时读取同一文件，systemd 显式配置路径。
- **防漂移**：新增策略测试，验证工具名均有定义、破坏性工具不进入白名单、Claude Code 不开放 Bash/Write/Edit。

## 2026-07-17 — Codex 读取型 MCP 白名单补全 (`4346273`)

- **修正**：Feed、RSS、播客和微信读书均属于读取型能力，应在只读与 Vault 可写档位中保持开放，与 Claude Code 能力一致。
- **边界**：继续禁用 delete_note、rename_note 与 Shell 写入；Vault 写入档位只增加创建、追加、编辑和 frontmatter。
- **教训**：工具风险应按副作用分类，不能把“需要网络”简单等同于“具有破坏性”。

## 2026-07-17 — Codex 非交互安全边界 (`d14f561`)

- **问题**：桌面端和 Proxy Codex 使用 bypass + danger-full-access；即使限制 MCP，通用 Shell 仍可绕过工具层访问宿主机。
- **解决**：统一改为 `approval_policy=never` + `sandbox_mode=read-only`；增加“只读”和“Vault 可写”MCP 白名单档位，始终禁用删除、重命名和网络型工具。
- **验证**：Shell `touch /tmp/...` 被 OS 沙箱以只读文件系统拒绝；同一配置下白名单 `list_notes` 无需审批即可读取真实 Vault。
- **教训**：工具白名单和系统沙箱必须叠加；非交互场景不能用 Full Access 代替审批设计。

## 2026-07-17 — Codex Proxy 缺少 Obsidian MCP (`1c53621`)

- **问题**：`MCP_CONFIG` 只传给 Claude Code；Codex 进程未加载 `obsidian-vault`，system prompt 虽描述了工具但运行时没有工具定义。
- **解决**：Proxy 将现有 MCP JSON 转换为 Codex 单进程 `-c mcp_servers.*` 覆盖；同时兼容 Codex 0.144 MCP 事件的 `server/tool` 字段。
- **验证**：GPT-5.6 Sol 成功发现 `obsidian_vault`，调用 `list_notes` 并读出 vault 实际文件，最终回复“调用成功”。
- **教训**：prompt 中声明能力不等于运行时注册能力；Agent 工具必须从 CLI 启动配置到事件解析做端到端验证。

## 2026-07-17 — Codex 续问失败与历史丢失 (`abb1610`)

- **问题**：`codex exec resume` 不支持 `--sandbox`，第二轮直接 code 2；Codex 分支又跳过了 Proxy 收到的 `history` 与 `systemPrompt`。
- **解决**：resume 移除非法参数；新 Codex 会话首轮将 system instructions、user/assistant 历史和当前消息分区注入 prompt。
- **验证**：使用真实 GPT-5.6 Sol thread ID 续问，完整返回 `thread.started`、`RESUMED` 与 `turn.completed`。
- **教训**：同一 CLI 的初始命令与 resume 子命令参数集合可能不同；跨后端切换必须显式定义历史迁移语义。

## 2026-07-17 — GPT-5.6 Codex 模型选择 (`29854ad`)

- **更新**：新增账户默认、GPT-5.6 Sol/Terra/Luna 与 GPT-5.3 Codex；移除过期的 o4-mini/o3/GPT-5.5 下拉项。
- **修复**：移动端 Proxy 现在会传递并实际应用所选 Codex 模型，日志同步记录模型 ID；旧 o4-mini 设置自动迁移到账户默认。
- **验证**：使用当前 ChatGPT Codex 账户实测 `gpt-5.6-sol`，完整返回 `thread.started`、`agent_message: OK` 与 `turn.completed`。
- **教训**：模型选择器必须同时验证 UI、传输协议和目标账户 entitlement，不能只更新显示文本。

## 2026-07-17 — Codex Proxy 未真正启动 (`3ed9114`)

- **问题**：Codex 子进程 stdin pipe 始终未关闭，CLI 等待 EOF，因而没有产生 `thread.started`；关闭 stdin 后又发现硬编码的 `o4-mini` 不支持 ChatGPT Codex 账户。
- **解决**：Codex stdin 改为 `ignore`，默认使用账户当前支持的模型，仅在配置 `CODEX_MODEL` 时覆盖，并记录失败 stderr。
- **验证**：同机 CLI 在 stdin EOF 且不指定模型时完整输出 `thread.started`、`agent_message: OK` 和 `turn.completed`。
- **教训**：CLI 集成必须用真实账户做最小端到端冒烟测试；“进程存活”不代表模型请求已经开始。

## 2026-07-17 — Codex Proxy 长任务无反馈 (`594e56c`)

- **问题**：请求已到 Proxy，但 Codex 的 reasoning、`item.started` 和存活状态没有转发，前端只能长期显示“思考中”。
- **解决**：转发推理与工具生命周期状态，增加 15 秒心跳；日志按 task ID 记录 backend、Codex 事件和退出结果。
- **教训**：长任务协议不能只传最终正文；至少要有接收确认、阶段状态、心跳与可关联的服务端日志。

## 2026-05-14 — Commit & Push 全流程测试（含 worktree）

- **目的**：验证完整的 worktree 创建 → commit → rebase → merge → push → 清理流程
- **结果**：流程正常（commit ID 见本条目提交）

## 2026-05-14 — Commit 流程测试

- **目的**：验证 Claude Code 的完整 git commit 流程是否正常工作
- **结果**：基线测试 110 个全部通过，流程正常

## 2026-04-25 — 流式 Markdown 渲染与历史面板边界 (`6fda6f3`, `61dbc19`)

- **问题**：真流式 + 打字机后，生成中仍用 `setText()` 展示 accumulated 文本，Markdown 只有结束后才渲染；
  历史面板挂在 messages 区上也容易覆盖或挤压聊天固定控件。
- **修复**：
  - `6fda6f3`：streaming 阶段改为节流 `MarkdownRenderer.render()`，每 120ms 最多渲染一次，
    最终 flush 后再做完整渲染，避免每个 22ms 打字机 tick 都重渲染。
  - `61dbc19`：历史面板挂到 chat container，并按 header/token bar/input area 计算 inset；
    `.ai-daily-chat-container` 增加 `position: relative` 作为 overlay 定位上下文。
- **教训**：流式 UI 不能只看文本到达速度，Markdown/布局也要在 streaming 过程中逐步成立；
  但富文本渲染要节流并串行化，避免异步渲染乱序或性能抖动。

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
