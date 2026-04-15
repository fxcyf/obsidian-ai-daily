# AI Knowledge Chat — Obsidian Plugin

在 Obsidian 中构建个人知识库，与 AI 对话探索你的收藏。支持桌面和 iOS。

## 功能

- **知识库管理** — 支持 Raw（原始采集）、Wiki（整理条目）、Daily（每日笔记）多文件夹结构
- **自动加载上下文** — 打开笔记后直接提问，插件自动读取当前笔记 + 最近日报 + 最近知识库笔记
- **AI 工具调用** — Claude 可以搜索、读取、列出和写回 vault 笔记，支持按标签和文件夹筛选
- **一键对话** — 命令面板「对话当前笔记」，自动总结当前打开的文章
- **移动端优先** — 针对 iPhone 设计的 UI，纯 HTTP 调用 Claude API
- **知识沉淀** — 对话中的洞察一键写回 Obsidian
- **AI Feed 生成** — 一键抓取 RSS 订阅源，结合笔记库已有知识，AI 生成主题汇总笔记
- **流式回复** — 在支持的环境下（桌面端等）逐段显示模型输出，失败时自动回退为整段返回
- **对话存档** — 会话自动保存为 vault 内 JSON（默认 `.ai-chat/`），「历史」中可搜索与恢复
- **上下文提示** — 底部显示估算 token 用量；超出阈值时可自动摘要早期对话以腾出上下文（可在设置中调节）

## 推荐的 Vault 结构

```
Vault/
├── Raw/          # 原始采集：网页、文章（Web Clipper 一键保存）
├── Wiki/         # 自己整理的知识条目（结构化、双链关联）
├── AI-Daily/     # 每日笔记/日报
├── Feed/         # AI 自动生成的主题 Feed
├── .ai-chat/     # （可选）插件保存的对话历史 JSON
└── ...
```

每篇采集的文章建议用 YAML frontmatter 标记：

```yaml
---
source: https://example.com/article
tags: [ai, llm, rag]
clipped: 2026-04-05
---
```

## 安装

```bash
git clone https://github.com/fxcyf/obsidian-ai-daily.git
cd obsidian-ai-daily
npm install
npm run build
```

将 `main.js`、`manifest.json`、`styles.css` 复制到你的 vault：

```bash
mkdir -p /path/to/vault/.obsidian/plugins/ai-daily-chat
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/ai-daily-chat/
```

Obsidian → 设置 → 第三方插件 → 启用 AI Knowledge Chat。

## 配置

| 设置 | 说明 | 默认值 |
|------|------|--------|
| Anthropic API Key | Claude API 密钥 | — |
| 日报文件夹 | 每日笔记所在目录 | `AI-Daily` |
| 知识库文件夹 | 逗号分隔的文件夹列表 | `Raw,Wiki` |
| 上下文天数 | 自动加载最近几天的日报 | 7 |
| 模型 | Haiku (快) / Sonnet (均衡) / Opus (强) | Haiku 4.5 |
| 对话存档目录 | 会话 JSON 保存路径 | `.ai-chat` |
| 历史保留天数 | 超过天数未更新的会话会被自动删除；`0` 表示不清理 | `30` |
| 流式输出 | 是否使用 SSE 流式（不支持时自动回退） | 开启 |
| 自动摘要阈值 | 估算上下文超过该值时压缩更早对话（`0` 关闭） | `90000` |
| 上下文预算 | 底部用量条的总参考值 | `200000` |
| Feed 文件夹 | 生成的 Feed 笔记存放位置 | `Feed` |
| 关注主题 | 逗号分隔的关注主题列表 | — |
| 最大文章数 | 每次 Feed 抓取的最大文章数 | 20 |
| RSS 订阅源 | 可自定义的 RSS 源列表 | 预置 8 个源 |

## 使用

1. 打开任意笔记
2. 点击侧边栏聊天图标（或命令面板搜索 "AI Knowledge Chat"）
3. 直接提问

**快捷操作**：
- 命令面板搜索「对话当前笔记」，自动总结当前文章并提供深入分析
- 命令面板搜索「生成 AI Feed」，或点击聊天侧边栏的「生成 Feed」按钮，自动抓取 RSS + 搜索笔记库 + AI 汇总

Claude 可以自主调用以下工具：

| 工具 | 作用 |
|------|------|
| `read_note` | 读取指定笔记全文 |
| `search_vault` | 按关键词搜索，支持文件夹和标签过滤 |
| `list_notes` | 列出指定文件夹或全部知识库的笔记 |
| `append_to_note` | 追加内容到笔记 |

## 内容采集建议

- **PC 端**：使用 [Obsidian Web Clipper](https://obsidian.md/clipper) 或 MarkDownload 浏览器插件
- **手机端**：通过系统分享菜单 + Obsidian URI，或 Readwise 自动同步
- **同步**：iCloud（iOS）、Obsidian Sync 或 Remotely Save 插件

## 技术栈

- TypeScript + Obsidian Plugin API
- Claude API（直接 HTTP 请求，无 SDK 依赖）
- tool_use 实现 vault 操作（支持 tag 搜索）
- esbuild 构建
