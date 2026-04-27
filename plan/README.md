# Plan — 功能规划索引

> 完整路线图见 [roadmap.md](roadmap.md)
>
> 状态标记：✅ 已完成 | 🔧 进行中 | ⬜ 待开始

## 已完成

- ✅ [对话体验增强](feature-chat-experience.md) — 流式输出、对话历史、Token 管理
- ✅ [真流式输出](feature-real-streaming.md) — SSE 真流 + 三态降级（auto/real/typewriter/off）
- ✅ [UX 打磨](feature-ux-polish.md) — Prompt 模板、笔记引用可点击、代码块复制（主题适配待做）
- ✅ [信息 Feed 流](feature-info-feed.md) — RSS/HN/Reddit/GitHub 多源聚合 + AI 策展（Phase 1）
- ✅ [Enter 键行为修复](bug-enter-key-behavior.md) — PC Enter 发送，手机 Enter 换行
- ✅ [新对话按钮重叠修复](bug-new-chat-button-overlap.md) — 按钮和消息 block 重合

## 短期 — Agentic Vault

- ⬜ [Agentic Vault 操作](feature-agentic-vault.md) — 笔记 CRUD、批量整理、知识蒸馏
- ⬜ [本地文件处理](feature-local-file-image.md) — 本地图片识别（M1-M5 里程碑）

## 中期 — 语义搜索

- ⬜ [语义搜索与智能检索](feature-semantic-search.md) — Embedding 向量索引、混合检索、GraphRAG、Context Engineering

## 长期 — 知识库自组织

- ⬜ [LLM 驱动自组织](feature-llm-driven-org.md) — Auto-tagging/linking、健康报告、多模型后端、智能回顾

## 历史文档（已归入新计划）

- [知识库能力深化](feature-knowledge-enhancement.md) — 语义搜索 + 图谱 + 笔记生成 → 归入 [语义搜索](feature-semantic-search.md) 和 [Agentic Vault](feature-agentic-vault.md)
- [工作流自动化](feature-automation.md) — 标注 + 日报 + 回顾 → 归入 [LLM 自组织](feature-llm-driven-org.md)
- [对话体验 2026-04 笔记](chat-experience-2026-04.md) — 实现记录（历史参考）
