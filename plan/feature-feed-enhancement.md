# Feed 系统增强：自定义 Prompt + 可调范围 + Agent 自主获取

> 状态：⬜ 待开始
> 依赖：代理模式（Agent 获取部分）

## 概述

将 Feed 系统从固定源、固定 Prompt 的管道，升级为灵活可配置的系统：

1. **自定义 Prompt** — 用户可编写自己的 Feed 生成指令（设置字段或 vault 笔记文件）
2. **可调范围** — 不限于预设的 RSS/HN/Reddit，用户可指定任意主题和关键词
3. **Agent 自主获取** — 在代理模式（Claude Code）下，Agent 自主搜索互联网获取最新内容，不依赖预设源 API

## 设计决策

### Prompt 来源优先级

1. vault 笔记文件（`feedPromptNotePath` 指定路径，适合长 prompt）
2. 设置字段（`feedCustomPrompt`，快速编辑）
3. 硬编码默认值（当前行为）

### 关键词评分模式

新增 `feedScoringMode` 设置：
- `ai-focused`（默认）：当前行为，使用内置 AI 关键词
- `custom-only`：仅使用用户自定义关键词评分
- `hybrid`：两者结合

### Agent 模式限制

- 仅在 `proxyEnabled === true` 时可用（使用 Claude Code 订阅额度）
- API 模式不支持（`callClaudeSimple` 是单轮调用，无工具循环）
- Agent 通过 `web_search` + `web_fetch` 自主搜索，通过 MCP 工具搜索 vault

## 新增设置

```typescript
feedCustomPrompt: string          // 自定义 system prompt（默认 ""）
feedPromptNotePath: string        // vault 笔记路径作为 prompt 来源（默认 ""）
feedUserKeywords: string[]        // 自定义评分关键词（默认 []）
feedScoringMode: "ai-focused" | "custom-only" | "hybrid"  // 默认 "ai-focused"
feedAgentMode: boolean            // 启用 Agent 自主获取（默认 false）
podcastCustomPrompt: string       // 播客 Feed 自定义 prompt（默认 ""）
```

## 实施步骤

### 第 1 步：设置扩展（`src/settings.ts`）

添加上述字段、默认值和 UI 控件：
- `feedCustomPrompt`：TextArea（参照 `autoTagPrompt` 样式）
- `feedPromptNotePath`：Text 输入
- `feedUserKeywords`：TextArea（逗号分隔）
- `feedScoringMode`：Dropdown
- `feedAgentMode`：Toggle（描述注明需要代理模式）

### 第 2 步：Prompt 解析（`src/feed-generator.ts`）

新增 helper：

```typescript
async function resolveFeedPrompt(
  app: App,
  settings: AIDailyChatSettings,
  fallback: string
): Promise<string>
```

在 `generateFeed()` 和 `generatePodcastFeed()` 中替换硬编码 prompt。

### 第 3 步：可调关键词评分（`src/feeds.ts`）

参数化 `scoreRelevance()` 和 `detectBursts()`：

```typescript
interface ScoringConfig {
  userTopics: string[];
  customKeywords: string[];
  scoringMode: "ai-focused" | "custom-only" | "hybrid";
}
```

- `custom-only` + 有自定义关键词 → 动态构建 regex
- `hybrid` → 合并内置和自定义
- `ai-focused` → 当前行为

### 第 4 步：Agent 自主获取（`src/feed-generator.ts`）

新增 `generateAgentFeed()` 函数：
1. 解析自定义 prompt
2. 构建用户消息（主题 + 关键词 + 输出格式 + 去重上下文）
3. 创建临时 `ClaudeClient` 实例，通过 `proxyChat()` 调用 Claude Code
4. 收集 Agent 输出，写入 vault

### 第 5 步：模式分发

在 `generateFeed()` 入口根据设置分发：

```typescript
if (settings.feedAgentMode && settings.proxyEnabled && settings.proxyUrl) {
  return generateAgentFeed(app, settings, onProgress, existingContent);
} else {
  // 现有 fetchAllFeeds + callClaudeSimple 管道
}
```

### 第 6 步：文档更新

更新 CLAUDE.md、README.md。

## 需修改的文件

| 文件 | 改动 |
|------|------|
| `src/settings.ts` | 新增设置字段、默认值、UI 控件 |
| `src/feed-generator.ts` | Prompt 解析、Agent 获取函数、模式分发 |
| `src/feeds.ts` | 参数化评分函数 |
| `src/main.ts` | 传递新设置（如有接口变化） |

## 风险与注意事项

1. **Proxy 可用性** — Agent 模式依赖代理服务器运行，不可用时应回退传统管道并通知用户
2. **自定义关键词 regex 注入** — 需转义特殊字符
3. **Agent token 消耗** — 多轮工具调用消耗更多订阅额度，需在 UI 说明
4. **向后兼容** — 所有新设置默认值保持当前行为，无需迁移
5. **Agent 输出质量** — prompt 需明确限制搜索次数和输出格式
