# Feature: LLM 驱动的知识库自组织

**状态**: ⬜ 待开始

## 概述

让 AI 从被动响应转为主动维护知识库：自动打标签、建链接、生成摘要、检测知识缺口，实现知识库的自我进化。

---

## 1. Auto-tagging（自动标签）

**优先级**: P0
**难度**: 中
**阶段**: 长期 Phase 1

### 现状
新导入的 Raw 笔记缺少 tags，手动标注效率低，导致 search_vault 的 tag 过滤功能利用率不高。

### 方案
- 监听 `vault.on('create')` 和 `vault.on('modify')` 事件
- 对配置范围内的新笔记，自动调用 Claude 分析内容
- 生成结果写入 frontmatter：`tags`、`summary`（一句话摘要）
- 优先匹配已有标签体系，减少标签膨胀

### 实现要点
- 延迟触发（debounce 5s），避免编辑中反复调用
- 检查 `auto-tagged: true` 防止重复标注
- 收集 vault 中已有的 tag 列表，作为 prompt 约束
- 单次标注消耗约 500-1k tokens，成本可控
- Settings：开关、适用文件夹范围、自定义标注 prompt

---

## 2. Auto-linking（自动链接）

**优先级**: P1
**难度**: 中-高
**阶段**: 长期 Phase 1

### 现状
笔记间的 wiki-link 完全靠手动建立，大量内容相关的笔记之间缺少连接。

### 方案

#### 对话后自动链接
- 对话结束时，分析对话中涉及的笔记
- 检测这些笔记间是否缺少应有的 wiki-link
- 提示用户或自动在笔记末尾追加「相关笔记」区块

#### 全库链接扫描
- 新增命令「扫描缺失链接」
- 利用语义搜索（依赖 feature-semantic-search Phase 1）找到内容相关但未链接的笔记对
- 生成建议列表，用户批量确认

### 实现要点
- 区分"强关联"（应直接 wiki-link）和"弱关联"（仅供参考）
- 避免过度链接：设置相似度阈值，只建议 top-3 关联
- 链接插入位置：笔记末尾独立 section `## Related`，不侵入正文

---

## 3. 知识库健康报告

**优先级**: P2
**难度**: 中
**阶段**: 长期 Phase 2

### 现状
用户不清楚知识库的整体状态：哪些领域覆盖深、哪些有缺口、哪些笔记过期需更新。

### 方案
- 定期（周/月）生成知识库健康报告，存为笔记
- 报告内容：
  - **覆盖分析**：按 tag/主题统计笔记分布，识别知识密集区和空白区
  - **新鲜度**：标记超过 N 天未更新的重要笔记
  - **孤岛检测**：无任何 inlink/outlink 的笔记列表
  - **重复检测**：内容高度相似的笔记对（依赖语义搜索）
  - **建议行动**：针对以上问题的具体操作建议

### 实现要点
- 利用 `list_notes` + `metadataCache` 收集统计数据
- Claude 生成自然语言分析报告
- 可作为 Feed 生成的扩展，复用 `feed-generator.ts` 架构

---

## 4. 多模型后端支持

**优先级**: P2
**难度**: 中
**阶段**: 长期 Phase 2

### 现状
仅支持 Claude（Anthropic API），对隐私敏感用户和无 API key 用户不友好。

### 方案
- 抽象 LLM 接口层：`src/llm-provider.ts`
- 支持后端：
  - Anthropic Claude（现有）
  - Ollama（本地模型，完全离线）
  - OpenAI 兼容 API（覆盖 DeepSeek、Groq 等）
- tool_use 协议适配：不同 provider 的 function calling 格式不同

### 实现要点
- 定义统一接口：`chat(messages, tools, options) → stream`
- 各 provider 实现自己的适配器
- Ollama 场景：tool_use 支持有限，需降级为 prompt-based 工具调用
- Settings 中新增 provider 选择和各 provider 的配置项
- 优先实现 Ollama，覆盖隐私需求最强烈的用户群

---

## 5. Spaced Repetition 智能回顾

**优先级**: P3
**难度**: 中
**阶段**: 长期 Phase 3

### 现状
知识只进不出，缺少复习和强化记忆的机制。

### 方案
- 基于 SM-2 算法（或简化版），追踪每篇笔记的回顾状态
- 每日在聊天侧边栏展示「今日回顾」卡片
- AI 生成回顾问题（而非简单重读），促进主动回忆
- 回顾后标记掌握程度，调整下次回顾间隔

### 实现要点
- 回顾元数据存入笔记 frontmatter：`next_review`、`ease_factor`、`interval`
- 回顾优先级：重要标签的笔记 > 普通笔记
- 与对话历史结合：常被讨论的笔记降低回顾频率（已经在用了）

---

## 竞品参考

| 产品 | 相关能力 | 我们的差异 |
|------|----------|-----------|
| AI Tagger Universe | Obsidian 自动标签 | 我们结合 vault 已有标签体系，更准确 |
| Mem 2.0 | 零组织，AI 自动归类 | 我们保持用户控制，AI 辅助而非替代 |
| Reflect | AI 标签 + 摘要 | 闭源，不可定制 |
| Obsidian Spaced Repetition | 闪卡复习 | 我们用 AI 生成问题，更智能 |
