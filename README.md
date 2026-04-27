# AI Knowledge Chat — Obsidian Plugin

在 Obsidian 中构建个人知识库，与 AI 对话探索你的收藏。支持桌面和 iOS。

## 功能

- **知识库管理** — 支持 Raw（原始采集）、Wiki（整理条目）、Daily（每日笔记）多文件夹结构
- **自动加载上下文** — 打开笔记后直接提问，插件自动读取当前笔记 + 最近日报 + 最近知识库笔记
- **AI 工具调用** — Claude 可以搜索、读取、创建、编辑、重命名、删除笔记并管理 frontmatter，支持按标签和文件���筛选
- **一键对话** — 命令面板「对话当前笔记」，自动总结当前打开的文章
- **移动端优先** — 针对 iPhone 设计的 UI，纯 HTTP 调用 Claude API
- **知识沉淀** — 对话中的洞察一键写回 Obsidian
- **联网搜索** — Claude 可以搜索互联网获取最新信息，抓取网页全文阅读（Anthropic 内置 web_search + web_fetch）
- **AI Feed 生成** — 多源抓取（RSS、Hacker News、Reddit、GitHub Trending），基于社交热度 + 时间衰减 + 跨源爆发检测排序，结合笔记库知识，AI 生成 trending 技术 Feed
- **Prompt 模板** — 输入框中键入 `/` 快速选择预置或自定义模板（总结要点、翻译、生成闪卡等），支持上下键导航和搜索过滤
- **笔记引用可点击** — AI 回复中的 `[[笔记名]]` 自动渲染为可点击链接，直接跳转到 Obsidian 笔记；找不到的笔记显示为灰色
- **代码块复制** — 鼠标悬停代码块时右上角出现复制按钮，一键复制到剪贴板
- **本地图片识别** — 笔记中引用的本地图片（`![[photo.png]]`、`![alt](./img.jpg)`）自动随消息发送给 Claude，支持多模态对话；可配置单次最大图片数和单图体积上限
- **笔记自动标注** — 在指定文件夹（默认 Raw/）中新建或修改笔记时，自动调用 Claude 生成 tags 和 summary 写入 frontmatter；优先复用 vault 已有标签体系，避免标签膨胀；已标注笔记不会重复处理
- **流式回复** — 桌面端走原生 fetch + SSE 真流（首字节通常 < 2s）；移动端 fetch CORS 不通时自动降级为客户端打字机回放，体验略打折但绝不报错
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
| 流式输出模式 | `auto` / `real` / `typewriter` / `off`，详见下文 | `auto` |
| 自动摘要阈值 | 估算上下文超过该值时压缩更早对话（`0` 关闭） | `90000` |
| 上下文预算 | 底部用量条的总参考值 | `200000` |
| 联网搜索 | 启用 web_search 和 web_fetch 工具 | 开启 |
| 本地图片识别 | 自动将笔记中的本地图片发送给 Claude | 开启 |
| 单次最大图片数 | 每条消息最多附带的图片数量 | 3 |
| 单图最大体积 | 超过该体积的图片将被跳过 | 3MB |
| 自动标注 | 新建/修改笔记时自动生成 tags + summary | 关闭 |
| 自动标注文件夹 | 仅对这些文件夹中的笔记自动标注 | `Raw` |
| 自定义标注 Prompt | 留空使用默认 prompt | — |
| Prompt 模板 | 自定义 `/` 快捷模板，预置 6 个常用模板 | 预置模板 |
| Feed 文件夹 | 生成的 Feed 笔记存放位置 | `Feed` |
| 关注主题 | 逗号分隔的关注主题列表 | — |
| 最大文章数 | 每次 Feed 抓取的最大文章数 | 20 |
| 订阅源 | 多类型源列表（RSS/HN/Reddit/GitHub Trending） | 预置 10 个源 |

## 流式输出模式

| 模式 | 行为 | 适用场景 |
|------|------|---------|
| `auto`（推荐） | 先尝试真流（桌面端可用），失败时静默降级为打字机 | 默认；桌面、移动统一 |
| `real` | 仅真流，失败直接报错 | 调试，定位流式问题 |
| `typewriter` | `requestUrl` 整段返回 + 客户端切片回放 | 极端兼容性需求 |
| `off` | 一次性整段，无动画 | 长输出不想等动画 |

> 注：真流式依赖 `anthropic-dangerous-direct-browser-access: true` 请求头才能在 Obsidian (Chromium) 内绕过 CORS。Anthropic 官方明确支持该用法。

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
| `create_note` | 创建新笔记，支持 frontmatter，自动创建中间目录 |
| `edit_note` | 编辑笔记（按标题/行号/原文匹配定位替换） |
| `rename_note` | 重命名/移动笔记，自动更新反向链接 |
| `delete_note` | 删除笔记（两步确认，移到回收站） |
| `update_frontmatter` | 修改笔记的 YAML frontmatter（设置/删除字段） |
| `get_links` | 获取笔记的双向链接关系（outlinks + backlinks） |
| `web_search` | 搜索互联网（Anthropic 内置，需开启联网搜索） |
| `web_fetch` | 抓取指定 URL 的网页内容 |

## 内容采集建议

- **PC 端**：使用 [Obsidian Web Clipper](https://obsidian.md/clipper) 或 MarkDownload 浏览器插件
- **手机端**：通过系统分享菜单 + Obsidian URI，或 Readwise 自动同步
- **同步**：iCloud（iOS）、Obsidian Sync 或 Remotely Save 插件

## 技术栈

- TypeScript + Obsidian Plugin API
- Claude API（直接 HTTP 请求，无 SDK 依赖）
- tool_use 实现 vault 操作（支持 tag 搜索）
- esbuild 构建
