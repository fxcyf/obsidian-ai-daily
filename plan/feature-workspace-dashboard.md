# Workspace Dashboard 重构计划

> 将 Harness View 升级为 Workspace Dashboard，新增学习路线图、知识图谱可视化、进度追踪增强。

## 背景

当前 Harness View 功能较单一（模式选择 + 文件注入），用户希望它成为一个完整的工作台面板，提供学习路径规划、知识关系可视化和进度追踪。

## 改动范围

### Phase 1: 重命名 Harness → Workspace

涉及文件：
- `src/harness-view.ts` → `src/workspace-view.ts`
- `src/main.ts`（注册视图 ID、命令名）
- `src/chat-view.ts`（HarnessContext 引用）
- `src/system-prompt.ts`（HarnessContext type、prompt 文本）
- `src/settings.ts`（设置中的 harness 相关路径）
- `styles.css`（CSS 类名 `.harness-*` → `.workspace-*`）
- `CLAUDE.md`（架构描述）

注意事项：
- 视图 ID 变更需要处理用户已有 workspace layout 的兼容（注册旧 ID 做重定向，或直接迁移）
- `modes.md` 文件名和格式保持不变，仅 UI 标签变化

### Phase 2: 进度追踪增强

在现有 `_INDEX.md` 表格和 `PROGRESS.md` 基础上增强：

- 解析 `_INDEX.md` 中的表格行，提取状态列，计算完成百分比
- 在 Workspace 面板顶部显示进度条（整体完成度 + 各模式分项）
- 解析 `PROGRESS.md` 中的条目，显示最近活动时间线

UI 组件：
```
┌─────────────────────────────────┐
│ 📊 进度概览                      │
│ ████████░░░░ 65% (13/20)        │
│                                 │
│ 最近活动:                        │
│ · 2026-07-10 完成「RAG 原理」     │
│ · 2026-07-08 新增「向量数据库」    │
└─────────────────────────────────┘
```

### Phase 3: 学习路线图（ROADMAP.md）

在 active project 文件夹中支持 `ROADMAP.md` 文件：

格式设计：
```markdown
## 基础
- [x] 线性代数复习
- [x] Python 数据处理
- [ ] 统计学基础

## 进阶
- [x] 机器学习入门
- [ ] 深度学习框架
  - depends: 机器学习入门

## 应用
- [ ] NLP 项目实战
  - depends: 深度学习框架
```

解析逻辑：
- `## heading` 作为阶段分组
- `- [x]` / `- [ ]` 作为节点
- `depends: name` 建立依赖关系

UI 渲染：
- 使用 HTML Canvas 2D 绘制简易节点图（左到右流向）
- 已完成节点高亮，未完成灰色，被阻塞节点标记
- 点击节点展开关联笔记

### Phase 4: 知识图谱可视化

利用 Obsidian `metadataCache.resolvedLinks` 构建知识关系图：

数据源：
- `metadataCache.resolvedLinks`：获取所有笔记的出链关系
- 限制到当前 active project 对应的文件夹
- 节点 = 笔记文件，边 = wikilink 引用

渲染方案：
- Canvas 2D + 力导向布局算法（force-directed）
- 节点大小 = 入链数量（被引用越多越大）
- 颜色编码 = 按子文件夹/tag 分组
- 支持拖拽、缩放、悬停显示笔记标题
- 点击节点在主编辑区打开对应笔记

性能考虑：
- 超过 200 个节点时做分页或聚类
- 使用 `requestAnimationFrame` + 节流渲染
- 图谱数据缓存，文件变化时增量更新

## 新增文件

| 文件 | 用途 |
|------|------|
| `src/workspace-view.ts` | 重命名自 harness-view.ts，增加 dashboard 面板 |
| `src/roadmap-parser.ts` | ROADMAP.md 解析器（Markdown → DAG 数据结构） |
| `src/knowledge-graph.ts` | 知识图谱渲染（Canvas 2D 力导向布局） |

## 实施顺序

1. Phase 1（重命名）→ 2. Phase 2（进度增强）→ 3. Phase 3（路线图）→ 4. Phase 4（知识图谱）

每个 Phase 独立可交付，不依赖后续 Phase。
