# Feature: 知识库能力深化

**状态**: ⬜ 待开始

## 概述

从关键词搜索进化到语义理解，让 Claude 真正"理解"你的知识库结构和内容关联。

---

## 1. 语义搜索（Embeddings）

**优先级**: P2（中期）
**难度**: 高

### 现状
`search_vault` 依赖关键词全文匹配，无法理解语义相近的内容（如搜"机器学习"找不到"深度神经网络"的笔记）。

### 方案
- 使用 Embedding API（Voyage AI / OpenAI）对笔记生成向量
- 向量索引存储为本地 JSON 文件（如 `.ai-chat/embeddings.json`）
- 搜索时将 query 也向量化，计算余弦相似度返回 top-K

### 实现要点
- 新建 `src/embeddings.ts`：向量生成、索引管理、相似度计算
- 增量索引：只对新增/修改的笔记重新生成向量
- 分块策略：长笔记按段落分块，每块独立向量化
- 混合搜索：关键词 + 语义结合，取并集排序
- Settings 中新增 Embedding 配置（API provider、是否启用）

### 成本考量
- Embedding 调用有 API 成本，需在 Settings 中明确提示
- 首次索引可能需要较多调用，需进度条反馈
- 可选纯本地方案：TF-IDF，零成本但效果较弱

---

## 2. 知识图谱感知（双链追踪）

**优先级**: P1（短期可做）
**难度**: 低-中

### 现状
Claude 读取笔记时看不到 wiki-link 关系，无法追踪知识间的关联。

### 方案
- 新增 `get_backlinks` 工具：给定笔记路径，返回所有引用它的笔记列表
- 新增 `get_outlinks` 工具：给定笔记路径，返回它引用的所有笔记列表
- Claude 可通过链接追踪，像浏览 wiki 一样探索知识库

### 实现要点
- `vault-tools.ts` 中新增两个工具函数
- 使用 Obsidian 的 `metadataCache` API 获取链接关系（高效）
- 工具返回格式：`[{path, title, context}]`（context 为引用所在的段落）
- 在 `claude.ts` 中注册新工具

---

## 3. 智能笔记生成

**优先级**: P1
**难度**: 中

### 现状
`append_to_note` 只能追加内容，无法创建结构化新笔记。

### 方案
- 新增 `create_note` 工具：创建带完整 frontmatter 的新笔记
- Claude 可基于对话内容生成结构化 Wiki 条目
- 自动添加 tags、wiki-links、source 等 metadata

### 工具定义
```typescript
{
  name: "create_note",
  description: "在 vault 中创建一篇新笔记",
  input_schema: {
    path: "笔记路径（含文件夹）",
    title: "笔记标题",
    tags: ["标签数组"],
    content: "Markdown 正文",
    source: "来源 URL（可选）"
  }
}
```

### 实现要点
- 自动生成 YAML frontmatter
- 智能归类：根据内容推荐放入 Raw/ 还是 Wiki/
- 避免覆盖已有笔记（同名时提示用户）
- 对话中生成的笔记自动添加 `generated-by: ai-chat` 标记
