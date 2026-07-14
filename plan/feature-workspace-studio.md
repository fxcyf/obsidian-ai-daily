# Workspace Studio 设计方案

> 将 HarnessView 升级为 Workspace Studio，同时重构聊天历史按 Workspace 归属管理。
> 取代 [feature-workspace-dashboard.md](feature-workspace-dashboard.md) 中的 Phase 1-2。

## 核心概念

```
Workspace (项目)          ← 顶层组织单位，对应 _INDEX.md 中的一行
  ├── Modes (模式)        ← 工作方式，定义在 modes.md
  ├── Sessions (对话)     ← 归属于 workspace，mode 作为标签
  └── Settings (设置)     ← 每个 workspace 的配置
```

**关键决策：对话归属 Workspace，Mode 是标签。**

理由：
- 一次对话可能切换 mode（从"学习"到"复习"），归属 mode 需要拆分
- 用户找历史时更自然地按项目查找："上次在 ai-career-prep 里聊了什么"
- Workspace 是稳定的长期实体，Mode 是临时的工作方式

## 现状分析

### 数据层

`ChatSessionFile` 已保存 `harnessContext`（含 mode 信息），但 **没有保存 workspace/project 名**。

```ts
// 现有字段
interface ChatSessionFile {
    harnessContext?: {
        mode: { id, label, emoji, files, systemPromptAppend, actions }
        injectedFiles: { path }[]
    }
    // 缺少: workspace 归属
}
```

### UI 层

- **HarnessView** — 项目卡片 + 模式按钮 + 状态摘要 + 开始按钮
- **Chat View 历史面板** — 平铺时间线列表，无分组
- **Chat View 欢迎页** — 模式网格卡片（刚重构完）

---

## Phase 1: 对话归属 Workspace

### 1.1 数据结构变更

```ts
// chat-session.ts — 新增字段
interface ChatSessionFile {
    // ... 现有字段
    workspace?: string;     // 项目名，如 "todo", "ai-career-prep"
    modeHistory?: string[]; // 用过的 mode id 列表（按时间顺序）
}

// 持久化时机：startWithContext() 中写入 workspace
// modeHistory：每次切换 mode 时追加
```

**向后兼容**：
- `workspace` 为 `undefined` 的旧 session → 归入"未分类"组
- 可选迁移：从 `harnessContext.mode` 反推 workspace（遍历所有项目的 modes.md 匹配 mode.id）

### 1.2 写入时机

在 `chat-view.ts` 的 `startWithContext()` 中：

```ts
// 需要把 project name 传入 HarnessContext
interface HarnessContext {
    mode: HarnessMode;
    injectedFiles: { path: string }[];
    workspace?: string;  // 新增
}
```

**传入来源**：
- HarnessView `handleStart()` — 已知 `projectIndex.activeProject`
- 欢迎页模式卡片 — `buildWelcomeHarness()` 中已有 `project.name`
- 直接发消息（无 mode）— `workspace` 为 `undefined`

### 1.3 历史面板分组

当前历史面板（`openHistoryPanel()`）改为两级结构：

```
┌──────────────────────────────────┐
│  🔍 搜索对话...                   │
│                                  │
│  TODO                            │
│  ├── 每日回顾 · 今天 12:30         │
│  ├── 主模式 - 整理笔记 · 昨天       │
│  └── 查看更多 (5)                  │
│                                  │
│  AI-CAREER-PREP                  │
│  ├── 学习 - Transformer · 7月12日  │
│  └── 复习 - 注意力机制 · 7月10日    │
│                                  │
│  未分类                            │
│  ├── 关于 Obsidian 的问题 · 7月8日  │
│  └── 查看更多 (12)                 │
└──────────────────────────────────┘
```

每个条目显示：`[mode emoji] mode label - session title · 时间`

**实现**：
- `listChatSessions()` 返回的 session 列表按 `workspace` 字段分组
- 每组默认显示最近 3 条，可展开
- 搜索框跨组过滤

---

## Phase 2: Workspace Studio View

### 2.1 命名与注册

| 项目 | 旧 | 新 |
|------|-----|------|
| 文件名 | `harness-view.ts` | `workspace-studio-view.ts` |
| View Type | `ai-daily-harness` | `ai-daily-workspace-studio` |
| 命令 | `打开 Harness` | `打开 Workspace Studio` |
| CSS 前缀 | `.ai-daily-harness-*` | `.ws-studio-*` |

**兼容**：注册旧 `ai-daily-harness` View Type 做重定向到新 View。

### 2.2 UI 布局

Workspace Studio 是一个完整的 Obsidian 侧边栏 View，分三个区域：

```
┌──────────────────────────────────┐
│  ← Workspace Studio         ⚙️  │  ← 顶栏
├──────────────────────────────────┤
│                                  │
│  ┌───────┐ ┌───────┐ ┌───────┐  │
│  │ todo  │ │ai-eng │ │ai-prep│  │  ← Workspace 选择器（横滑）
│  │  ●    │ │       │ │       │  │     ● = 当前活跃
│  └───────┘ └───────┘ └───────┘  │
│                                  │
├──────────────────────────────────┤
│                                  │
│  MODES ─────────────────────     │
│  ┌────────┐ ┌────────┐          │
│  │📋 主模式│ │🌄 每日  │          │  ← 当前 workspace 的 modes
│  │        │ │  回顾  ⚡│          │     (复用欢迎页卡片样式)
│  └────────┘ └────────┘          │
│                                  │
│  RECENT ─────────────────────    │
│  📋 主模式 - 整理项目 · 2小时前    │
│  🌄 每日回顾 · 今天 08:30         │  ← 该 workspace 最近对话
│  📋 主模式 - 周计划 · 昨天         │
│  查看全部 →                       │
│                                  │
├──────────────────────────────────┤
│                                  │
│  📊 状态                          │
│  最近完成: RAG 原理笔记整理         │  ← 复用现有 PROGRESS.md 解析
│  待处理: Inbox 3 条                │
│                                  │
│  ┌─────────────────────────────┐ │
│  │     ▶ 开始新对话              │ │  ← 进入 Chat View（无 mode）
│  └─────────────────────────────┘ │
└──────────────────────────────────┘
```

### 2.3 交互流程

| 操作 | 行为 |
|------|------|
| 点击 Workspace 卡片 | 切换活跃 workspace，刷新 modes/recent/status |
| 点击 Mode 卡片 | 跳转 Chat View + 注入 mode context（同现有逻辑） |
| 点击 Quick Mode (⚡) | 跳转 Chat View + 注入 mode + 自动发送 prompt |
| 点击历史条目 | 恢复该对话（在 Chat View 中打开） |
| 点击"查看全部" | 打开完整历史面板，预筛选当前 workspace |
| 点击 ⚙️ | 打开 Workspace 设置（见 Phase 3） |
| "开始新对话" | 跳转 Chat View，设 workspace 但不选 mode |

### 2.4 Workspace 选择器

水平滚动的卡片列表，数据源为 `_INDEX.md` 表格：

```ts
interface WorkspaceCard {
    name: string;       // 项目名
    status: string;     // "active" | "paused" | ...
    isActive: boolean;  // 当前活跃
    sessionCount: number; // 该 workspace 下的对话数量
    lastActive: string;   // 最后活跃时间
}
```

活跃 workspace 有视觉高亮（accent 边框 + 圆点标记）。

---

## Phase 3: Workspace 设置（未来扩展）

> 不在第一版实现，但预留 UI 入口（⚙️ 按钮）。

可能的功能：
- **编辑 modes.md** — 可视化编辑 mode 的 prompt、files、actions
- **管理文件关联** — 拖拽添加/移除 mode 的 injected files
- **归档/删除 workspace** — 软删除，对话保留
- **导出** — 导出该 workspace 下所有对话为 Markdown

---

## 实施计划

### 第一批：数据层 + 历史分组

1. `ChatSessionFile` 新增 `workspace` 字段
2. `HarnessContext` 新增 `workspace` 字段
3. 写入链路：HarnessView / 欢迎页 → `startWithContext()` → `persistSession()`
4. 历史面板改为按 workspace 分组显示
5. 旧 session 迁移工具（可选，从 harnessContext 反推）

涉及文件：
- `src/chat-session.ts` — 类型 + 持久化
- `src/harness-view.ts` — 传入 workspace name
- `src/chat-view.ts` — startWithContext 写 workspace、历史面板分组
- `src/settings.ts` — HarnessContext 类型

### 第二批：Workspace Studio View

1. 创建 `src/workspace-studio-view.ts`
2. Workspace 横滑选择器
3. Mode 卡片网格（复用欢迎页样式）
4. Recent 对话列表（读取该 workspace 的 sessions）
5. 状态摘要（复用现有 PROGRESS.md 解析逻辑）
6. 注册新 View Type，旧 ID 兼容重定向
7. 更新命令注册、CSS

涉及文件：
- `src/workspace-studio-view.ts`（新建）
- `src/main.ts` — 注册 view + 命令
- `styles.css` — Workspace Studio 样式
- `src/harness-view.ts` — 保留但标记 deprecated，复用解析函数

### 第三批：收尾

1. 欢迎页 mode 卡片联动（点击后记录 workspace）
2. Chat View harness banner 显示 workspace 名
3. 文档更新（CLAUDE.md、README.md）
4. 旧 HarnessView 代码清理

---

## 与现有计划的关系

- **取代** `feature-workspace-dashboard.md` 的 Phase 1（重命名）和 Phase 2（进度增强）
- Phase 3（路线图）和 Phase 4（知识图谱）可作为 Workspace Studio 的后续扩展 Tab
- 不影响其他计划（Feed、语义搜索等）
