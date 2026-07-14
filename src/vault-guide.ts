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

Cortex 插件依赖 vault 中的特定文件和格式来驱动 AI 功能。
本文件夹提供**参考模板**，帮助你（或 AI agent）快速搭建正确的结构。

**重要：这些文件不会自动生效。** 你需要将它们复制到正确位置。
每个文件内部都有详细注释说明格式要求和可自定义的部分。

## 修改设置后请重新生成

所有路径都来自**生成时的插件设置**。如果你修改了设置中的文件夹名称，
请到设置页重新点击「生成模板」按钮，否则模板中的路径会与实际设置不匹配。

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

| 模板文件 | 复制到 | 说明 |
|----------|--------|------|
| \`CLAUDE.md\` | vault 根目录 | Claude Code agent 指南（全文可自由修改） |
| \`_INDEX.md\` | \`${harnessProjectsFolder}/_INDEX.md\` | 项目索引（**格式有严格要求**，见文件内注释） |
| \`modes.md\` | \`${harnessProjectsFolder}/{项目名}/modes.md\` | 模式定义（**YAML 块格式有严格要求**） |
| \`PROGRESS.md\` | \`${harnessProjectsFolder}/{项目名}/PROGRESS.md\` | 项目进展（格式影响状态栏显示） |
| \`inbox.md\` | \`${harnessInboxFile}\` | Inbox 待办（格式影响待办计数） |
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
  - 本文件的内容全部可以自由修改，它是指导 AI 的 prompt，不是代码依赖
  - 但请注意：下方提到的 frontmatter 字段名和格式是代码硬依赖的，不可随意改名

  本文件根据当前 Cortex 插件设置生成（${today}）。
-->

## 文件夹结构

| 文件夹 | 用途 | 说明 |
|--------|------|------|
| \`${sourceFolder}/\` | 原始素材 | 文章、笔记、网页剪藏等未整理的内容 |
| \`${wikiFolder}/\` | 知识条目 | 整理后的结构化知识 |
| \`Feed/\` | 资讯 Feed | AI 生成的资讯，文件名格式 \`Feed-YYYY-MM-DD.md\` |
| \`${harnessProjectsFolder}/\` | 项目配置 | Harness 模式系统配置（见 _INDEX.md 和 modes.md 模板） |
| \`${chatHistoryFolder}/\` | 对话存档 | 自动管理，无需手动操作 |

## Frontmatter 规范（代码强依赖）

<!--
  ⚠️ 重要：以下字段名是代码硬编码的，修改字段名会导致功能异常。
  字段的值可以自定义，但名称和类型必须严格遵循。
-->

Cortex 的多个功能依赖笔记开头的 YAML frontmatter。格式要求：

\`\`\`yaml
---
tags: [标签1, 标签2]              # 类型：数组 或 逗号分隔字符串
summary: 一句话摘要               # 类型：字符串
organized: true                   # 类型：布尔值（true/false）
auto-tagged: true                 # 类型：布尔值
type: note                        # 类型：字符串
date: ${today}                    # 类型：字符串 YYYY-MM-DD
---
\`\`\`

### 各字段详解

| 字段 | 谁使用 | 说明 |
|------|--------|------|
| \`tags\` | 自动标注、知识整理、健康检查 | **数组格式**如 \`[ai, rag]\` 或**逗号字符串**如 \`ai, rag\`，两种都支持。小写，去掉 \`#\` 前缀。健康检查会报告缺少 tags 的笔记 |
| \`summary\` | 自动标注、健康检查 | 一句话摘要。健康检查会报告缺少 summary 的笔记 |
| \`organized\` | 知识整理 | 必须是**布尔值 \`true\`**（不是字符串 "true"）。标记为 true 的笔记会被「整理知识库」命令跳过 |
| \`auto-tagged\` | 自动标注 | 布尔值。已标注的笔记不会被重复标注。此字段由插件自动写入 |
| \`type\` | Feed 生成 | Feed 笔记用 \`feed\`，播客 Feed 用 \`podcast-feed\` |
| \`date\` | Feed 生成 | \`YYYY-MM-DD\` 格式 |

### Frontmatter 格式限制

插件的 frontmatter 解析器是简化版 YAML，有以下限制：
- **仅支持单行键值对** — 如 \`key: value\`。不支持多行值、嵌套对象
- **数组** — 只支持单行格式 \`[a, b, c]\`，不支持多行 \`-\` 列表格式
- **布尔值** — \`true\` 和 \`false\` 会自动转为布尔类型
- **数字** — 纯数字字符串会自动转为数字类型

你也可以添加自定义字段，插件会忽略不认识的字段。

## Wiki 条目写作规范

\`${wikiFolder}/\` 中的条目建议遵循：

1. **文件名即概念名** — 如 \`RAG.md\`、\`Transformer.md\`
2. **开头一句话定义** — 快速说明这个概念是什么
3. **使用 [[wiki-link]]** — 用 \`[[条目名]]\` 链接相关概念
4. **复用已有 tags** — 优先使用 vault 中已有的标签
5. **子文件夹** — 可用子文件夹归类，如 \`${wikiFolder}/AI/\`

## 可用工具

### Vault 操作
| 工具 | 功能 |
|------|------|
| \`read_note\` | 读取指定路径的笔记全文 |
| \`search_vault\` | 关键词搜索，支持按文件夹和标签过滤 |
| \`list_notes\` | 列出文件夹中的笔记（按修改时间排序） |
| \`create_note\` | 创建新笔记（可含 frontmatter） |
| \`edit_note\` | 编辑笔记（支持按 heading 定位段落） |
| \`append_to_note\` | 在笔记末尾追加内容 |
| \`rename_note\` | 重命名/移动笔记 |
| \`delete_note\` | 删除笔记 |
| \`update_frontmatter\` | 修改 YAML frontmatter（set 和 delete 操作） |
| \`get_links\` | 获取反向链接和正向链接 |

### 资讯获取
| 工具 | 功能 |
|------|------|
| \`fetch_feeds\` | 从配置的订阅源批量抓取，自动评分排序 |
| \`fetch_rss\` | 抓取任意 RSS/Atom feed URL |
| \`web_search\` | 联网搜索 |
| \`web_fetch\` | 抓取网页内容 |
${enablePodcast ? "| `podcast_search` | 搜索播客（iTunes API） |\n| `podcast_episodes` | 获取播客最新剧集 |\n| `podcast_transcript` | 提取播客文字稿 |\n" : ""}${enableWeRead ? "| `weread_api` | 微信读书 API |\n" : ""}
## 图片引用格式

AI 可以识别笔记中的本地图片，支持两种格式：
- Wikilink: \`![[photo.png]]\` 或 \`![[photo.png|alt text]]\`
- Markdown: \`![alt](attachments/photo.png)\`（仅本地路径，HTTP URL 不处理）

支持的格式：png, jpg, jpeg, webp, gif。

## Feed 文件命名规则

Feed 功能生成的文件遵循固定命名：
- 资讯 Feed: \`Feed/Feed-YYYY-MM-DD.md\`
- 播客 Feed: \`Feed/Podcast-YYYY-MM-DD.md\`

插件通过这个命名规则来做跨日去重（检查最近 3 天的 Feed 内容避免重复推荐）。
如果你手动创建 Feed 笔记，建议也遵循这个命名格式。
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
  - 插件读取此文件来确定当前活跃项目和加载对应的模式

  ⚠️ 格式要求（代码强依赖，不可随意修改格式）：

  【Frontmatter 字段】
  - active_project: 当前活跃项目的文件夹名（必填）
    必须与 ${harnessProjectsFolder}/ 下的某个子文件夹名完全一致
    插件会去读取 ${harnessProjectsFolder}/{active_project}/modes.md
    切换项目时，插件会用正则 ^(active_project:\\s*).*$ 替换此行

  - active_work_context: 工作上下文标识（可选，可为空字符串）
    用于替换 modes.md 中 files 路径里的 {active_work_context} 变量
    例如某个 mode 的 files 包含 "Reports/{active_work_context}/data.md"，
    而 active_work_context 设为 "Q2-2026"，则实际加载 "Reports/Q2-2026/data.md"

  【正文表格】
  - 必须是管道符 | 分隔的 Markdown 表格
  - 必须有且仅有 4 列：项目 | 状态 | 来源 | 最近更新
  - 第一行是表头，第二行是分隔线（|---|），从第三行开始是数据
  - 「项目」列的值应与 ${harnessProjectsFolder}/ 下的文件夹名一致
  - 「状态」列：如果值恰好是 "active"，Harness 面板中会显示绿色圆点
  - 「来源」列和「最近更新」列可填任意文本，插件只读取不解析
  - 可以添加任意多行项目
-->

# 项目索引

| 项目 | 状态 | 来源 | 最近更新 |
|------|------|------|----------|
| default | active | — | ${today} |
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
  - 切换模式时，对应的 system prompt 会注入到 AI 对话中
-->

# 模式定义

<!--
  ⚠️ YAML modes 代码块格式要求（代码强依赖）：

  1. 代码块标记必须是 \`\`\`yaml modes 或 \`\`\`yml modes
     "modes" 这个词是必须的！没有它插件找不到这个代码块
     ❌ 错误: \`\`\`yaml       （缺少 modes 关键词）
     ✅ 正确: \`\`\`yaml modes

  2. 每个模式条目必须以 "- id:" 开头（行首，无缩进）
     后续字段必须缩进（空格缩进）

  3. 字段说明：
     - id: 唯一标识符（必填）— 必须与下方 ## 标题完全一致
     - label: 按钮显示文本（必填）— 没有 label 的模式会被忽略
     - emoji: 按钮图标（可选，默认 📋）— 支持引号包裹
     - files: 上下文文件列表（可选）
       如果有文件：写成多行格式，每行一个 "    - 路径"
       如果无文件：写成 "files: []" 或 "files:" 后面空着
       ❌ 不支持: files: [file1.md, file2.md]（单行数组格式）
     - actions: 快捷动作按钮列表（可选）— 显示在 Chat 封面上
       每个 action 必须以 "    - label:" 开头
       支持字段：label（必填）、prompt（必填）、icon（可选，Lucide 图标名）
       点击按钮 = 切换到该模式 + 自动发送 prompt
       路径支持两种格式：
       - vault 路径: ${sourceFolder}/some-note.md
       - Wikilink: [[笔记名]]
       路径中可用变量：
       - {active_project} → 替换为 _INDEX.md 中的 active_project 值
       - {active_work_context} → 替换为 _INDEX.md 中的 active_work_context 值

  4. 你可以自由添加、删除、重排模式

  5. actions（可选）：定义显示在 Chat 封面上的快捷动作按钮
     每个 action 需要 label 和 prompt 字段，icon 可选（使用 Lucide 图标名）
     点击按钮 = 切换到该模式 + 自动发送预设 prompt
     ❌ 错误: actions 缩进不对或缺少 label/prompt
     ✅ 正确: 见下方示例中 feed 模式的 actions 写法
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
  actions:
    - label: 生成今日 Feed
      icon: rss
      prompt: "抓取今日资讯并生成 Feed 日报"
    - label: 抓取播客更新
      icon: mic
      prompt: "检查播客订阅源，生成播客摘要"
- id: organize
  label: 整理知识
  emoji: "🗂️"
  files: []
  actions:
    - label: 整理未归类笔记
      icon: sparkles
      prompt: "扫描未整理的笔记并归类到 Wiki"
    - label: 知识健康检查
      icon: heart-pulse
      prompt: "运行知识库健康检查，报告孤岛和重复"
\`\`\`

<!--
  ⚠️ 模式 Prompt 段落格式要求（代码强依赖）：

  1. 每个模式的 prompt 必须放在 ## {id} 标题下
     标题文本必须与 YAML 中的 id 完全一致（大小写敏感）
     ❌ 错误: ## Chat       （id 是 "chat"，大小写不匹配）
     ✅ 正确: ## chat

  2. 从 ## 标题到下一个 ## 标题（或文件末尾）之间的所有内容
     都会作为该模式的 system prompt 注入到 AI 对话中

  3. prompt 内容完全自由，以下只是示例。你可以：
     - 完全重写 prompt
     - 添加新的模式（在 YAML 块加条目 + 添加对应 ## 段落）
     - 删除不需要的模式
     - 引用工具名称来指导 AI 使用特定工具

  4. HTML 注释 <!-- --> 也会被包含在 prompt 中（但 AI 通常会忽略注释标记）
     如果不想让某些说明出现在 prompt 里，请在部署前删除注释
-->

## chat

你是一个知识管理助手，帮助用户探索和整理知识库中的内容。

可以使用 vault 工具读取、搜索笔记，联网搜索获取最新信息，并将有价值的内容写入知识库。

## inbox

请帮我处理 Inbox 中的待办事项。

流程：
1. 读取 Inbox 文件，查看所有 \`- [ ]\` 待办项
2. 逐个处理：搜索知识库中的相关内容，给出建议或直接执行
3. 完成的项目标记为 \`- [x]\`
4. 需要深入研究的内容，创建笔记到 \`${sourceFolder}/\`

## feed

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

	// ── PROGRESS.md template ────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/PROGRESS.md`,
		content: `<!--
  使用说明：
  - 将本文件复制到 ${harnessProjectsFolder}/{项目名}/PROGRESS.md
    例如：${harnessProjectsFolder}/default/PROGRESS.md
  - 此文件是可选的，但如果存在，Harness 面板会显示项目进展摘要

  ⚠️ 格式要求（代码强依赖）：

  插件从文件**底部往上**扫描，提取两个状态：

  1. 最近完成项（lastDone）:
     从底部往上找第一个 "- [x]" 开头的行，提取其后的文本
     例如: "- [x] 完成了 API 开关功能" → 显示 "完成了 API 开关功能"

  2. 下一步（nextStep）:
     从底部往上找第一个 "- [ ]" 或 "- []" 开头的行，提取其后的文本
     例如: "- [ ] 实现 Feed 工具" → 显示 "实现 Feed 工具"

  3. 兜底：如果找不到上述格式，会用最后一个 ## 标题作为 lastDone

  建议用法：
  - 最新的内容写在文件底部
  - 用 "- [x]" 标记已完成的里程碑
  - 用 "- [ ]" 标记待办事项
  - 可以用 ## 标题来分组（按日期、按阶段等）
-->

# 项目进展

## ${today}

- [x] 初始化项目
- [ ] 配置工作模式
`,
	});

	// ── inbox.md template ───────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/inbox.md`,
		content: `<!--
  使用说明：
  - 将本文件复制到 ${harnessInboxFile}
  - 如果目标路径的父文件夹不存在，需要先创建

  ⚠️ 格式要求（代码强依赖）：

  【待办计数】
  Harness 面板会统计此文件中所有 "- [ ]" 行的数量作为待办计数。
  注意：
  - 必须是 "- [ ] " 格式（短横线 + 空格 + 方括号包裹空格 + 空格）
  - "- [x]" 不计入（已完成）
  - 大小写敏感，"- [X]" 也不计入

  【AI 写入格式】
  当用户在对话中点击「保存到 Inbox」按钮时，插件会写入如下格式：
    - [ ] [AI 对话] {内容摘要}
  并且会：
  1. 查找文件中是否有 "## YYYY-MM-DD" 格式的日期标题（当天日期）
  2. 如果有 → 在该标题后面插入新条目
  3. 如果没有 → 在第一个 "## " 标题前插入新的日期标题和条目
  4. 如果文件不存在 → 创建文件，内容为 "# Inbox\\n\\n## YYYY-MM-DD\\n条目"

  因此建议：
  - 文件第一行用 # Inbox 作为主标题
  - 用 ## YYYY-MM-DD 格式的二级标题来按日期分组
  - 手动添加的待办也放在对应日期标题下
-->

# Inbox

## ${today}

- [ ] 示例待办：阅读最新的 AI 论文
- [ ] 示例待办：整理上周的学习笔记
`,
	});

	return files;
}
