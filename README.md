# AI Daily Chat — Obsidian Plugin

在 Obsidian 中与 AI 日报对话。打开日报，侧边栏提问，洞察写回笔记。桌面和 iOS 都能用。

## 功能

- **自动加载上下文** — 打开日报后直接提问，插件自动读取当前笔记 + 最近 N 天日报
- **AI 工具调用** — Claude 可以主动搜索 vault、读取其他笔记、把总结追加到笔记
- **移动端优先** — 针对 iPhone 设计的 UI，纯 HTTP 调用 Claude API，不依赖本地进程
- **知识沉淀** — 对话中的洞察一键写回 Obsidian，不会聊完就丢

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

Obsidian → 设置 → 第三方插件 → 启用 AI Daily Chat。

如果使用 Obsidian Sync，插件会自动同步到手机端。

## 配置

在插件设置中填写：

| 设置 | 说明 | 默认值 |
|------|------|--------|
| Anthropic API Key | Claude API 密钥 | — |
| 日报文件夹 | AI Daily 日报所在目录 | `AI-Daily` |
| 上下文天数 | 自动加载最近几天的日报 | 7 |
| 模型 | Haiku (快) / Sonnet (均衡) / Opus (强) | Haiku 4.5 |

## 使用

1. 打开一篇日报
2. 点击侧边栏的聊天图标（或命令面板搜索 "AI Daily Chat"）
3. 直接提问

Claude 可以自主调用以下工具操作你的 vault：

| 工具 | 作用 |
|------|------|
| `read_note` | 读取指定笔记 |
| `search_vault` | 按关键词搜索 vault |
| `append_to_note` | 追加内容到笔记 |
| `list_daily_notes` | 列出最近的日报 |

## 配合 ai-daily 使用

本插件是 [ai-daily](https://github.com/fxcyf/ai-daily) 的阅读伴侣：

```
ai-daily generate → 生成日报写入 Obsidian → 本插件提供阅读时的 AI 对话
```

## 技术栈

- TypeScript + Obsidian Plugin API
- Claude API（直接 HTTP 请求，无 SDK 依赖）
- tool_use 实现 vault 操作
- esbuild 构建
