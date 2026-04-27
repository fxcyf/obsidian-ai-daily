# Feature: Agentic Vault 操作

**状态**: ⬜ 待开始

## 概述

将 Claude 从"只读助手"升级为"知识库 Agent"，赋予创建、编辑、重命名、管理标签等完整 vault 操作能力，使其能自主整理和维护知识库。

---

## 1. 完整笔记 CRUD 工具集

**优先级**: P0
**难度**: 中
**阶段**: 短期

### 现状
Claude 仅有 `read_note`、`search_vault`、`append_to_note`、`list_notes` 四个工具，无法创建新笔记、编辑已有内容或管理文件结构。

### 新增工具

| 工具 | 作用 | 复杂度 |
|------|------|--------|
| `create_note` | 创建带 frontmatter 的新笔记 | 低 |
| `edit_note` | 替换笔记中指定段落/区块 | 中 |
| `rename_note` | 重命名/移动笔记，自动更新引用 | 中 |
| `delete_note` | 删除笔记（需用户确认机制） | 低 |
| `update_frontmatter` | 修改笔记的 YAML frontmatter（tags/metadata） | 低 |

### 实现要点
- `vault-tools.ts` 中新增工具函数，`claude.ts` 注册
- `edit_note` 支持按标题/行号/正则定位替换区域
- `rename_note` 利用 Obsidian `fileManager.renameFile()` 自动更新反向链接
- `delete_note` 需实现确认机制：Claude 先提出删除建议，等用户在对话中确认后执行
- 所有写操作记录操作日志，支持撤销提示

### 验收标准
- Claude 可在对话中完成"读一篇 Raw 笔记 → 整理成 Wiki 条目 → 创建新笔记 → 打标签"全流程
- 写操作不会静默覆盖已有内容

---

## 2. 批量知识整理 Agent

**优先级**: P1
**难度**: 中-高
**阶段**: 短期

### 现状
知识库整理完全依赖用户手动操作，Raw → Wiki 的转化效率低。

### 方案
- 新增命令「整理知识库」，Claude 自主扫描 Raw/ 中未整理的笔记
- 对每篇笔记执行：提取核心观点 → 查找相关 Wiki 条目 → 决定是更新已有条目还是创建新条目
- 自动添加 wiki-link 关联、补充 frontmatter tags
- 整理完成后在原 Raw 笔记中标记 `organized: true`

### 实现要点
- 利用上一步的 CRUD 工具集，以 agentic loop（多轮 tool_use）驱动
- 单次整理限制处理笔记数量（如 5 篇），避免 API 成本失控
- 每步操作生成简报，用户可在对话中看到进度
- 整理策略可通过 system prompt 或设置自定义

---

## 3. 对话驱动的知识蒸馏（Karpathy LLM Wiki 模式）

**优先级**: P1
**难度**: 中
**阶段**: 短期-中期

### 现状
用户与 Claude 的对话产出（洞察、总结、分析）只能通过 `append_to_note` 追加，无法结构化沉淀。

### 方案
- 对话结束时，Claude 自动提取对话中的关键知识点
- 将知识点与现有 Wiki 条目匹配：存在则更新，不存在则创建
- 维护知识条目间的双链关系
- 参考 Karpathy 的 raw/ → wiki/ 模式：Raw 是原始输入，Wiki 是 LLM 蒸馏后的结构化知识

### 实现要点
- 对话结束时（或用户主动触发）执行知识蒸馏
- 蒸馏 prompt 指导 Claude 提取事实性知识、排除闲聊
- 创建的 Wiki 条目自动标记来源对话 ID
- 设置中可开关自动蒸馏，配置目标文件夹

---

## 竞品参考

| 产品 | 相关能力 | 差异 |
|------|----------|------|
| Notion AI 3.0 | 自主 agent 多步操作 workspace | 闭源，不可定制 |
| Cannoli (Obsidian) | Canvas 可视化编排 agentic 工作流 | 可视化优先，非对话驱动 |
| Google Conductor | Gemini CLI + markdown 知识管理 | CLI 而非 Obsidian 集成 |
