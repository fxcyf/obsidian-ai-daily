# PROGRESS — 经验教训与项目进展

## 2026-04-03 — 初始化插件 (`3422d58`)

- 搭建 Obsidian 插件基础结构：esbuild 构建、manifest.json、main.ts 入口
- 实现侧边栏聊天 UI、Claude API 客户端（tool_use）、Vault 工具套件
- **经验**: 初始架构选择直接调用 HTTP API 而非 SDK，减少依赖，便于 Obsidian 移动端兼容

## 2026-04-04 — CORS 修复与部署流程 (`13fb044`, `ef96c3d`, `7aab4fe`)

- **问题**: 原生 `fetch` 在 Obsidian 桌面端/iOS 均遇到 CORS 限制，无法调用 Claude API
- **解决**: 改用 Obsidian 内置 `requestUrl` 绕过 CORS（commit `13fb044`）
- **教训**: Obsidian 插件中所有外部 HTTP 请求都应使用 `requestUrl`，不要用原生 fetch
- 新增 GitHub Actions self-hosted runner 自动部署工作流（`ef96c3d`）
- 在欢迎标题添加版本号用于部署验证（`7aab4fe`）

## 2026-04-07 — 知识库转型 (`eccb68d`)

- 从"AI 日记助手"转型为"AI 知识库对话"
- 新增 Raw/Wiki 文件夹支持，自动加载知识库文件作为上下文
- **经验**: 上下文窗口管理很重要，需要控制加载的文件数量避免超出 token 限制

## 待解决

- [ ] 测试覆盖：目前无任何测试文件
- [ ] 版本号统一：manifest.json (0.2.0) 与 package.json (0.1.0) 不一致
