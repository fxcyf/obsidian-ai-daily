# 测试指南

## 运行测试

```bash
npm test          # 单次运行
npm run test:watch # 监听模式
```

## 测试文件

| 文件 | 覆盖范围 |
|------|---------|
| `src/anthropic-sse.test.ts` | SSE 解析与 ApiResponse 组装 |
| `src/feeds.test.ts` | timeDecay, socialBoost, detectBursts, scoreRelevance |
| `src/chat-session.test.ts` | newSessionId, titleFromMessages, isValidChatSession, shouldPruneToday |
| `src/vault-tools.test.ts` | parseFrontmatter, serializeFrontmatter, findHeadingRange |
| `src/image-tools.test.ts` | extractLocalImageRefs（wikilink/markdown 图片解析、去重、过滤） |
| `src/auto-tagger.test.ts` | parseTaggingResponse（JSON 解析、容错、字段过滤） |

## 手动测试清单（UX 功能）

### Prompt 模板
- [ ] 输入 `/` 弹出模板列表
- [ ] 输入 `/翻` 过滤出翻译相关模板
- [ ] 上下键导航，Enter 选择模板
- [ ] Esc 关闭弹窗
- [ ] 选择模板后文本填入输入框
- [ ] 设置中可添加/编辑/删除自定义模板

### 笔记引用可点击
- [ ] AI 回复中 `[[已存在笔记]]` 显示为蓝色可点击链接
- [ ] 点击链接跳转到对应笔记
- [ ] `[[不存在笔记]]` 显示为灰色不可点击
- [ ] 代码块和行内代码中的 `[[]]` 不被处理

### 代码块复制
- [ ] 鼠标悬停代码块时出现复制按钮
- [ ] 点击复制按钮，代码复制到剪贴板
- [ ] 按钮短暂显示为"已复制"状态

### 笔记 CRUD 工具
- [ ] 对话中让 Claude 创建新笔记（`create_note`），验证文件和 frontmatter 正确生成
- [ ] 让 Claude 编辑已有笔记的某个段落（`edit_note` search_replace 模式）
- [ ] 让 Claude 按标题替换整个 section（`edit_note` heading 模式）
- [ ] 让 Claude 重命名笔记（`rename_note`），验证反向链接更新
- [ ] 让 Claude 删除笔记（`delete_note`），第一次应返回预览确认，第二次才执行
- [ ] 让 Claude 更新 frontmatter（`update_frontmatter`），验证字段设置和删除
- [ ] 尝试创建已存在的笔记路径，应返回错误
- [ ] 尝试删除不存在的笔记，应返回错误

### 知识图谱感知
- [ ] 让 Claude 查询某笔记的双向链接（`get_links`），验证 outlinks 和 backlinks 正确
- [ ] 查询不存在的笔记路径，应返回错误
- [ ] 查询没有链接的笔记，应返回空列表提示

### 本地图片识别
- [ ] 笔记中引用 `![[photo.png]]` 后发送消息，Notice 显示"已附带 1 张图片"
- [ ] 引用多张图片（超过上限），Notice 提示跳过原因
- [ ] 引用不存在的图片文件，Notice 提示"文件未找到"
- [ ] 引用不支持的格式（如 .pdf），不被提取
- [ ] 关闭"本地图片识别"设置后，图片不被发送
- [ ] 不含图片引用的消息行为不变

### 自动标注
- [ ] 在设置中开启"自动标注"，在 Raw/ 文件夹创建新笔记，等待 5 秒后检查 frontmatter 是否生成 tags 和 summary
- [ ] 已标注的笔记（frontmatter 含 `auto-tagged: true`）不会被重复标注
- [ ] 修改已标注笔记不会触发重复标注
- [ ] 监控文件夹设置为 `Raw`，在 Wiki/ 创建笔记不会触发标注
- [ ] 关闭"自动标注"开关后，新建笔记不会触发标注
- [ ] 内容过短（< 50 字符正文）的笔记不会触发标注
- [ ] 标签优先复用 vault 中已有的标签体系

### 主题兼容
- [ ] 切换不同主题（Minimal/Things/Blue Topaz），UI 颜色正常
- [ ] Feed badge 颜色使用 CSS 变量而非硬编码

## 测试配置

- 框架: vitest
- obsidian 模块通过 `src/__mocks__/obsidian.ts` mock
- 配置文件: `vitest.config.ts`（设置 obsidian alias）
