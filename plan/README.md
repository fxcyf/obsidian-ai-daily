# TODO — 功能规划与待办事项

> 状态标记：⬜ 待开始 | 🔧 进行中 | ✅ 已完成

## Bug 修复

- ✅ [新对话按钮重叠](bug-new-chat-button-overlap.md) — 新对话按钮和第一个消息 block 重合（`803942f`）
- ✅ [Enter 键行为](bug-enter-key-behavior.md) — PC 端 Enter 应发送消息，手机端 Enter 应换行（`803942f`）

## 已知问题

- ⬜ 测试覆盖：目前无任何测试文件
- ⬜ 版本号统一：manifest.json (0.2.0) 与 package.json (0.1.0) 不一致

## 功能规划

- ⬜ [个人信息 Feed 流](feature-info-feed.md) — AI 根据关注主题自动搜集信息，构建个人信息流（构思中）
- ⬜ [真流式输出](feature-real-streaming.md) — 桌面端接通 Anthropic SSE 真流式（带 `dangerous-direct-browser-access` 头），移动端按"通则真流、不通则伪流"降级；吸取 `ce3e360` 回滚教训
