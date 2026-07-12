# Feed 系统增强：复用 Harness Modes + 开放资讯工具给 Agent

> 状态：⬜ 待开始

## 核心思路

不再单独做 Feed 增强功能，而是：
1. **复用现有 Harness modes 机制** — 用户在 modes.md 中定义 "feed" mode，自定义 prompt 和上下文
2. **把资讯抓取能力封装为 tool** — 让 Agent（API 模式和 Claude Code 模式）都能调用
3. 用户通过 mode 的 prompt 指导 Agent 如何使用这些工具生成 Feed

这样实现最小化，复用已有架构，同时给用户最大灵活度。

## 需要做的事

### 第 1 步：封装资讯抓取 tool

把 `feeds.ts` 的 `fetchAllFeeds()` 能力包装为工具。建议提供两个粒度：

**Tool 1: `fetch_feeds`（批量抓取 + 评分）**

```typescript
{
  name: "fetch_feeds",
  description: "从配置的订阅源（RSS/HN/Reddit/GitHub Trending/Podcast）批量抓取最新文章，自动评分排序去重。返回结构化文章列表。",
  parameters: {
    topics: { type: "string", description: "关注主题（逗号分隔），用于相关性评分" },
    max_articles: { type: "number", description: "返回最大文章数（默认 20）" },
    sources: { type: "string", description: "限定源名称（逗号分隔），留空使用所有配置源" },
    category: { type: "string", description: "按分类筛选：research/engineering/community/tools/podcast" },
  }
}
```

实现：调用现有 `fetchAllFeeds()`，传入 topics 进行评分，返回 JSON 格式的文章列表（title, url, source, summary, score）。

**Tool 2: `fetch_rss`（单源抓取，更灵活）**

```typescript
{
  name: "fetch_rss",
  description: "抓取指定 URL 的 RSS/Atom feed 内容，返回文章列表。可用于抓取任意 RSS 源。",
  parameters: {
    url: { type: "string", description: "RSS/Atom feed URL", required: true },
    limit: { type: "number", description: "返回最大条目数（默认 10）" },
  }
}
```

实现：复用 `feeds.ts` 中的 `parseRss()` 逻辑。

### 第 2 步：注册到 tool-definitions.ts

在 `src/tool-definitions.ts` 中新增 `FEED_TOOL_DEFS`，格式与现有 `TOOL_DEFS`、`PODCAST_TOOL_DEFS` 一致。

### 第 3 步：在 claude.ts 中注册工具

参照 `PODCAST_TOOLS` 的模式，在 `ClaudeClient` 构建工具列表时加入 Feed 工具。可以用一个 setting 控制是否启用（如复用 feed 相关设置）。

### 第 4 步：实现 tool executor

在 `chat-view.ts` 的 tool executor 中添加 `fetch_feeds` 和 `fetch_rss` 的处理逻辑，调用 `feeds.ts` 的现有函数。

### 第 5 步：MCP Server 注册（Claude Code 模式）

在 `mcp-server/src/index.ts` 中注册同名工具，通过 Plugin API Server 转发请求（与 vault 工具同模式），或直接在 MCP server 中实现（feed 抓取不依赖 Obsidian API，可直接用 fetch）。

### 第 6 步：用户配置 mode

用户在 modes.md 中配置 feed mode 示例：

```yaml modes
- id: feed
  label: 生成 Feed
  emoji: "📰"
  files:
    - [[Feed/Feed-latest]]
```

```markdown
## feed

你是一个信息策展助手。使用 fetch_feeds 工具获取最新资讯，结合我的知识库上下文，生成一份精选 Feed。

要求：
- 使用 fetch_feeds 获取最新文章，关注主题：RAG, Agent, 多模态
- 用 search_vault 检查哪些内容我已经知道，避免推荐旧闻
- 按重要程度排序，每篇给出一句话摘要
- 输出为 markdown，带 frontmatter（date, type: feed）
- 用 create_note 保存到 Feed/ 文件夹
```

## 需修改的文件

| 文件 | 改动 |
|------|------|
| `src/tool-definitions.ts` | 新增 `FEED_TOOL_DEFS` |
| `src/feeds.ts` | 导出 `parseRss()` 或新增 `fetchSingleRss()` 供 tool 调用 |
| `src/claude.ts` | 注册 feed tools 到工具列表 |
| `src/chat-view.ts` | tool executor 添加 feed 工具处理 |
| `mcp-server/src/index.ts` | 注册 MCP 工具 |

## 不需要做的事

- ~~settings 中加 feedCustomPrompt~~ → modes.md 里写 prompt
- ~~settings 中加 feedScoringMode~~ → Agent prompt 中指定评分偏好
- ~~单独的 generateAgentFeed 函数~~ → Agent 用 tool 自主完成
- ~~feedPromptNotePath~~ → modes.md 的 files 字段已支持注入文件

## 优势

1. **零新 UI** — 复用 Harness modes 面板，用户直接点 mode 按钮
2. **灵活度高** — prompt 完全由用户控制，想抓什么、怎么总结都可以
3. **两种模式通用** — API 模式用 tool_use，Claude Code 模式用 MCP tool
4. **渐进式** — 先做 Tool 1（fetch_feeds），够用后再考虑 Tool 2

## 风险

1. **API token 消耗** — feed 抓取本身不耗 token，但 Agent 需要处理大量文章文本。可在 tool 返回时截断 summary 长度
2. **requestUrl 限制** — `feeds.ts` 使用 Obsidian 的 `requestUrl`，MCP server 需改用 node fetch（已有先例）
3. **抓取失败** — 现有 `fetchAllFeeds` 已有错误处理和超时，tool 可直接复用
