# Roadmap: 实施路径

> 核心方向：从"在 Obsidian 里和 AI 聊天"进化为"AI 驱动的个人知识管理系统"

## 阶段一：体验基础（已完成 ✅）

| 功能 | 来源 | 状态 |
|------|------|------|
| 流式输出 | [对话体验](feature-chat-experience.md) #1 | ✅ |
| 对话历史持久化 | [对话体验](feature-chat-experience.md) #2 | ✅ |

## 阶段二：低成本高收益 UX（短期）

| 功能 | 来源 | 理由 |
|------|------|------|
| Prompt 模板 | [UX 打磨](feature-ux-polish.md) #1 | 减少重复输入，提高使用效率 |
| 笔记引用可点击 | [UX 打磨](feature-ux-polish.md) #2 | 打通对话与笔记的跳转闭环 |
| 知识图谱感知 | [知识库增强](feature-knowledge-enhancement.md) #2 | 低成本，利用 Obsidian 现有 API |
| 本地文件处理（先图片） | [本地文件处理](feature-local-file-image.md) | 让 Raw 笔记中的本地图片可被 AI 理解 |

## 阶段三：Agentic Vault — 从只读到读写（短期）

> 让 Claude 从"查询助手"变为"知识库 Agent"，能自主整理和维护知识库。

| 功能 | 来源 | 理由 |
|------|------|------|
| 完整笔记 CRUD 工具集 | [Agentic Vault](feature-agentic-vault.md) #1 | 基础能力，后续所有 agentic 功能的前置 |
| 批量知识整理 Agent | [Agentic Vault](feature-agentic-vault.md) #2 | Raw → Wiki 自动化，核心知识管理流程 |
| 对话驱动知识蒸馏 | [Agentic Vault](feature-agentic-vault.md) #3 | 对话产出自动沉淀为结构化知识 |
| 笔记自动标注 | [工作流自动化](feature-automation.md) #1 | 降低知识整理门槛 |
| 个人信息 Feed 流 | [信息 Feed](feature-info-feed.md) | 已有详细设计，按 Phase 1-3 推进 |
| Token 用量管理 | [对话体验](feature-chat-experience.md) #3 | 多轮对话稳定性保障 |

## 阶段四：语义搜索与智能检索（中期）

> 从关键词匹配进化到语义理解 + 图谱感知，质变级检索提升。

| 功能 | 来源 | 理由 |
|------|------|------|
| Embedding 向量索引 | [语义搜索](feature-semantic-search.md) #1 | 语义检索核心能力，解决"同义不同词"问题 |
| 混合检索（BM25 + Dense） | [语义搜索](feature-semantic-search.md) #1 Phase 2 | 业界验证精度提升 15-30% |
| GraphRAG 知识图谱检索 | [语义搜索](feature-semantic-search.md) #2 | 支持主题级查询，利用 Obsidian 双链结构 |
| Context Engineering | [语义搜索](feature-semantic-search.md) #3 | 动态上下文选择，替代固定笔记加载 |

## 阶段五：LLM 驱动的知识库自组织（长期）

> AI 从被动响应转为主动维护知识库，实现知识库自我进化。

| 功能 | 来源 | 理由 |
|------|------|------|
| Auto-linking 自动链接 | [LLM 自组织](feature-llm-driven-org.md) #2 | 补全知识网络，提升图谱密度 |
| 知识库健康报告 | [LLM 自组织](feature-llm-driven-org.md) #3 | 可视化知识覆盖、发现缺口和孤岛 |
| 多模型后端（Ollama 等） | [LLM 自组织](feature-llm-driven-org.md) #4 | 覆盖隐私敏感用户，降低使用门槛 |
| Spaced Repetition 智能回顾 | [LLM 自组织](feature-llm-driven-org.md) #5 | AI 生成回顾问题，强化记忆 |
| 定时日报/周报 | [工作流自动化](feature-automation.md) #2 | 形成信息流闭环 |
| 代码块增强 + 主题适配 | [UX 打磨](feature-ux-polish.md) #4-5 | 打磨细节 |

## 专项计划

- [本地文件处理（先支持图片）](feature-local-file-image.md) — M1-M5 里程碑，详见专项文档

## 技术趋势参考

| 趋势 | 代表 | 与本项目的关系 |
|------|------|---------------|
| Context Engineering | 业界共识 | 阶段四核心，替代简单 RAG |
| GraphRAG | Microsoft | 阶段四，利用 Obsidian 双链天然优势 |
| Karpathy LLM Wiki | 开源模式 | 阶段三的知识蒸馏直接采用此模式 |
| Agentic Workflows | Notion AI 3.0, Cannoli | 阶段三核心方向 |
| Local-first AI | Ollama, Private AI | 阶段五，覆盖隐私需求 |
| Markdown as LLM format | Google Conductor | 本项目天然契合 |
