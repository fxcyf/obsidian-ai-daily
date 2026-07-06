# Plan: 三模式消息同步机制修复

**Date:** 2026-07-05
**Status:** draft
**Relates to:** src/chat-view.ts, src/claude.ts, src/claude-code.ts, proxy-server/src/server.ts

## Goal

修复三种 AI 调用模式（桌面 Claude Code、Proxy Claude Code、API）之间的消息同步问题。同一个 Obsidian session 可能在生命周期内切换模式（桌面开始 → 出门切手机 Proxy → Proxy 挂了 fallback API → Proxy 恢复），当前每次切换都会导致上下文断裂。

## 三种模式的数据架构

```
┌─────────────────────────────────────────────────────────┐
│  Obsidian 插件 (桌面/移动)                                │
│  this.messages[] ──persist──→ vault JSON                 │
│  sessionId (Obsidian 自己的)                              │
├─────────────────────────────────────────────────────────┤
│  模式 1: 桌面 Claude Code                                │
│  claudeCodeSessionId → 本机 ~/.claude/projects/X.jsonl   │
│  通过 spawnClaudeCode() 直接调用本机 CLI                   │
├─────────────────────────────────────────────────────────┤
│  模式 2: Proxy Claude Code                               │
│  proxySessionId → 远端机器 ~/.claude/projects/X.jsonl     │
│  通过 proxyChat() → SSE → proxy server → Claude Code CLI │
├─────────────────────────────────────────────────────────┤
│  模式 3: API 直连                                        │
│  无外部 session，claude.ts 内部 this.messages 管理上下文    │
│  当 proxy 不可用时 fallback 到此模式                       │
└─────────────────────────────────────────────────────────┘
```

关键问题：**三种模式各自维护独立的 AI 上下文，但共享同一个 Obsidian session 的 `this.messages`**。

### 模式切换场景

| 场景 | 从 | 到 | 发生条件 |
|---|---|---|---|
| 出门 | 桌面 Claude Code | Proxy Claude Code | 移动端打开，桌面 CLI 不可用 |
| Proxy 故障 | Proxy Claude Code | API | `proxyFallbackToApi` 触发 |
| Proxy 恢复 | API | Proxy Claude Code | 下次发消息 proxy 可达 |
| 回家 | Proxy Claude Code | 桌面 Claude Code | 桌面端打开，本机 CLI 可用 |

每次切换时，新模式的 AI 都**不知道**之前模式下发生了什么对话。

## 已知问题

### P1: SSE 断流 → 本地收到截断内容
- **现象**: proxy 端 Claude Code 生成了完整回复（写入 JSONL），但移动端 SSE 连接中断，只收到部分内容
- **后果**: 本地存了截断版，下次 `--resume` 时 Claude Code 加载完整版，AI 和用户看到的"上一条消息"不一致
- **位置**: `claude.ts:560-608` SSE 读取循环，`chat-view.ts:1261` push 到 messages

### P2: Rewind 本地/远端不原子
- **现象**: `rewindLastTurn()` 先同步 pop 本地消息，再 async 调 proxy `/rewind`，失败时 `catch { /* best effort */ }`
- **后果**: 快速连续 rewind 或网络不好时，本地回退了 N 轮，proxy 只回退了 M 轮（M < N）
- **位置**: `chat-view.ts:2342-2402`

### P3: API fallback 消息丢失
- **现象**: proxy 不可用时 fallback 到 API（`chat-view.ts:1243-1246`），这些轮次只存在本地
- **后果**: proxy 恢复后 `--resume` 加载 JSONL，缺失 fallback 期间的对话
- **位置**: `chat-view.ts:1230-1250`

### P4: 上下文补发只在首次连接
- **现象**: 只有第一次 proxy 消息（`!getProxySessionId()`）才打包本地历史（`chat-view.ts:1232-1238`）；桌面 Claude Code 同理（`chat-view.ts:1306-1338`）
- **后果**: 模式切换后如果已有 sessionId，不会补发缺失的消息

### P5: 桌面 → 移动切换上下文断裂
- **现象**: 桌面 Claude Code 产生了 `claudeCodeSessionId`，消息在本机 JSONL。切到移动端后，proxy 是另一台机器（或同一台但不同 session），`proxySessionId` 是新的
- **后果**: 移动端 proxy 的 AI 完全不知道桌面端发生了什么

### P6: 移动 → 桌面切换上下文断裂
- **现象**: 移动端通过 proxy/API 对话了几轮，回到桌面后 `isClaudeCodeAvailable()` 为 true，走 `handleSendViaClaudeCode()`
- **后果**: 如果 `claudeCodeSessionId` 还在，`--resume` 恢复的是桌面离开前的状态，丢失移动端的所有对话

## Context

### 关键函数

| 函数 | 文件 | 作用 |
|---|---|---|
| `handleSendViaClaudeCode()` | chat-view.ts:1302 | 桌面 Claude Code 发送入口 |
| `proxyChat()` | claude.ts:503 | Proxy 模式发送 |
| `doLocalChat()` | chat-view.ts ~1215 | API 模式发送 |
| `rewindLastTurn()` | chat-view.ts:2342 | 本地 + 远端 rewind |
| `persistSession()` | chat-view.ts:1443 | 本地消息存入 vault JSON |
| `loadSession()` | chat-view.ts:2594 | 从 vault JSON 恢复 |
| `handleRewind()` | server.ts:263 | proxy 端截断 JSONL |
| `buildClaudeArgs()` | server.ts:515 | 构建 `--resume` 参数 |
| `recoverProxyTask()` | chat-view.ts:2660 | SSE 断流后恢复 |

### 核心约束

- Claude Code CLI 的 JSONL 是它自己维护的，只能通过 `--resume` 读、直接改文件写
- 桌面 Claude Code JSONL 在本机，proxy Claude Code JSONL 在远端机器
- 移动端随时可能断网/切后台
- proxy server 可能重启（内存 tasks Map 丢失）
- 桌面端和移动端的 vault 通过 Obsidian Sync 同步（vault JSON 最终会同步到两端）

## Approach

### 核心原则

1. **本地 `this.messages` 为 single source of truth** — 唯一贯穿三种模式的连续记录，通过 Obsidian Sync 跨设备
2. **模式切换时废弃旧外部 session，新建 session + 打包完整历史** — 不尝试维护多个 JSONL 的同步
3. **Rewind 按 source 标记分发，废弃的 session 不管**

---

### Step 1: 消息标记来源（source）

在 `this.messages` 的每条消息上添加 `source` 字段：

```ts
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  source?: "claude-code" | "proxy" | "api";
}
```

改动点：
- `handleSendViaClaudeCode()` 中 push 消息时标记 `source: "claude-code"`
- `proxyChat()` 返回后 push 消息时标记 `source: "proxy"`
- `doLocalChat()` 返回后 push 消息时标记 `source: "api"`
- `persistSession()` / `loadSession()` 需要序列化/反序列化 source 字段
- user 消息的 source 跟随当前模式

---

### Step 2: 模式切换检测 + 废弃旧 session

在 `chat-view.ts` 添加 `lastMode: "claude-code" | "proxy" | "api" | null` 字段。

每次发消息时判断当前模式：
- `isClaudeCodeAvailable()` → "claude-code"
- `proxyEnabled && proxyUrl` → "proxy"
- 否则 → "api"
- proxy 失败 fallback → 从 "proxy" 降为 "api"

如果 `currentMode !== lastMode && lastMode !== null`（模式切换发生）：
1. 清空对应旧 session ID：
   - 离开 proxy → `this.client.clearProxySessionId()`（新增方法）
   - 离开 claude-code → `this.claudeCodeSessionId = undefined`
2. 更新 `lastMode = currentMode`
3. Notice 告知用户："已切换到 XXX 模式"

清空后，下次发消息自然走"首次消息"分支（`!claudeCodeSessionId` / `!proxySessionId`），自动打包完整本地历史。**现有的首次消息打包逻辑不需要改**。

---

### Step 3: 修复 SSE 断流（P1）

在 `claude.ts proxyChat()` 中：

1. 添加 `receivedDone` 标志
2. SSE 循环结束后，如果 `!receivedDone && this.proxyTaskId`，调 `/task/{id}` 拿完整结果
3. 用完整结果覆盖 `accumulated`，确保 push 到 `this.messages` 的是完整内容

复用已有的 `recoverProxyTask()` 逻辑（`chat-view.ts:2660`）。

---

### Step 4: 修复 Rewind（P2）

改 `chat-view.ts rewindLastTurn()`，按 source 标记分发：

```
1. 读最后一条 assistant 消息的 source
2. 判断该 source 的外部 session 是否还活跃（即当前 sessionId 是否存在）

3a. source = "proxy" 且 proxySessionId 仍存在（未被废弃）：
    → await fetch /rewind
    → 成功：pop 本地，更新 UI
    → 失败：不 pop，Notice "回退失败，请重试"

3b. source = "claude-code" 且 claudeCodeSessionId 仍存在：
    → await rewindClaudeCodeSession()
    → 成功：pop 本地
    → 失败：不 pop，Notice

3c. source = "api"，或对应的外部 session 已被废弃：
    → 直接 pop 本地（无需调远端）
    → 如果 claude.ts client 存在，同步 pop 其内部 messages
```

关键：废弃的旧 session 不管，因为下次发消息会新建 session + 打包完整历史，旧 JSONL 里多几轮少几轮无所谓。

---

### Step 5: Proxy 端新增 `/session-history` 接口

```
GET /session-history?sessionId=xxx
→ { messages: [{role, content}], turnCount: N }
```

用途：
- SSE 断流恢复的备选：如果 `/task/{id}` 过期（proxy 重启），从 JSONL 拿最后一条 assistant 消息
- 未来调试：可以在 UI 上对比本地和远端的消息记录

---

### Step 6: 模式切换 Notice

模式切换时给用户 Notice：
- "已切换到本地 Claude Code"
- "已切换到代理模式"
- "代理不可用，回退到 API"
- 如果有历史消息需要打包："正在同步对话上下文..."

## Files to change

| File | Change |
|---|---|
| `src/chat-view.ts` | 消息 source 标记；模式切换检测 + context bridge 调用；rewind 改为先远端后本地；模式切换 Notice |
| `src/claude.ts` | `proxyChat()` 断流检测 + task recovery；接受 context bridge 注入 |
| `src/claude-code.ts` | 接受 context bridge 注入到 prompt |
| `proxy-server/src/server.ts` | 新增 `/session-history` 端点 |

## Out of scope

- Claude Code CLI 本身的 JSONL 格式或 `--resume` 行为
- 两台设备同时活跃在同一 session 的冲突（当前假设同一时间只有一个设备活跃）
- 消息加密或端到端同步协议
- vault JSON 的 Obsidian Sync 冲突处理

## Open questions

- [x] vault JSON 是否需要持久化 `source` 和 `lastMode`？→ 是，需要存
- [x] SSE 断流恢复的 `/task/{id}` 调用超时/重试？→ 超时 5s，失败 fallback `/session-history`，再失败用截断内容

## Decision log

| Decision | Rationale | Alternative considered |
|---|---|---|
| 本地 messages 为 source of truth | 唯一贯穿三种模式的连续记录；通过 Obsidian Sync 跨设备 | JSONL 为 truth（有两个独立 JSONL 且 API 模式无 JSONL） |
| 模式切换时废弃旧 session + 新建 | 简单可靠，复用现有首次消息打包逻辑 | 保留旧 session 注入 gap（AI 看到混合上下文会困惑） |
| Rewind 按 source 分发，废弃 session 只 pop 本地 | 废弃的 JSONL 不影响后续（新建 session 会打包完整历史） | 也去清理废弃的 JSONL（额外复杂度，无收益） |
| Rewind 先远端后本地 | 保证一致性，失败可重试不会产生分歧 | 并行操作（无法保证原子性） |
