# Roadmap: 实施路径

> 核心方向：从"在 Obsidian 里和 AI 聊天"进化为"AI 驱动的个人知识管理系统"
>
> 状态标记：✅ 已完成 | 🔧 进行中 | ⬜ 待开始

---

## 阶段一：体验基础 ✅

> 核心对话能力，已全部完成。

| 功能 | 状态 | 来源 |
|------|------|------|
| 流式输出（真流 + 伪流降级） | ✅ | [真流式](feature-real-streaming.md)、[对话体验](feature-chat-experience.md) #1 |
| 对话历史持久化 | ✅ | [对话体验](feature-chat-experience.md) #2 |
| Token 用量管理与自动压缩 | ✅ | [对话体验](feature-chat-experience.md) #3 |
| Prompt 模板（`/` 触发） | ✅ | [UX 打磨](feature-ux-polish.md) #1 |
| 笔记引用 `[[]]` 可点击 | ✅ | [UX 打磨](feature-ux-polish.md) #2 |
| 代码块复制按钮 | ✅ | [UX 打磨](feature-ux-polish.md) #4 |
| AI Feed 生成（RSS/HN/Reddit/GitHub） | ✅ | [信息 Feed](feature-info-feed.md) Phase 1 |
| 联网搜索（web_search + web_fetch） | ✅ | — |

---

## 阶段二：Agentic Vault — 从只读到读写（短期）

> 让 Claude 从"查询助手"变为"知识库 Agent"，能自主创建、编辑、整理笔记。

| 功能 | 状态 | 来源 | 说明 |
|------|------|------|------|
| 完整笔记 CRUD 工具集 | ✅ | [Agentic Vault](feature-agentic-vault.md) #1 | create/edit/rename/delete + frontmatter 管理，后续所有 agentic 功能的前置（v0.7.0） |
| 知识图谱感知（backlinks/outlinks） | ✅ | [Agentic Vault](feature-agentic-vault.md) #1 补充、[知识库增强](feature-knowledge-enhancement.md) #2 | get_links 工具，利用 Obsidian metadataCache API（v0.7.1） |
| 批量知识整理 Agent | ⬜ | [Agentic Vault](feature-agentic-vault.md) #2 | Raw → Wiki 自动化整理 |
| 对话驱动知识蒸馏 | ⬜ | [Agentic Vault](feature-agentic-vault.md) #3 | 对话产出自动沉淀为结构化 Wiki（Karpathy LLM Wiki 模式） |
| 笔记自动标注 | ✅ | [LLM 自组织](feature-llm-driven-org.md) #1、[工作流自动化](feature-automation.md) #1 | 新笔记自动生成 tags + summary（v0.7.3） |
| 本地图片处理 | ✅ | [本地文件处理](feature-local-file-image.md) | 让 Raw 笔记中的本地图片可被 AI 理解（v0.7.2） |

---

## 阶段三：语义搜索与智能检索（中期）

> 从关键词匹配进化到语义理解 + 图谱感知，质变级检索提升。

| 功能 | 状态 | 来源 | 说明 |
|------|------|------|------|
| Embedding 向量索引 | ⬜ | [语义搜索](feature-semantic-search.md) #1 Phase 1 | 语义检索核心，解决"同义不同词" |
| 混合检索（BM25 + Dense） | ⬜ | [语义搜索](feature-semantic-search.md) #1 Phase 2 | 业界验证精度提升 15-30% |
| GraphRAG 知识图谱检索 | ⬜ | [语义搜索](feature-semantic-search.md) #2 | 主题级查询，利用 Obsidian 双链结构 |
| Context Engineering | ⬜ | [语义搜索](feature-semantic-search.md) #3 | 动态上下文选择，替代固定笔记加载 |

---

## 阶段四：知识库自组织与生态扩展（长期）

> AI 从被动响应转为主动维护知识库，实现知识库自我进化。

| 功能 | 状态 | 来源 | 说明 |
|------|------|------|------|
| Auto-linking 自动链接 | ⬜ | [LLM 自组织](feature-llm-driven-org.md) #2 | 检测缺失链接，补全知识网络 |
| 知识库健康报告 | ⬜ | [LLM 自组织](feature-llm-driven-org.md) #3 | 覆盖分析、孤岛检测、重复检测 |
| 定时日报/周报 | ⬜ | [工作流自动化](feature-automation.md) #2 | 启动时自动生成，形成信息流闭环 |
| 多模型后端（Ollama 等） | ⬜ | [LLM 自组织](feature-llm-driven-org.md) #4 | 覆盖隐私敏感用户 |
| Spaced Repetition 智能回顾 | ⬜ | [LLM 自组织](feature-llm-driven-org.md) #5、[工作流自动化](feature-automation.md) #3 | AI 生成回顾问题，强化记忆 |
| 主题适配验证 | ⬜ | [UX 打磨](feature-ux-polish.md) #5 | 社区主题兼容性打磨 |

---

## 专项计划索引

| 文档 | 主题 | 状态 |
|------|------|------|
| [feature-agentic-vault.md](feature-agentic-vault.md) | Agentic Vault 操作（CRUD + 整理 + 蒸馏） | 🔧 |
| [phase2-implementation.md](phase2-implementation.md) | 阶段二详细实施计划（4 批次） | 🔧 |
| [feature-semantic-search.md](feature-semantic-search.md) | 语义搜索（Embedding + GraphRAG + Context Engineering） | ⬜ |
| [feature-llm-driven-org.md](feature-llm-driven-org.md) | LLM 驱动自组织（标签 + 链接 + 健康报告 + 多模型 + 回顾） | ⬜ |
| [feature-local-file-image.md](feature-local-file-image.md) | 本地图片处理（M1-M5 里程碑） | ✅ Phase 1 |
| [feature-info-feed.md](feature-info-feed.md) | 信息 Feed 流 | ✅ Phase 1 |
| [feature-chat-experience.md](feature-chat-experience.md) | 对话体验增强（流式 + 历史 + Token） | ✅ |
| [feature-real-streaming.md](feature-real-streaming.md) | 真流式输出（SSE + 三态降级） | ✅ |
| [feature-ux-polish.md](feature-ux-polish.md) | UX 打磨（模板 + 链接 + 代码块 + 主题） | ✅ 大部分 |
| [feature-knowledge-enhancement.md](feature-knowledge-enhancement.md) | 知识库能力深化（语义搜索 + 图谱 + 笔记生成） | ⬜ 已归入阶段二/三 |
| [feature-automation.md](feature-automation.md) | 工作流自动化（标注 + 日报 + 回顾） | ⬜ 已归入阶段二/四 |

---

## 技术趋势参考

| 趋势 | 代表 | 与本项目的关系 |
|------|------|---------------|
| Context Engineering | 业界共识 | 阶段三核心，替代简单 RAG |
| GraphRAG | Microsoft | 阶段三，利用 Obsidian 双链天然优势 |
| Karpathy LLM Wiki | 开源模式 | 阶段二知识蒸馏直接采用此模式 |
| Agentic Workflows | Notion AI 3.0, Cannoli | 阶段二核心方向 |
| Local-first AI | Ollama, Private AI | 阶段四，覆盖隐私需求 |
| Markdown as LLM format | Google Conductor | 本项目天然契合 |
