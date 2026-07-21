# 测试指南

## Codex Proxy 长任务状态

1. 在移动端启用代理模式，并将 CLI 后端设为 Codex。
2. 发送一个需要推理或工具调用的请求。
3. 确认等待区会依次显示“Codex 已接收请求”、推理状态，并且至少每 15 秒刷新一次处理中状态。
4. 确认工具调用在开始时出现、完成后变为成功或失败，最终回复正常呈现。
5. 在服务端日志确认同一 task ID 包含 backend、Codex 事件类型和最终退出状态。
6. 确认新任务在数秒内出现 `thread.started`，避免 Codex 因等待未关闭的 stdin 而停在启动阶段。

## Codex 模型选择

1. 将 CLI 后端设为 Codex，确认不显示 Claude Code 模型和推理强度，只显示 Codex 模型、推理强度和权限。
2. 确认模型列表包含账户默认、GPT-5.6 Sol/Terra/Luna 和 GPT-5.3 Codex。
3. 分别选择账户默认和一个 GPT-5.6 模型发送新消息。
4. 分别在桌面端和 Proxy 选择一个模型支持的推理强度，确认请求成功；Proxy 的 Codex `thread/start`/`thread/resume` 参数应包含 `config.model_reasoning_effort`。
5. 在 Proxy 日志确认 task 的 `model=` 与选择一致，并确认回复完成。

## Claude Code 模型与推理强度

1. 将 CLI 后端设为 Claude Code，确认不显示 Codex 模型、推理强度和权限。
2. 配置 Claude Code 模型别名和一个受支持的推理强度，分别通过桌面端和 Proxy 发送消息。
3. 确认两端 Claude CLI 均收到 `--model` 和 `--effort`；选择“CLI 默认”时不传 `--effort`。

## Codex Proxy 历史与续问

1. 在 Claude 或本地会话中先完成至少一轮对话，再切换到远端 Codex Proxy。
2. 发送一个依赖前文的问题，确认 Codex 能引用切换前的历史。
3. 紧接着发送第二条消息，确认 app-server 通过 `thread/resume` 恢复相同 Codex thread ID。
4. 在同一聊天中从 Claude Proxy 切换到 Codex，确认不会把 Claude session ID 传给 Codex；首次切换应依次执行 `thread/start`、`thread/inject_items`、`turn/start`，不能把历史拼接进首轮 prompt。
5. 在历史 assistant 消息中放入一个随机标记，当前问题只询问该标记；确认 Codex 能从原生 thread 历史准确返回它。

## Codex Proxy Obsidian MCP

1. 通过远端 Codex Proxy 发送“调用 list_notes 列出 vault 根目录文件（folder 传空字符串）”。
2. 确认流中出现 `mcp_tool_call`，服务名为 `obsidian_vault`、工具名为 `list_notes`，且 Codex 不再声称没有 Obsidian 工具。
3. 确认工具能通过插件 API 或文件系统回退读取 vault，并返回实际文件列表。
4. 当知识库文件夹仅配置为 `KB` 时，分别用 `Wiki/topic.md` 与 `KB/Wiki/topic.md` 调用 `read_note`，确认两者读取同一文件；API 后端与文件系统回退结果应一致。

## 微信读书 Skill

1. 运行 Codex app-server `skills/list`，确认 Vault 工作目录下存在 enabled 的 `weread-library`，且依赖 `obsidian_vault`。
2. 在未配置 Key 的 MCP 进程调用 `tools/list`，确认仍注册 `weread_api`；调用时应返回 Cortex 配置提示。
3. 在 Cortex 启用微信读书并配置 Key，通过 Proxy 新建 Codex thread，确认 `weread_api` 可用且不会在日志中输出 Key。
4. 请求“查看我的微信读书书架”，确认 Codex 隐式触发 skill，并使用 `/shelf/sync`，而不是声称没有微信读书能力。

## Codex 非交互安全边界

1. 从没有 `codexPermissionMode` 字段的旧版 `data.json` 升级，确认设置自动迁移为“Vault 可写”。
2. 在“只读”权限下要求 Codex 用 Shell 创建临时文件，确认返回只读文件系统错误且不会等待审批。
3. 确认只读模式暴露 Vault 查询工具，以及 podcast_*、fetch_feeds、fetch_rss、weread_api 等读取型工具。
4. 切换“Vault 可写”，确认额外暴露 create_note、append_to_note、edit_note、update_frontmatter。
5. 两种模式均不得暴露 delete_note、rename_note；Feed、播客和微信读书应保持可用。

## 运行测试

```bash
npm test          # 单次运行
npm run test:watch # 监听模式
```

工具权限策略由 `agent-tool-policy.json` 统一维护；`src/tool-policy.test.ts` 会验证工具名存在、破坏性工具未进入白名单，以及 Claude Code 未开放 Bash/Write/Edit。

## 测试文件

| 文件 | 覆盖范围 |
|------|---------|
| `src/anthropic-sse.test.ts` | SSE 解析与 ApiResponse 组装 |
| `proxy-server/src/codex-app-server.test.ts` | Codex 原生历史 item 映射与 JSON-RPC 请求序列化 |
| `src/reasoning-effort.test.ts` | 桌面 Claude/Codex 推理强度 CLI 参数 |
| `proxy-server/src/reasoning.test.ts` | Proxy Claude 参数与 Codex app-server config 映射 |
| `src/chat-view.test.ts` | Chat View 头部更多菜单显示条件 |
| `src/feeds.test.ts` | timeDecay, socialBoost, detectBursts, scoreRelevance |
| `src/chat-session.test.ts` | newSessionId, titleFromMessages, isValidChatSession, shouldPruneToday |
| `src/markdown-normalize.test.ts` | Codex LaTeX 分隔符转 Obsidian MathJax，代码区域保持原样 |
| `src/vault-guide.test.ts` | Vault 参考模板生成共享 `CLAUDE.md` 与 Codex `AGENTS.md` 入口 |
| `src/vault-tools.test.ts` | parseFrontmatter, serializeFrontmatter, findHeadingRange |
| `mcp-server/src/knowledge-path.test.ts` | 单一逻辑知识库根路径映射、完整路径兼容与多根目录防歧义 |
| `src/image-tools.test.ts` | extractLocalImageRefs（wikilink/markdown 图片解析、去重、过滤） |
| `src/auto-tagger.test.ts` | parseTaggingResponse（JSON 解析、容错、字段过滤） |

## 手动测试清单（UX 功能）

### 对话头部菜单
- [ ] 欢迎页初始状态下右上角“更多”按钮隐藏
- [ ] 普通自由对话发送首条消息后右上角“更多”按钮显示
- [ ] 从 Workspace Studio 或 Harness 模式开始新对话、尚未发送消息时右上角“更多”按钮显示
- [ ] 重新加载历史对话后右上角“更多”按钮显示
- [ ] 点击新对话回到欢迎页后右上角“更多”按钮再次隐藏

### Prompt 模板
- [ ] 输入 `/` 弹出模板列表
- [ ] 输入 `/翻` 过滤出翻译相关模板
- [ ] 上下键导航，Enter 选择模板
- [ ] Esc 关闭弹窗
- [ ] 选择模板后文本填入输入框
- [ ] 设置中可添加/编辑/删除自定义模板

### 笔记引用可点击
- [ ] AI 回复中 `[[已存在笔记]]` 显示为蓝色可点击链接
- [ ] 点击链接跳转到对应笔记
- [ ] `[[不存在笔记]]` 显示为灰色不可点击
- [ ] 代码块和行内代码中的 `[[]]` 不被处理

### 代码块复制
- [ ] 鼠标悬停代码块时出现复制按钮
- [ ] 点击复制按钮，代码复制到剪贴板
- [ ] 按钮短暂显示为"已复制"状态

### 回复保存到 Inbox
- [ ] 不选择文字时点击回复右上角图钉，整条回复保存到 Inbox
- [ ] 选择同一条回复中的部分文字后点击图钉，仅选中文字保存到 Inbox，并显示“已保存选中内容”提示
- [ ] 桌面端选中文字后右键，菜单包含“保存选中内容到 Inbox”和“复制选中内容”，两项均可正常执行
- [ ] 移动端长按选择文字后，若系统 WebView 支持上下文菜单事件，菜单包含“保存选中内容到 Inbox”
- [ ] 选区跨越多条消息时点击图钉，回退为保存当前整条回复
- [ ] 在移动端长按选择回复文字后点击图钉，选区不会因点击按钮而丢失

### 数学公式渲染
- [ ] Codex 回复中的 `\\[...\\]` 块级公式按数学公式渲染，不显示裸方括号
- [ ] Codex 回复中的 `\\(...\\)` 行内公式按数学公式渲染，不显示裸圆括号
- [ ] 行内代码和 fenced code 中的上述字符保持原样
- [ ] 重新打开旧对话后，旧消息中的公式同样正常渲染

### 笔记 CRUD 工具
- [ ] 对话中让 Claude 创建新笔记（`create_note`），验证文件和 frontmatter 正确生成
- [ ] 让 Claude 编辑已有笔记的某个段落（`edit_note` search_replace 模式）
- [ ] 让 Claude 按标题替换整个 section（`edit_note` heading 模式）
- [ ] 让 Claude 重命名笔记（`rename_note`），验证反向链接更新
- [ ] 让 Claude 删除笔记（`delete_note`），第一次应返回预览确认，第二次才执行
- [ ] 让 Claude 更新 frontmatter（`update_frontmatter`），验证字段设置和删除
- [ ] 尝试创建已存在的笔记路径，应返回错误
- [ ] 尝试删除不存在的笔记，应返回错误

### 知识图谱感知
- [ ] 让 Claude 查询某笔记的双向链接（`get_links`），验证 outlinks 和 backlinks 正确
- [ ] 查询不存在的笔记路径，应返回错误
- [ ] 查询没有链接的笔记，应返回空列表提示

### 本地图片识别
- [ ] 笔记中引用 `![[photo.png]]` 后发送消息，Notice 显示"已附带 1 张图片"
- [ ] 引用多张图片（超过上限），Notice 提示跳过原因
- [ ] 引用不存在的图片文件，Notice 提示"文件未找到"
- [ ] 引用不支持的格式（如 .pdf），不被提取
- [ ] 关闭"本地图片识别"设置后，图片不被发送
- [ ] 不含图片引用的消息行为不变

### 自动标注
- [ ] 在设置中开启"自动标注"，在 Raw/ 文件夹创建新笔记，等待 5 秒后检查 frontmatter 是否生成 tags 和 summary
- [ ] 已标注的笔记（frontmatter 含 `auto-tagged: true`）不会被重复标注
- [ ] 修改已标注笔记不会触发重复标注
- [ ] 监控文件夹设置为 `Raw`，在 Wiki/ 创建笔记不会触发标注
- [ ] 关闭"自动标注"开关后，新建笔记不会触发标注
- [ ] 内容过短（< 50 字符正文）的笔记不会触发标注
- [ ] 标签优先复用 vault 中已有的标签体系

### 知识整理 Agent
- [ ] 命令面板执行「整理知识库」，Notice 显示扫描进度和每篇笔记处理状态
- [ ] Raw/ 中未标记 `organized: true` 的笔记被处理，处理后标记更新
- [ ] 已标记 `organized: true` 的笔记不会被重复处理
- [ ] 整理结果在 Wiki/ 中创建新条目或更新已有条目，含 tags + wiki-link
- [ ] 每次最多处理 5 篇笔记
- [ ] 没有待整理笔记时提示"没有找到待整理的笔记"
- [ ] 未配置 API Key 时提示配置

### 对话知识蒸馏
- [ ] 聊天侧边栏显示蒸馏按钮（sparkles 图标）
- [ ] 有足够对话内容时点击蒸馏，Notice 显示进度
- [ ] 蒸馏完成后在对话中显示蒸馏结果（创建/更新了哪些条目）
- [ ] 对话内容太少时（< 2 条消息）提示无法蒸馏
- [ ] 正在加载时点击蒸馏，提示等待

### 主题兼容
- [ ] 切换不同主题（Minimal/Things/Blue Topaz），UI 颜色正常
- [ ] Feed badge 颜色使用 CSS 变量而非硬编码

## 测试配置

- 框架: vitest
- obsidian 模块通过 `src/__mocks__/obsidian.ts` mock
- 配置文件: `vitest.config.ts`（设置 obsidian alias）
