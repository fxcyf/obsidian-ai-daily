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

### 主题兼容
- [ ] 切换不同主题（Minimal/Things/Blue Topaz），UI 颜色正常
- [ ] Feed badge 颜色使用 CSS 变量而非硬编码

## 测试配置

- 框架: vitest
- obsidian 模块通过 `src/__mocks__/obsidian.ts` mock
- 配置文件: `vitest.config.ts`（设置 obsidian alias）
