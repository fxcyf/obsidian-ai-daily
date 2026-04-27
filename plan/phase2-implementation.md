# 阶段二实施计划：Agentic Vault — 从只读到读写

**状态**: 🔧 进行中

## 概述

让 Claude 从"查询助手"变为"知识库 Agent"，能自主创建、编辑、整理笔记。按依赖关系分 4 批实现。

---

## 批次 1：完整笔记 CRUD 工具集（P0）

> 所有后续功能的前置条件。在 `vault-tools.ts` 中新增 5 个工具。

### 1.1 create_note

- **作用**: 创建带 frontmatter 的新笔记
- **实现**: `vault.create(path, content)`
- **要点**:
  - 检查路径不存在，防止覆盖
  - 支持传入 frontmatter 对象，自动序列化为 YAML
  - 自动创建中间目录（如 `Wiki/CS/note.md`）
- **input_schema**: `{ path: string, content: string, frontmatter?: object }`

### 1.2 edit_note

- **作用**: 替换笔记中指定段落/区块
- **实现**: `vault.cachedRead()` → 定位替换 → `vault.modify()`
- **要点**:
  - 支持三种定位模式：
    - `heading`: 按标题定位整个 section（含子标题）
    - `line_range`: 按行号范围 `{start, end}`
    - `search_replace`: 按原文匹配替换（最精确）
  - 替换前返回预览，防止意外覆盖
- **input_schema**: `{ path: string, mode: "heading"|"line_range"|"search_replace", target: string|{start,end}, replacement: string }`

### 1.3 rename_note

- **作用**: 重命名/移动笔记，自动更新所有引用
- **实现**: `app.fileManager.renameFile(file, newPath)`
- **要点**:
  - Obsidian API 自动更新反向链接
  - 检查目标路径不存在
- **input_schema**: `{ path: string, new_path: string }`

### 1.4 delete_note

- **作用**: 删除笔记（两步确认机制）
- **实现**:
  - 第一次调用：返回笔记摘要 + 确认提示，不执行删除
  - Claude 需在对话中获取用户确认后，带 `confirmed: true` 再次调用
  - 实际删除使用 `vault.trash(file, true)`（移到系统回收站）
- **input_schema**: `{ path: string, confirmed?: boolean }`

### 1.5 update_frontmatter

- **作用**: 修改笔记的 YAML frontmatter
- **实现**: 解析现有 frontmatter → merge 新字段 → 写回
- **要点**:
  - 支持 `set`（设置/覆盖）和 `delete`（删除字段）操作
  - 如果笔记没有 frontmatter，自动创建
  - 保留未修改的字段
- **input_schema**: `{ path: string, set?: object, delete?: string[] }`

### 批次 1 验收标准

- [x] Claude 可在对话中完成"读 Raw 笔记 → 整理 → 创建新 Wiki 条目 → 打标签"全流程
- [x] 写操作不会静默覆盖已有内容
- [x] delete_note 必须经过确认才执行
- [x] 所有工具有路径遍历保护
- [x] 现有 4 个工具（read/search/append/list）行为不变
- [x] `npm test` 通过

---

## 批次 2a：知识图谱感知

> 利用 Obsidian metadataCache API，让 Claude 理解笔记间关系。

### 2a.1 get_links 工具

- **作用**: 获取笔记的双向链接关系
- **实现**: 利用 `metadataCache.resolvedLinks` 和反向遍历
- **返回**:
  - `outlinks`: 该笔记链接到的其他笔记
  - `backlinks`: 链接到该笔记的其他笔记
  - 每个链接附带笔记标题和路径
- **input_schema**: `{ path: string }`

### 批次 2a 验收标准

- [x] Claude 可查询任意笔记的双向链接
- [x] 结果准确反映 vault 实际链接状态
- [x] 不存在的笔记返回友好错误

---

## 批次 2b：本地图片处理

> 让 Raw 笔记中的本地图片可被 AI 理解，实现多模态对话。

### 2b.1 新建 `src/image-tools.ts`

**Phase 1 — 图片引用解析：**
- `extractLocalImageRefs(text, noteContent?)` → `ImageRef[]`
- 解析格式：`![[img.png]]`、`![[dir/img.jpg|300]]`、`![alt](./img.webp)`
- 过滤 http/https URL
- 去重

**Phase 2 — 二进制读取与校验：**
- `prepareLocalImages(app, refs, opts)` → `{ images: PreparedImage[], skipped: SkippedImage[] }`
- 白名单 MIME：png/jpeg/webp/gif
- 限制：单图最大 3MB（可配置），单次最多 3 张（可配置）
- 使用 `vault.adapter.readBinary()` 读取

### 2b.2 扩展 `claude.ts` 消息体

- 用户消息从纯 `string` 扩展为 `ContentBlock[]`
- 支持 `{ type: "image", source: { type: "base64", media_type, data } }`
- 仅对用户消息注入图片，assistant/tool_result 保持不变

### 2b.3 扩展 `chat-view.ts`

- 发送消息前调用 `extractLocalImageRefs()` + `prepareLocalImages()`
- 通过 Obsidian Notice 提示：使用了几张图片、跳过了哪些

### 2b.4 Settings 新增

```
enableLocalImageInput: boolean     // 默认 true
maxImagesPerMessage: number        // 默认 3
maxImageBytes: number              // 默认 3145728 (3MB)
```

### 批次 2b 验收标准

- [ ] 笔记中引用本地图片后，可在对话中对图片提问
- [ ] 图片处理失败不中断文本流程
- [ ] 超限/缺失/格式不支持时有 Notice 提示
- [ ] 不含图片的对话行为不变
- [ ] Settings 可控
- [ ] 单元测试覆盖 `extractLocalImageRefs()`

---

## 批次 3：笔记自动标注

> 新笔记自动生成 tags + summary。

### 3.1 实现

- **监听**: `vault.on('create')` + `vault.on('modify')` 事件（在 `main.ts` 注册）
- **Debounce**: 5s 延迟，避免编辑中反复触发
- **防重复**: 检查 frontmatter `auto-tagged: true`
- **标签约束**: 收集 vault 已有 tag 列表作为 prompt 约束，减少标签膨胀
- **写入**: 通过批次 1 的 `update_frontmatter` 工具写入 tags + summary
- **成本**: 每次约 500-1k tokens

### 3.2 Settings 新增

```
enableAutoTagging: boolean           // 默认 false
autoTagFolders: string[]             // 默认 ["Raw"]
autoTagPrompt: string                // 自定义标注 prompt（可选）
```

### 批次 3 验收标准

- [ ] 在 Raw/ 中创建新笔记后，自动生成 tags 和 summary
- [ ] 已标注笔记不会重复标注
- [ ] 标签优先复用已有标签体系
- [ ] Settings 开关有效
- [ ] 不影响非目标文件夹

---

## 批次 4：批量知识整理 + 对话知识蒸馏

> 高级 agentic 功能，依赖批次 1 的 CRUD 工具集。

### 4.1 批量知识整理 Agent

- **触发**: 新增命令「整理知识库」（在 `main.ts` 注册）
- **流程**:
  1. 扫描 Raw/ 中 `organized: true` 为 false 或缺失的笔记
  2. 每次限 5 篇
  3. 对每篇：提取核心观点 → search_vault 查找相关 Wiki → 决定更新/创建
  4. 自动添加 wiki-link、补充 frontmatter
  5. 标记 `organized: true`
- **实现**: 新建 `src/knowledge-agent.ts`，利用 ClaudeClient agentic loop
- **UI**: 进度通过 Obsidian Notice 展示

### 4.2 对话驱动知识蒸馏

- **触发**: 聊天 header 新增「蒸馏」按钮 / 命令
- **流程**:
  1. Claude 分析当前对话历史
  2. 提取事实性知识（排除闲聊）
  3. 匹配现有 Wiki 条目：存在则更新，不存在则创建
  4. 标记来源对话 ID
  5. 维护 wiki-link 关系
- **Settings**:
  ```
  enableAutoDistill: boolean          // 默认 false
  distillTargetFolder: string         // 默认 "Wiki"
  ```

### 批次 4 验收标准

- [ ] 「整理知识库」命令可自动整理 Raw/ 笔记
- [ ] 整理结果结构合理，有 tags + wiki-link
- [ ] 蒸馏按钮可提取对话知识为 Wiki 条目
- [ ] 每步操作有进度提示
- [ ] 不会处理已整理/已标注的笔记

---

## 文件改动预估

| 批次 | 新增/修改文件 | 预估行数 |
|------|-------------|---------|
| 批次 1 | vault-tools.ts, claude.ts, chat-view.ts | ~400 行 |
| 批次 2a | vault-tools.ts, claude.ts | ~100 行 |
| 批次 2b | 新建 image-tools.ts, claude.ts, chat-view.ts, settings.ts | ~350 行 |
| 批次 3 | main.ts, settings.ts, claude.ts | ~200 行 |
| 批次 4 | 新建 knowledge-agent.ts, chat-view.ts, main.ts, settings.ts | ~300 行 |

## 版本规划

- 批次 1 + 2a → v0.7.0（CRUD + 图谱感知）
- 批次 2b → v0.7.1（图片支持）
- 批次 3 → v0.7.2（自动标注）
- 批次 4 → v0.8.0（知识整理 Agent）

## 每批次完成后必须

- [ ] `npm test` 全绿
- [ ] 更新 TEST.md
- [ ] 更新 README.md
- [ ] 更新 CLAUDE.md（如架构变化）
- [ ] 更新 roadmap.md 状态标记
- [ ] 版本号三处同步更新
