import type { AIDailyChatSettings } from "./settings";

const GUIDE_FOLDER = "_cortex-guide";

interface GuideFile {
	path: string;
	content: string;
}

export function getGuideFolderPath(): string {
	return GUIDE_FOLDER;
}

export function generateGuideFiles(settings: AIDailyChatSettings): GuideFile[] {
	const {
		knowledgeFolders,
		chatHistoryFolder,
		autoTagFolders,
		distillTargetFolder,
		harnessProjectsFolder,
		harnessInboxFile,
		enableAutoTagging,
		enablePodcast,
		enableWeRead,
	} = settings;

	const sourceFolder = autoTagFolders[0] || knowledgeFolders[0] || "Raw";
	const wikiFolder = distillTargetFolder || "Wiki";
	const today = new Date().toISOString().slice(0, 10);

	const files: GuideFile[] = [];

	// ── README ──────────────────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/README.md`,
		content: `# Cortex Vault 参考模板

> **本文件夹由 Cortex 插件根据当前设置自动生成（${today}）。**

## 这是什么？

Cortex 插件依赖 vault 中的特定文件结构来驱动 AI 功能（模式切换、知识整理、自动标注等）。
本文件夹提供**参考模板**，帮助你快速搭建这些结构。

## 如何使用

这些文件**不会自动生效**，你需要将它们放到正确的位置：

1. **手动复制** — 将模板文件复制到下表「目标位置」列指定的路径
2. **让 AI 代劳** — 在 Claude Code 中说"请参照 _cortex-guide/ 中的模板初始化我的 vault"

每个模板文件内部都有详细的注释说明，解释每个字段的含义和自定义方式。

## 修改设置后请重新生成

本文件夹中的所有路径（文件夹名、inbox 路径等）都是根据**生成时的插件设置**填入的。
如果你之后修改了设置（比如把知识库文件夹从 \`${knowledgeFolders.join(", ")}\` 改成其他名称），
这些模板中的路径就不再准确——请到设置页重新点击「生成模板」按钮。

## 当前设置摘要

| 配置项 | 当前值 |
|--------|--------|
| 知识库文件夹 | \`${knowledgeFolders.join("`, `")}\` |
| 对话存档 | \`${chatHistoryFolder}\` |
| 自动标注文件夹 | \`${autoTagFolders.join("`, `")}\` |
| 蒸馏目标 | \`${wikiFolder}\` |
| 项目文件夹 | \`${harnessProjectsFolder}\` |
| Inbox 文件 | \`${harnessInboxFile}\` |
| 自动标注 | ${enableAutoTagging ? "开启" : "关闭"} |
| 播客工具 | ${enablePodcast ? "开启" : "关闭"} |
| 微信读书 | ${enableWeRead ? "开启" : "关闭"} |

## 文件列表

| 模板文件 | 目标位置 | 说明 |
|----------|----------|------|
| \`CLAUDE.md\` | vault 根目录的 \`CLAUDE.md\` | 教 Claude Code 理解你的 vault（复制后可自由修改） |
| \`_INDEX.md\` | \`${harnessProjectsFolder}/_INDEX.md\` | 项目索引（插件从这里读取当前活跃项目） |
| \`modes.md\` | \`${harnessProjectsFolder}/{项目名}/modes.md\` | 模式定义和 prompt（插件从这里加载模式按钮） |
| \`inbox.md\` | \`${harnessInboxFile}\` | Inbox 待办（Harness 面板显示待办计数） |
`,
	});

	// ── CLAUDE.md template ──────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/CLAUDE.md`,
		content: `# Vault 规范 — Cortex AI 知识管理

<!--
  使用说明：
  - 将本文件复制到 vault 根目录，命名为 CLAUDE.md
  - Claude Code agent 会自动读取此文件来理解你的 vault 结构
  - 你可以自由修改本文件的内容，以下所有内容都是建议而非强制
  - 特别是「工作流」部分，可以根据你的实际习惯调整

  本文件根据当前 Cortex 插件设置生成（${today}），
  文件夹路径等信息反映的是生成时的设置。
-->

## 文件夹结构

<!--
  以下路径来自插件设置。如果你修改了设置中的文件夹名称，
  需要同步更新本节内容，或重新生成模板。
-->

| 文件夹 | 用途 | 说明 |
|--------|------|------|
| \`${sourceFolder}/\` | 原始素材 | 文章、笔记、网页剪藏等未整理的内容 |
| \`${wikiFolder}/\` | 知识条目 | 整理后的结构化知识，由 AI 或手动创建 |
| \`Feed/\` | 资讯 Feed | AI 生成的每日资讯汇总 |
| \`${harnessProjectsFolder}/\` | 项目配置 | Harness 模式系统的配置文件 |
| \`${chatHistoryFolder}/\` | 对话存档 | AI 对话的 JSON 存档（自动管理） |

## Frontmatter 规范

<!--
  Frontmatter 是 Obsidian 笔记开头的 YAML 元数据块。
  Cortex 的自动标注、知识整理等功能依赖这些字段来工作。
  以下是推荐的字段，你可以根据需要增减。
-->

所有 \`${sourceFolder}/\` 和 \`${wikiFolder}/\` 中的笔记建议包含：

\`\`\`yaml
---
tags: [主题标签1, 主题标签2]   # 小写英文，用于搜索和分类
summary: 一句话摘要              # 帮助 AI 快速理解笔记内容
date: ${today}                  # 创建或最后修改日期
type: note                       # 类型：note | wiki | feed | podcast-feed
organized: false                 # 整理状态（见下方说明）
---
\`\`\`

### 字段说明

- **tags** — 小写，用已有标签，避免同义重复。例如：用 \`llm\` 而不是同时用 \`llm\` 和 \`large-language-model\`。可以自定义任何标签
- **summary** — 一句话概括，被搜索和自动摘要功能使用
- **type** — 标记笔记类型。\`note\` 是普通笔记，\`wiki\` 是知识条目，\`feed\` 是 AI 资讯
- **organized** — \`${sourceFolder}/\` 中的笔记被整理到 \`${wikiFolder}/\` 后标记为 \`true\`，表示已处理。整理命令会跳过标记为 true 的笔记

你也可以添加自定义字段，不会影响插件功能。

## Wiki 条目写作规范

<!--
  以下规范用于指导 AI 生成 Wiki 条目的格式。
  你可以修改这些规范来适应你的写作偏好。
-->

\`${wikiFolder}/\` 中的条目建议遵循：

1. **文件名即概念名** — 如 \`RAG.md\`、\`Transformer.md\`、\`注意力机制.md\`
2. **开头一句话定义** — 快速说明这个概念是什么
3. **使用 [[wiki-link]]** — 用 \`[[其他条目名]]\` 链接相关概念，形成知识网络
4. **复用已有 tags** — 先用 \`search_vault\` 查看已有标签，优先复用
5. **子文件夹归类** — 条目多时可建子文件夹，如 \`${wikiFolder}/AI/\`、\`${wikiFolder}/编程/\`

## 项目与模式系统（Harness）

<!--
  Harness 是 Cortex 的项目和模式管理系统。
  它通过读取特定文件来决定界面上显示哪些模式按钮，以及每个模式注入什么 prompt。
  详细的配置说明见 modes.md 模板。
-->

\`${harnessProjectsFolder}/\` 下的文件结构：

\`\`\`
${harnessProjectsFolder}/
├── _INDEX.md              ← 项目索引，指定当前活跃项目
├── project-a/
│   ├── modes.md           ← 该项目的模式定义
│   └── PROGRESS.md        ← 项目进展记录（可选）
└── project-b/
    └── modes.md
\`\`\`

## 可用工具

<!--
  以下是 Cortex 插件提供给 AI agent 的工具列表。
  在对话中 AI 可以调用这些工具来操作 vault。
  你不需要修改这部分，它反映插件的实际能力。
-->

### Vault 操作
| 工具 | 功能 |
|------|------|
| \`read_note\` | 读取指定路径的笔记全文 |
| \`search_vault\` | 关键词全文搜索，支持按文件夹和标签过滤 |
| \`list_notes\` | 列出文件夹中的笔记（按修改时间排序） |
| \`create_note\` | 创建新笔记（可含 frontmatter） |
| \`edit_note\` | 编辑已有笔记内容 |
| \`append_to_note\` | 在笔记末尾追加内容 |
| \`rename_note\` | 重命名/移动笔记 |
| \`delete_note\` | 删除笔记 |
| \`update_frontmatter\` | 修改笔记的 YAML frontmatter |
| \`get_links\` | 获取笔记的反向链接和正向链接 |

### 资讯获取
| 工具 | 功能 |
|------|------|
| \`fetch_feeds\` | 从配置的订阅源批量抓取文章（RSS/HN/Reddit/GitHub Trending），自动评分排序 |
| \`fetch_rss\` | 抓取任意 RSS/Atom feed URL（不限于配置的源） |
| \`web_search\` | 联网搜索（Anthropic 内置） |
| \`web_fetch\` | 抓取指定 URL 的网页内容 |
${enablePodcast ? "| `podcast_search` | 搜索播客节目（iTunes API） |\n| `podcast_episodes` | 获取播客最新剧集列表 |\n| `podcast_transcript` | 提取播客文字稿 |\n" : ""}${enableWeRead ? "| `weread_api` | 调用微信读书 API（书架、笔记、划线等） |\n" : ""}
## 工作流参考

<!--
  以下是建议的工作流程，你可以根据自己的习惯修改。
  这些流程也被 modes.md 中的模式 prompt 引用。
-->

### 知识整理
1. 将新素材（文章、笔记、剪藏）存入 \`${sourceFolder}/\`
${enableAutoTagging ? "2. Cortex 自动为新笔记生成 tags 和 summary（写入 frontmatter）\n" : ""}${enableAutoTagging ? "3" : "2"}. 使用 Harness 的「整理知识」模式或「整理知识库」命令
${enableAutoTagging ? "4" : "3"}. AI 将素材提炼为 \`${wikiFolder}/\` 中的知识条目，并标记原笔记 \`organized: true\`

### Feed 生成
在 Harness 面板选择 feed 模式，AI 会用 \`fetch_feeds\` 抓取最新资讯，
结合你的知识库去重后生成 Feed 笔记。你也可以在任意对话中直接让 AI 调用这些工具。
`,
	});

	// ── _INDEX.md template ──────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/_INDEX.md`,
		content: `---
active_project: default
active_work_context: ""
---

<!--
  使用说明：
  - 将本文件复制到 ${harnessProjectsFolder}/_INDEX.md
  - 插件通过读取此文件的 frontmatter 来确定当前活跃项目

  Frontmatter 字段：
  - active_project: 当前活跃项目的文件夹名（必须与 ${harnessProjectsFolder}/ 下的子文件夹名一致）
  - active_work_context: 可选的工作上下文标识，会替换 modes.md 中 files 路径里的 {active_work_context} 变量

  下方的表格是项目列表，格式必须是 4 列：项目 | 状态 | 来源 | 最近更新
  你可以自由添加、删除项目行，但不要修改列结构。
  「来源」列可填任意文本（如 Jira 链接、项目说明等），插件不解析此列。
-->

# 项目索引

| 项目 | 状态 | 来源 | 最近更新 |
|------|------|------|----------|
| default | 活跃 | — | ${today} |
`,
	});

	// ── modes.md template ───────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/modes.md`,
		content: `<!--
  使用说明：
  - 将本文件复制到 ${harnessProjectsFolder}/{项目名}/modes.md
    例如：${harnessProjectsFolder}/default/modes.md
  - 插件会从此文件加载模式按钮显示在 Harness 面板中

  本文件由两部分组成：
  1. YAML modes 代码块 — 定义有哪些模式及其 UI 属性
  2. ## {id} 段落 — 每个模式对应的 system prompt

  两部分通过 id 关联：YAML 中的 id 必须与 ## 标题一致。
-->

# 模式定义

<!--
  ┌─────────────────────────────────────────────────────────────┐
  │ YAML modes 代码块说明                                        │
  │                                                             │
  │ 每个模式有以下字段：                                          │
  │ - id: 唯一标识符（必填）— 必须与下方 ## 标题一致               │
  │ - label: 按钮显示文本（必填）— Harness 面板上的按钮标签        │
  │ - emoji: 按钮图标（可选，默认 📋）                            │
  │ - files: 上下文文件列表（可选）— 点击模式时自动注入到对话上下文  │
  │   支持两种格式：                                              │
  │   - 普通路径: ${sourceFolder}/some-note.md                   │
  │   - Wikilink: [[笔记名]]                                    │
  │   支持变量替换：                                              │
  │   - {active_project} → _INDEX.md 中的 active_project 值      │
  │   - {active_work_context} → _INDEX.md 中的 active_work_context 值 │
  │                                                             │
  │ 你可以自由添加、删除、重排模式。以下 4 个是预设示例。           │
  └─────────────────────────────────────────────────────────────┘
-->

\`\`\`yaml modes
- id: chat
  label: 自由对话
  emoji: "💬"
  files: []
- id: inbox
  label: 处理 Inbox
  emoji: "📥"
  files:
    - ${harnessInboxFile}
- id: feed
  label: 生成 Feed
  emoji: "📰"
  files: []
- id: organize
  label: 整理知识
  emoji: "🗂️"
  files: []
\`\`\`

<!--
  ┌─────────────────────────────────────────────────────────────┐
  │ 模式 Prompt 说明                                             │
  │                                                             │
  │ 每个 ## {id} 标题下的全部内容都会作为 system prompt 注入。     │
  │ 这是你控制 AI 行为的核心机制。                                │
  │                                                             │
  │ 编写建议：                                                   │
  │ - 明确角色和目标（"你是..."）                                 │
  │ - 列出具体步骤（让 AI 知道该按什么流程工作）                   │
  │ - 指定要使用的工具（AI 不会主动发现工具，需要你告诉它）         │
  │ - 指定输出格式和存放位置                                      │
  │                                                             │
  │ 你可以完全重写以下 prompt，它们只是起点。                      │
  │ 也可以添加全新的模式：在 YAML 块中加条目 + 添加对应 ## 段落。  │
  └─────────────────────────────────────────────────────────────┘
-->

## chat

<!--
  自由对话模式 — 无特定任务，通用知识管理助手。
  这个 prompt 比较简短，因为自由对话不需要严格的流程指引。
  你可以在这里加入个人偏好，比如"用中文回复"、"回答要简洁"等。
-->

你是一个知识管理助手，帮助用户探索和整理知识库中的内容。

可以使用 vault 工具读取、搜索笔记，联网搜索获取最新信息，并将有价值的内容写入知识库。

## inbox

<!--
  Inbox 处理模式 — 处理待办事项。
  files 中配置了 ${harnessInboxFile}，点击此模式时会自动将 inbox 内容注入上下文。
  你可以修改处理逻辑，比如添加优先级判断、自动分类等步骤。
-->

请帮我处理 Inbox 中的待办事项。

流程：
1. 读取 Inbox 文件，查看所有 \`- [ ]\` 待办项
2. 逐个处理：搜索知识库中的相关内容，给出建议或直接执行
3. 完成的项目标记为 \`- [x]\`
4. 需要深入研究的内容，创建笔记到 \`${sourceFolder}/\`

## feed

<!--
  Feed 生成模式 — 从订阅源抓取资讯并生成 Feed 笔记。
  核心工具：fetch_feeds（批量抓取配置的订阅源）、fetch_rss（抓取任意 RSS）
  你可以修改关注的主题、筛选标准、输出格式等。
  比如改为只关注特定领域，或改为生成英文 Feed。
-->

你是一个信息策展助手。请帮我生成今天的精选资讯 Feed。

流程：
1. 使用 fetch_feeds 工具获取最新文章
2. 用 search_vault 检查知识库中已有的相关内容，避免推荐旧闻
3. 筛选最有价值的 10-15 篇，按重要程度排序
4. 每篇给出：标题、来源、一句话摘要、为什么值得关注
5. 最后总结今天的整体趋势

输出要求：
- frontmatter 包含 type: feed, date: 今天日期
- 用 create_note 保存到 Feed/Feed-{日期}.md

## organize

<!--
  知识整理模式 — 将原始素材整理为结构化知识条目。
  此模式从 ${sourceFolder}/ 中找未整理的笔记，提炼核心内容后存入 ${wikiFolder}/。
  你可以修改整理标准、目标结构、输出格式等。
-->

请帮我整理 \`${sourceFolder}/\` 中未整理的笔记。

流程：
1. 用 list_notes 查看 \`${sourceFolder}/\` 中的笔记
2. 筛选没有 \`organized: true\` 标记的笔记
3. 逐篇用 read_note 阅读内容
4. 用 search_vault 在 \`${wikiFolder}/\` 中搜索相关条目
5. 有相关条目 → edit_note 补充新信息；没有 → create_note 创建新条目
6. 新条目包含 frontmatter（tags、summary）和 [[wiki-link]] 交叉引用
7. 用 update_frontmatter 标记原笔记 organized: true

每篇处理完后告诉我做了什么。
`,
	});

	// ── inbox.md template ───────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/inbox.md`,
		content: `<!--
  使用说明：
  - 将本文件复制到 ${harnessInboxFile}
  - Harness 面板会统计此文件中 "- [ ]" 的数量并显示为待办计数
  - inbox 模式点击时会将此文件内容注入 AI 对话上下文

  格式要求：
  - 待办项用 "- [ ] " 开头（Obsidian 标准任务格式）
  - 完成的项目用 "- [x] " 标记
  - 你可以添加任意其他内容（标题、分隔线、注释等），
    插件只关心 "- [ ]" 和 "- [x]" 行

  示例条目可以删除，替换为你自己的待办。
-->

# Inbox

- [ ] 示例待办：阅读最新的 AI 论文
- [ ] 示例待办：整理上周的学习笔记
`,
	});

	return files;
}
