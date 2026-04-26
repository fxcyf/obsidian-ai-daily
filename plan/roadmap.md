# Roadmap: 实施路径

> 核心方向：从"在 Obsidian 里和 AI 聊天"进化为"AI 驱动的个人知识管理系统"

## 阶段一：体验基础（立即）

| 功能 | 来源 | 理由 |
|------|------|------|
| 流式输出 | [对话体验](feature-chat-experience.md) #1 | 体验提升最显著，长回复不再等待 |
| 对话历史持久化 | [对话体验](feature-chat-experience.md) #2 | 对话不丢失是基本功能预期 |

## 阶段二：低成本高收益 UX（短期）

| 功能 | 来源 | 理由 |
|------|------|------|
| Prompt 模板 | [UX 打磨](feature-ux-polish.md) #1 | 减少重复输入，提高使用效率 |
| 笔记引用可点击 | [UX 打磨](feature-ux-polish.md) #2 | 打通对话与笔记的跳转闭环 |
| 导出对话为笔记 | [UX 打磨](feature-ux-polish.md) #3 | 对话产出沉淀为知识 |
| 知识图谱感知 | [知识库增强](feature-knowledge-enhancement.md) #2 | 低成本，利用 Obsidian 现有 API |
| 本地文件处理（先图片） | [本地文件处理](feature-local-file-image.md) | 让 Raw 笔记中的本地图片可被 AI 理解，补齐多模态入口 |

## 阶段三：知识管理助手（中期）

| 功能 | 来源 | 理由 |
|------|------|------|
| 笔记自动标注 | [工作流自动化](feature-automation.md) #1 | 降低知识整理门槛 |
| 智能笔记生成 | [知识库增强](feature-knowledge-enhancement.md) #3 | Claude 从"查询工具"变为"创作工具" |
| 个人信息 Feed 流 | [信息 Feed](feature-info-feed.md) | 已有详细设计，按 Phase 1-3 推进 |
| Token 用量管理 | [对话体验](feature-chat-experience.md) #3 | 多轮对话稳定性保障 |

## 阶段四：深度智能（长期）

| 功能 | 来源 | 理由 |
|------|------|------|
| 语义搜索 | [知识库增强](feature-knowledge-enhancement.md) #1 | 能力护城河，质变级提升 |
| 定时日报/周报 | [工作流自动化](feature-automation.md) #2 | 形成信息流闭环 |
| 智能回顾提醒 | [工作流自动化](feature-automation.md) #3 | AI 主动服务用户 |
| 代码块增强 + 主题适配 | [UX 打磨](feature-ux-polish.md) #4-5 | 打磨细节 |

## 专项计划：本地文件处理（先支持图片）

> 详细设计见：[feature-local-file-image.md](feature-local-file-image.md)

### 目标范围

- 先支持 `Raw/` 与当前打开笔记中引用的本地图片（`![[xxx.png]]`、Markdown 图片语法）
- 优先实现“可读可问”（让模型看到图片），暂不做 OCR/结构化提取
- 非图片附件（PDF、音频、视频）仅做占位设计，不进入本轮实现

### 里程碑

| 阶段 | 目标 | 产出 |
|------|------|------|
| M1：解析与收集 | 从笔记内容中提取本地图片路径，并解析为 vault 内真实文件 | `extractLocalImageRefs()` 工具函数 + 单测 |
| M2：读取与编码 | 安全读取图片二进制，按大小阈值压缩输入，转为模型可接受格式 | `readImageAsBase64()` + 大小/类型校验 |
| M3：请求组装 | 在 chat 请求中支持文本 + 图片混合 content block | Claude 请求体支持 image block（仅用户消息） |
| M4：回退与提示 | 失败时优雅降级为文本流程，并给用户清晰提示 | Notice + 不中断对话 |
| M5：设置与开关 | 支持在设置里启用/禁用图片处理、配置大小上限 | 新增 settings 项 + README/TEST 文档更新 |

### 技术要点

- 路径解析：统一处理 wiki-link、相对路径、URL，确保仅本地 vault 文件进入读取流程
- 安全边界：限制 MIME（`image/png`, `image/jpeg`, `image/webp`, `image/gif`），限制单图大小与单次图片数量
- 上下文预算：图片会显著增加 token/请求体体积，需要和现有 context budget 联动
- 兼容性：桌面与移动端均走 Obsidian adapter，不依赖 Node 专有 API

### 风险与应对

- 请求过大导致 API 失败：增加预检查与分批策略，超限自动跳过并提示
- 引用路径不稳定（重命名/移动）：读取前做存在性校验，失败时返回可定位的文件名
- 用户误以为“全自动识图”：在 UI 提示当前仅处理“被引用且符合限制”的本地图片

### 验收标准（DoD）

- 在 `Raw/` 笔记中插入本地图片后，可直接提问图片相关内容并得到有依据的回答
- 图片读取失败不会阻塞文本对话；用户可看到明确失败原因
- 配置关闭图片处理后，行为回退到当前纯文本流程
- 文档同步更新：`README.md`、`TEST.md`、`CLAUDE.md`（仅在约定变化时）
