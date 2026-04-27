# Feature: 语义搜索与智能检索

**状态**: ⬜ 待开始

## 概述

从关键词全文匹配进化到语义理解 + 图谱感知的混合检索体系，大幅提升 Claude 找到相关知识的能力。

---

## 1. Embedding 向量索引

**优先级**: P0
**难度**: 高
**阶段**: 中期

### 现状
`search_vault` 依赖关键词匹配，语义相近但措辞不同的笔记无法被发现（如搜"机器学习"找不到"神经网络"笔记）。

### 方案

#### Phase 1：基础向量搜索
- 新建 `src/embeddings.ts`
- 接入 Embedding API（Voyage AI / OpenAI / Anthropic）
- 对每篇笔记生成向量，存储为本地文件（`.ai-chat/embeddings.json`）
- 搜索时将 query 向量化，余弦相似度返回 top-K

#### Phase 2：混合检索
- BM25 关键词检索 + dense embedding 语义检索
- 两路结果用 RRF（Reciprocal Rank Fusion）合并排序
- 业界数据显示混合检索精度提升 15-30%

#### Phase 3：增量与优化
- 增量索引：只对新增/修改笔记重新向量化（基于 mtime 对比）
- 长笔记分块：按段落/标题层级切分，每块独立向量化
- 元数据增强：将 tags、文件夹、创建时间等元数据加入检索信号

### 实现要点
- 分块策略：按 Markdown 标题（##）分割，每块 200-500 tokens
- 首次索引需进度条反馈（可能需数分钟）
- Settings 新增：Embedding provider、API key、启用/禁用开关
- 向量维度按 provider 自适应（Voyage: 1024, OpenAI: 1536）
- 本地备选：TF-IDF 方案零成本，效果弱但可作为无 API key 时的 fallback

### 成本估算
- Voyage AI：~$0.1/M tokens，1000 篇笔记首次索引约 $0.05
- 增量更新成本可忽略

---

## 2. 知识图谱增强检索（GraphRAG）

**优先级**: P1
**难度**: 中-高
**阶段**: 中期

### 现状
Claude 读取笔记时看不到 wiki-link 构成的知识图谱结构，无法进行主题级推理。

### 方案

#### Phase 1：链接感知工具
- 新增 `get_backlinks` 工具：返回引用指定笔记的所有笔记
- 新增 `get_outlinks` 工具：返回指定笔记引用的所有笔记
- 利用 Obsidian `metadataCache` API，零额外成本

#### Phase 2：图谱摘要
- 构建笔记关系图的局部子图（以查询笔记为中心，2-hop 邻居）
- 为子图生成结构化摘要（实体、关系、主题簇）
- 主题级查询（如"我对 RAG 的理解演变"）可遍历相关笔记链

#### Phase 3：自动图谱维护
- 检测孤岛笔记（无任何链接），建议关联
- 发现缺失链接（内容相关但未建立 wiki-link），自动补充
- 定期生成知识图谱健康报告

### 实现要点
- Phase 1 几乎零成本，直接利用 Obsidian API
- Phase 2 参考 Microsoft GraphRAG，但简化为本地 markdown 场景
- 图谱遍历需限制深度和广度，避免 token 爆炸
- `vault-tools.ts` 新增工具，`claude.ts` 注册

---

## 3. Context Engineering（上下文工程）

**优先级**: P2
**难度**: 高
**阶段**: 中期-长期

### 现状
系统 prompt 中的上下文是静态组装的（当前笔记 + 最近 5 篇知识笔记），与用户问题的相关性不稳定。

### 方案
- 动态上下文选择：根据用户问题，从向量索引 + 图谱中选取最相关的 K 篇笔记
- 上下文压缩：对选中笔记做摘要提取，只保留与问题相关的段落
- 上下文预算分配：在 token budget 内，优先分配给高相关性内容

### 实现要点
- 替换当前 system prompt 中的固定笔记加载逻辑
- 在 `claude.ts` 的 `buildSystemPrompt()` 中集成检索 pipeline
- 检索 → 排序 → 截断 → 组装，形成动态 context window
- 需要 Phase 1 的向量索引作为前置依赖

---

## 竞品参考

| 产品/方案 | 检索方式 | 差异 |
|-----------|----------|------|
| Smart Connections | 本地 embedding + 相似笔记 | 只做相似发现，不做混合检索 |
| Copilot for Obsidian | 全库向量 Q&A | 重型，单一 provider |
| Microsoft GraphRAG | 实体图谱 + 社区摘要 | 针对大型文档集，过重 |
| Karpathy LLM Wiki | 无向量库，结构化 markdown 直接入上下文 | 适合小库，大库需检索辅助 |
