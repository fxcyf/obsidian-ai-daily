# 知识报告：定期 AI 总结学习进展

> 状态：⬜ 待开始

## 概述

定期（周/月）AI 生成报告，总结用户的学习进展、知识增长和薄弱领域。整合 Feed、日记、Wiki、对话历史等多源数据，帮助用户理解自己的知识发展轨迹。

## 架构设计

### 新增模块

| 文件 | 职责 |
|------|------|
| `src/vault-stats.ts` | 纯数据采集：扫描 vault 变化、计算统计指标（无 AI 调用，方便测试） |
| `src/knowledge-report.ts` | 报告编排：采集 → 健康检查 → AI 总结 → 写入笔记 |

### 数据流

```
vault-stats.ts                 knowledge-agent.ts
collectVaultChanges() ─────┐   wikiHealthCheck() ──┐
computeGrowthMetrics() ────┤                        │
                           ▼                        ▼
                    knowledge-report.ts
                    generateKnowledgeReport()
                           │
                           ▼ callClaudeSimple()
                    Report-2026-07-11.md
```

### 报告触发方式

1. **手动命令** — 命令面板「生成知识报告」，弹窗选择时间范围
2. **启动检查** — 插件启动时检查是否到期，显示通知提醒生成（不自动运行）

## 数据采集（`vault-stats.ts`）

### 核心数据结构

```typescript
interface VaultChanges {
  period: { start: Date; end: Date };
  newNotes: { path: string; created: number }[];
  modifiedNotes: { path: string; modified: number }[];
  newTags: string[];
  newLinks: { source: string; target: string }[];
  feedsConsumed: { path: string; date: string }[];
  dailyNotes: { path: string; date: string; wordCount: number }[];
  conversationCount: number;
  distilledWikiEntries: string[];
}

interface GrowthMetrics {
  notesAdded: number;
  notesModified: number;
  wordsWritten: number;
  tagsGrowth: number;
  linksGrowth: number;
  topActiveAreas: { folder: string; activity: number }[];
}
```

### 数据来源

| 数据 | 来源 | 方法 |
|------|------|------|
| 新建/修改笔记 | `app.vault.getMarkdownFiles()` | `file.stat.ctime` / `mtime` 筛选 |
| 标签 | `app.metadataCache` | `getFileCache(file)?.frontmatter?.tags` |
| 链接 | `app.metadataCache.resolvedLinks` | 对比期间内外差异 |
| Feed 笔记 | `{feedFolder}/Feed-*.md` | 日期范围筛选 |
| 日记 | `{dailyNotesFolder}/` | 文件名日期匹配 + 字数统计 |
| 对话 | `{chatHistoryFolder}/*.json` | 解析 `ChatSessionFile`，筛选 `updated` 时间 |
| Wiki 蒸馏 | `{distillTargetFolder}/` | `ctime` 在范围内的新条目 |

## 新增设置

```typescript
reportSchedule: "weekly" | "monthly" | "off"  // 默认 "off"
reportDay: number        // 周几（0-6）或每月几号（1-28），默认 1
reportModel: string      // 模型覆盖，空=使用默认，默认 ""
dailyNotesFolder: string // 日记文件夹，默认 "Daily"
```

## 实施步骤

### 第 1 步：设置扩展（`src/settings.ts`）

在「知识整理」section 后新增「知识报告」section：
- Schedule dropdown（off / weekly / monthly）
- Report day 数字输入
- Model dropdown（同 feed model 样式）
- Daily notes folder 文本输入

### 第 2 步：数据采集模块（`src/vault-stats.ts`）

导出三个核心函数：
- `collectVaultChanges(app, settings, period)` — 全量数据采集
- `computeGrowthMetrics(changes)` — 纯函数计算增长指标
- `takeVaultSnapshot(app, knowledgeFolders)` — 当前状态快照

### 第 3 步：报告生成器（`src/knowledge-report.ts`）

`generateKnowledgeReport()` 流程：
1. **scanning** — `collectVaultChanges()` 采集数据
2. **health** — `wikiHealthCheck()` 获取健康分数
3. **analyzing** — 构建结构化文本摘要
4. **ai** — `callClaudeSimple()` 生成报告
5. **write** — 写入 `{feedFolder}/Report-{date}.md`

AI System Prompt 指导 Claude 作为知识分析师：
- 总结学习主题
- 识别知识聚类（相关笔记/标签的增长模式）
- 发现知识空白（断链、孤岛、薄弱领域）
- 分析习惯模式（写作频率、主题分布变化）
- 对比 Feed 消费与知识产出
- 给出可操作建议

### 第 4 步：时间范围选择弹窗（`src/main.ts`）

参照 `FeedConfirmModal` 模式，提供：
- 最近 7 天
- 最近 30 天
- 自定义范围

### 第 5 步：注册命令和启动检查（`src/main.ts`）

- 命令：`generate-knowledge-report`「生成知识报告」
- 启动检查：`onLayoutReady` 中调用 `isReportDue()`，到期则显示通知

### 第 6 步：测试（`src/vault-stats.test.ts`、`src/knowledge-report.test.ts`）

- `computeGrowthMetrics` 各种输入组合
- 日期筛选逻辑
- 标签差异计算
- `isReportDue` 调度逻辑
- 报告 frontmatter 格式

### 第 7 步：文档更新

CLAUDE.md、README.md、TEST.md、roadmap.md

## 风险与注意事项

1. **大 vault 性能** — 使用 `app.vault.getMarkdownFiles()`（已缓存）和 `cachedRead` 避免瓶颈
2. **Token 预算** — 只发送统计摘要（标题、标签、计数），不发送笔记全文；预估 4,000-8,000 tokens/次
3. **API 费用** — 每次一轮 `callClaudeSimple` 调用，Haiku 约 $0.01-0.02
4. **日记命名约定** — 用 `YYYY-MM-DD` 模式匹配文件名，覆盖 Obsidian 常见配置
5. **无后台进程** — 仅启动时检查，不使用定时器，符合 Obsidian 插件惯例
