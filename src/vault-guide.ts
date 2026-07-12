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

	const files: GuideFile[] = [];

	// ── README ──────────────────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/README.md`,
		content: `# Cortex Vault 参考模板

> **本文件夹由 Cortex 插件根据当前设置自动生成。**
> 如果你修改了插件设置（文件夹路径、功能开关等），请重新生成此模板。
>
> 这些文件是**参考模板**，不会自动应用。你可以：
> 1. 手动复制到对应位置
> 2. 让 Claude Code 参照这些模板初始化你的 vault

## 当前设置摘要

| 配置项 | 值 |
|--------|-----|
| 知识库文件夹 | ${knowledgeFolders.join(", ")} |
| 对话存档 | ${chatHistoryFolder} |
| 自动标注文件夹 | ${autoTagFolders.join(", ")} |
| 蒸馏目标 | ${wikiFolder} |
| 项目文件夹 | ${harnessProjectsFolder} |
| Inbox 文件 | ${harnessInboxFile} |
| 自动标注 | ${enableAutoTagging ? "开启" : "关闭"} |
| 播客工具 | ${enablePodcast ? "开启" : "关闭"} |
| 微信读书 | ${enableWeRead ? "开启" : "关闭"} |

## 文件列表

| 模板文件 | 目标位置 | 说明 |
|----------|----------|------|
| \`CLAUDE.md\` | vault 根目录 | Claude Code agent 指南 |
| \`_INDEX.md\` | \`${harnessProjectsFolder}/_INDEX.md\` | 项目索引 |
| \`modes.md\` | \`${harnessProjectsFolder}/{项目名}/modes.md\` | 模式定义 |
| \`inbox.md\` | \`${harnessInboxFile}\` | Inbox 待办 |
`,
	});

	// ── CLAUDE.md template ──────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/CLAUDE.md`,
		content: `# Vault 规范 — Cortex AI 知识管理

> 本文件供 Claude Code agent 参考，理解此 vault 的结构和规范。

## 文件夹结构

| 文件夹 | 用途 |
|--------|------|
${knowledgeFolders.map((f) => `| \`${f}/\` | 知识库文件夹 |`).join("\n")}
| \`${sourceFolder}/\` | 原始素材（文章、笔记、剪藏） |
| \`${wikiFolder}/\` | 整理后的知识条目 |
| \`Feed/\` | AI 生成的资讯 Feed |
| \`${harnessProjectsFolder}/\` | 项目与模式配置 |
| \`${chatHistoryFolder}/\` | 对话存档（JSON） |

## Frontmatter 规范

所有知识库笔记应包含 YAML frontmatter：

\`\`\`yaml
---
tags: [主题标签1, 主题标签2]
summary: 一句话摘要
date: YYYY-MM-DD
type: note | wiki | feed | podcast-feed
organized: true  # 已整理到 ${wikiFolder} 的标记
---
\`\`\`

### 规则
- **tags**: 小写，用已有标签，避免同义重复（如不要同时用 "llm" 和 "large-language-model"）
- **summary**: 一句话概括核心内容，帮助搜索和自动摘要
- **organized**: \`${sourceFolder}/\` 中的笔记整理到 \`${wikiFolder}/\` 后标记为 true

## Wiki 条目写作规范

\`${wikiFolder}/\` 中的条目应遵循：

1. **文件名即概念名** — 简洁准确，如 \`RAG.md\`、\`Transformer.md\`
2. **开头一句话定义** — 什么是这个概念
3. **交叉引用** — 使用 \`[[Wiki 条目名]]\` 链接相关概念
4. **Tag 复用** — 查看已有 tags，优先复用而非新建
5. **子文件夹** — 相关条目多时可用子文件夹归类，如 \`${wikiFolder}/AI/\`

## 项目与模式系统（Harness）

项目配置在 \`${harnessProjectsFolder}/\` 下：

- \`_INDEX.md\`: 项目索引，frontmatter 中 \`active_project\` 指定当前项目
- \`{项目名}/modes.md\`: 定义该项目的工作模式和对应 prompt
- \`{项目名}/PROGRESS.md\`: 项目进展记录

## 可用工具

Claude 在对话中可使用以下工具：

### Vault 操作
- \`read_note\` / \`search_vault\` / \`list_notes\` — 读取和搜索
- \`create_note\` / \`edit_note\` / \`append_to_note\` — 写入
- \`rename_note\` / \`delete_note\` — 管理
- \`update_frontmatter\` / \`get_links\` — 元数据和链接

### 资讯获取
- \`fetch_feeds\` — 从配置的订阅源批量抓取（RSS/HN/Reddit/GitHub Trending）
- \`fetch_rss\` — 抓取任意 RSS/Atom feed
- \`web_search\` / \`web_fetch\` — 联网搜索和网页抓取
${enablePodcast ? "- `podcast_search` / `podcast_episodes` / `podcast_transcript` — 播客搜索和文字稿\n" : ""}${enableWeRead ? "- `weread_api` — 微信读书 API\n" : ""}
## 工作流

### 知识整理流程
1. 新素材存入 \`${sourceFolder}/\`
${enableAutoTagging ? `2. 自动标注为 frontmatter tags + summary\n` : ""}${enableAutoTagging ? "3" : "2"}. 使用「整理知识库」命令，AI 将素材提炼为 \`${wikiFolder}/\` 条目
${enableAutoTagging ? "4" : "3"}. 原始笔记标记 \`organized: true\`

### Feed 生成
使用 Harness 面板的 feed 模式，或在对话中让 AI 调用 \`fetch_feeds\` 工具获取最新资讯并生成 Feed 笔记。
`,
	});

	// ── _INDEX.md template ──────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/_INDEX.md`,
		content: `---
active_project: default
active_work_context: ""
---

# 项目索引

> 复制到 \`${harnessProjectsFolder}/_INDEX.md\`

| 项目 | 状态 | 来源 | 最近更新 |
|------|------|------|----------|
| default | 活跃 | — | ${new Date().toISOString().slice(0, 10)} |
`,
	});

	// ── modes.md template ───────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/modes.md`,
		content: `# 模式定义

> 复制到 \`${harnessProjectsFolder}/{项目名}/modes.md\`

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
5. 有相关条目 → edit_note 补充；没有 → create_note 创建新条目
6. 新条目包含 frontmatter（tags、summary）和 [[wiki-link]]
7. 用 update_frontmatter 标记原笔记 organized: true
`,
	});

	// ── inbox.md template ───────────────────────────────────────────
	files.push({
		path: `${GUIDE_FOLDER}/inbox.md`,
		content: `# Inbox

> 复制到 \`${harnessInboxFile}\`

- [ ] 示例待办：阅读最新的 AI 论文
- [ ] 示例待办：整理上周的学习笔记
`,
	});

	return files;
}
