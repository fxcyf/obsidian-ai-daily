# Feature: 对话体验增强

**状态**: ✅ 已完成（`fc03352`）

## 概述

提升聊天核心体验，让对话更流畅、更有记忆、更可控。

---

## 1. 流式输出（Streaming）

**优先级**: P0（体验基础）
**难度**: 中

### 现状

当前等待 Claude 完整响应后一次性渲染，长回复时用户等待体验差。

### 方案

- 使用 Claude API 的 SSE streaming（`stream: true`）
- 通过 Obsidian `requestUrl` 不支持 streaming，需改用 `request`（Node 端）或 `fetch`（桌面端）
- 移动端兼容性需验证，可能需要 fallback 到非流式

### 实现要点

- 修改 `src/claude.ts` 的 `callClaude` 方法，新增 streaming 模式
- `chat-view.ts` 中逐步渲染 token，实时更新 Markdown
- Tool use 场景下的流式处理（`content_block_delta` 事件）
- 错误处理：流中断时的 graceful recovery

### 风险

- `requestUrl` 不支持 SSE，需要探索替代方案
- 移动端 fetch API 在 Obsidian 中的可用性待验证

---

## 2. 对话历史持久化

**优先级**: P0（体验基础）
**难度**: 中

### 现状

关闭聊天面板后对话全部丢失，无法回顾或续接。

### 方案

- 对话保存为 JSON 文件，存入 Vault 的隐藏文件夹（如 `.ai-chat/`）
- 每次新对话创建一个文件：`.ai-chat/2026-04-12_143022.json`
- 侧边栏增加"历史对话"入口，可浏览和恢复

### 数据结构

```json
{
  "id": "2026-04-12_143022",
  "title": "关于 RAG 架构的讨论",
  "model": "claude-haiku-4-5",
  "created": "2026-04-12T14:30:22",
  "updated": "2026-04-12T15:10:05",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

### 实现要点

- 自动保存：每轮对话结束后自动写入文件
- 对话标题：取第一条用户消息的前 30 字，或让 Claude 生成标题
- 历史列表 UI：显示标题 + 时间，支持搜索
- 恢复对话：加载历史消息到 chat view，继续对话
- 清理机制：可配置保留天数，自动清理旧对话

---

## 3. 上下文管理与 Token 感知

**优先级**: P1
**难度**: 中

### 现状

多轮对话可能超出 token 限制，用户无感知。

### 方案

- 估算当前对话 token 数（简易字符计数 / tiktoken-lite）
- 在 UI 上显示 token 用量指示条
- 接近限制时自动摘要早期对话轮次，压缩上下文
- 让用户可以手动"折叠"某些轮次

### 实现要点

- `claude.ts` 中增加 token 估算逻辑
- Chat UI 底部显示用量条（如：`2.1k / 200k tokens`）
- 超过阈值时触发自动摘要（用一次 Claude 调用压缩历史）

