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

- **HarnessView** — 项目卡片 + 模式按钮 + 状态摘要（鸡肋）+ 开始按钮
- **Chat View 历史面板** — 平铺时间线列表，无分组
- **Chat View 欢迎页** — 模式网格卡片

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

### 2.1 架构定位

**Workspace Studio 不是独立的侧边栏 View，而是 Chat View 内部的一个页面。**

入口方式：
- Chat View 欢迎页顶部放一个 Studio 入口按钮（如 masthead 旁的图标）
- Chat View 顶栏也可加一个小图标，随时切换到 Studio
- 不注册新的 Obsidian View Type，不占用额外的侧边栏 ribbon icon

用户心智模型：Chat View 有两个页面——**对话**和 **Studio**，通过按钮切换。

### 2.2 命名与代码组织

| 项目 | 说明 |
|------|------|
| 文件名 | `src/workspace-studio.ts`（渲染逻辑，由 Chat View 调用） |
| CSS 前缀 | `.ws-studio-*` |
| 入口 | Chat View 内部切换，无独立 View Type |

旧 `harness-view.ts` 在 Studio 完成后移除。过渡期保留兼容。

### 2.3 UI 布局

Studio 页面在 Chat View 的消息区域内渲染（替换欢迎页或对话内容）：

```
┌──────────────────────────────────┐
│  ← 返回对话    Workspace Studio  │  ← Chat View 顶栏变化
├──────────────────────────────────┤
│                                  │
│  ┌───────┐ ┌───────┐ ┌───────┐  │
│  │ todo  │ │ai-eng │ │ai-prep│  │  ← Workspace 选择器（横滑）
│  │  ●    │ │       │ │  + ✏️ │  │     ● = 当前活跃
│  └───────┘ └───────┘ └───────┘  │     + = 新建 workspace
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
│  ┌─────────────────────────────┐ │
│  │     ▶ 开始新对话              │ │  ← 进入 Chat View（无 mode）
│  └─────────────────────────────┘ │
└──────────────────────────────────┘
```

**注意**：不再有"状态摘要"区域（原 HarnessView 的 PROGRESS.md + Inbox 计数已移除）。

### 2.4 交互流程

| 操作 | 行为 |
|------|------|
| 点击 Workspace 卡片 | 切换活跃 workspace，刷新 modes + recent |
| 长按/右键 Workspace 卡片 | 弹出菜单：编辑、归档、删除 |
| 点击 "+" 卡片 | 打开新建 Workspace 表单 |
| 点击 Mode 卡片 | 切回对话页 + 注入 mode context |
| 点击 Quick Mode (⚡) | 切回对话页 + 注入 mode + 自动发送 prompt |
| 点击历史条目 | 恢复该对话 |
| 点击"查看全部" | 展开完整历史面板，预筛选当前 workspace |
| "开始新对话" | 切回对话页，设 workspace 但不选 mode |
| "返回对话" | 切回当前对话或欢迎页 |

### 2.5 Workspace 选择器

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

活跃 workspace 有视觉高亮（accent 边框 + 圆点标记）。末尾有 "+" 卡片用于新建。

---

## Phase 3: Workspace 设置 / 编辑

### 3.1 新建 Workspace

点击 "+" 卡片弹出表单（内联在 Studio 页面内，或用 Obsidian Modal）：

```
┌──────────────────────────────────┐
│  新建 Workspace                   │
│                                  │
│  名称: [________________]        │
│                                  │
│  ┌─────────────────────────────┐ │
│  │  创建                        │ │
│  └─────────────────────────────┘ │
└──────────────────────────────────┘
```

**后端操作**：
1. 在 `harnessProjectsFolder` 下创建文件夹 `{name}/`
2. 创建空的 `modes.md`（带默认模板）
3. 在 `_INDEX.md` 表格中添加一行
4. 刷新 Studio 显示

### 3.2 编辑 Workspace

点击 Workspace 卡片上的 ✏️ 或长按菜单"编辑"，进入编辑视图：

```
┌──────────────────────────────────┐
│  ← 返回 Studio                   │
│                                  │
│  ✏️ 编辑: todo                    │
│                                  │
│  MODES ─────────────────────     │
│                                  │
│  📋 主模式                        │
│    Prompt: [多行编辑区...]         │
│    Files: file1.md, file2.md [+] │
│    Actions:                      │
│      · 整理笔记 [删除]             │
│      · [+ 添加 Action]           │
│                                  │
│  🌄 每日回顾                      │
│    Prompt: [多行编辑区...]         │
│    ...                           │
│                                  │
│  [+ 添加新 Mode]                  │
│                                  │
│  ──────────────────────────      │
│  ⚠️ 危险区域                      │
│  [归档 Workspace] [删除 Workspace]│
└──────────────────────────────────┘
```

**后端操作**：
- 编辑 = 重写 `modes.md`（YAML block + `## {id}` sections）
- 添加/删除 mode = 修改 YAML block + 对应 section
- 添加 files = 支持 file picker（Obsidian `FuzzySuggestModal`）
- 归档 = 修改 `_INDEX.md` 中该行的 status 列
- 删除 = 从 `_INDEX.md` 移除行（文件夹保留，对话保留）

### 3.3 Mode 模板

新建 Workspace 或添加 Mode 时提供预设模板：

```yaml
- id: default
  label: 默认
  emoji: "💬"
  files: []
  actions: []
```

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

### 第二批：Workspace Studio 页面

1. 创建 `src/workspace-studio.ts`（渲染逻辑）
2. Chat View 集成：添加 Studio 入口按钮 + 页面切换逻辑
3. Workspace 横滑选择器
4. Mode 卡片网格（复用欢迎页样式）
5. Recent 对话列表（读取该 workspace 的 sessions）
6. 移除旧 HarnessView 的 progress/inbox 状态区域
7. CSS

涉及文件：
- `src/workspace-studio.ts`（新建）
- `src/chat-view.ts` — 集成 Studio 切换
- `styles.css` — Studio 样式

### 第三批：Workspace 设置 / 编辑

1. 新建 Workspace 表单（创建文件夹 + modes.md + _INDEX.md 行）
2. 编辑 Workspace 视图（mode 的 prompt/files/actions 可视化编辑）
3. `modes.md` 序列化器（将 UI 编辑结果写回 YAML + sections 格式）
4. 归档/删除功能

涉及文件：
- `src/workspace-studio.ts` — 编辑 UI
- `src/harness-view.ts` — 复用 `parseModesFromContent()`，新增 `serializeModesToContent()`

### 第四批：收尾

1. 欢迎页 Studio 入口按钮
2. Chat View harness banner 显示 workspace 名
3. 旧 HarnessView 移除（或保留为 deprecated redirect）
4. 文档更新（CLAUDE.md、README.md）

---

## 与现有计划的关系

- **取代** `feature-workspace-dashboard.md` 的 Phase 1（重命名）和 Phase 2（进度增强）
- Phase 3（路线图）和 Phase 4（知识图谱）可作为 Studio 的后续扩展 Tab
- 不影响其他计划（Feed、语义搜索等）
