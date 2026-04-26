# Feature: 真流式输出（Real Streaming Revival）

**状态**: ⬜ 待开始
**优先级**: P1
**难度**: 中
**前置背景**: 本仓库已在 `fc03352` 尝试过真流式，于 `ce3e360` 因 CORS 全量回滚到"伪流式 / 打字机"方案。本计划是该方案的二次尝试，必须显式吸取上次的教训。

---

## 概述

当前对话链路下，`src/claude.ts` 用 Obsidian 的 `requestUrl` 拿到完整响应后，再用 `setTimeout` 每 22ms 切片回放 6 个字符制造"流式动画"。这是**纯视觉假流**，首字节延迟 = 完整生成耗时，长回复体验依然差。

本期目标：在**桌面端**接通真正的 SSE 流式（首字节通常 < 1s），同时保留"伪流"作为兜底。**移动端可按"能跑则跑、跑不通就退化为伪流"接受体验打折**，但绝不允许直接报错挂掉。

---

## 上次失败的根因复盘

### 现象（`ce3e360` 回滚 commit）

> "Native fetch is blocked by CORS from `app://obsidian.md`. Text deltas are replayed with short delays so the UI still feels streamed."

### 实际根因（本次调研结论）

阅读 `fc03352` 时期的 `callApiStreaming` 实现，请求头如下：

```
Content-Type: application/json
x-api-key: <key>
anthropic-version: 2023-06-01
```

**缺失了 Anthropic 浏览器直连必需的头：`anthropic-dangerous-direct-browser-access: true`**。
没有这个头时，Anthropic 不会返回浏览器友好的 CORS 响应头（`Access-Control-Allow-Origin`），Chromium 渲染进程的 fetch 当然会被预检拦截。

### 教训

- 上次的 fallback 链是 `fetch 失败 → requestUrl 拉完整 SSE → 解析回放`，看似稳健但路径过多、调试成本高，最后干脆放弃流式。
- **本次必须先用一个最小验证脚本确认带正确头的 `fetch` 能在桌面端真流，再动业务代码**，而不是边写边猜。

---

## 目标与边界

### 本期目标

- 桌面端使用浏览器原生 `fetch` + `ReadableStream` 接通 Anthropic SSE，首字节延迟 < 2s。
- 文本增量（`text_delta`）实时透传到 chat-view，无需等整段。
- `tool_use` 在流式下仍能正确组装（`input_json_delta` 拼接 + `content_block_stop` 后再 `JSON.parse`），保证 agentic loop 行为不变。
- 失败时自动退化为现有的 `requestUrl` + 打字机回放路径，**用户无感**。
- 设置项 `chatStreaming` 语义升级为三态：`auto / real / typewriter`。

### 非目标（本期不做）

- 不引入 Node `https` / Electron `net` 路线（会让移动端直接挂，不符合"打折"而非"放弃"的要求）。
- 不实现"停止生成"按钮（虽然真流后天然可做，但放下一期）。
- 不引入 `langchain` / `@anthropic-ai/sdk` 等重依赖。
- 不重写 `src/claude.ts` 的 `chat()` 主循环（仅在 `callApi` 层做替换）。

---

## 用户场景

1. 桌面端：用户提问长问题，**1 秒内开始看到回答打字**，长回复总等待时间相对不变但体感大幅改善。
2. 移动端（CORS 通过）：同上，体验和桌面一致。
3. 移动端（CORS 不通过）：自动 fallback 到伪流，行为与现状完全相同，无错误提示。
4. 用户主动关闭流式：保留之前的"一次性整段返回"路径供调试。

---

## 实现分期

### Phase 0：可行性验证（必做，先于动业务代码）

**目的**：在 sandbox 里独立验证"带 dangerous header 的 fetch 能在 Obsidian 桌面端真流"，避免重蹈 `fc03352` 覆辙。

#### 步骤

- 在 `scripts/verify-streaming.ts`（或临时插件命令）实现一段最小代码：

```ts
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  },
  body: JSON.stringify({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    stream: true,
    messages: [{ role: "user", content: "数到 20，每个数字独占一行" }],
  }),
});
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let firstByteAt = 0;
const start = Date.now();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  if (!firstByteAt) firstByteAt = Date.now() - start;
  console.log(`+${Date.now() - start}ms`, decoder.decode(value));
}
console.log("first byte latency:", firstByteAt, "ms");
```

#### 验收

- [ ] 桌面端 DevTools 中能看到多次 reader.read() 输出，时间戳间隔 ms 级（而不是一次性返回）。
- [ ] 第一字节延迟 < 2000ms。
- [ ] 移动端（iOS Obsidian / Android Obsidian）至少跑通一次，记录是否 CORS 通过。
- [ ] 若移动端不通，记录具体错误信息并写入 PROGRESS.md。

> **如果 Phase 0 验证不通过，本计划立即中止**，回归现状的伪流方案。不允许带着不确定性进入 Phase 1。

---

### Phase 1：抽离 SSE 解析模块（独立可测）

**目的**：把"字节流 → Anthropic 事件"的解析逻辑独立成纯函数模块，与网络层解耦，便于单测。

#### 方案

- 新增 `src/anthropic-sse.ts`，提供：
  - `parseSseEvents(text: string): SseEvent[]` — 同时识别 `\n\n` 与 `\r\n\r\n` 分隔（吸取 `2eb571c` 教训，CRLF 是真实存在的坑）。
  - `AnthropicStreamAssembler` 类，逐事件喂入，输出最终的 `ApiResponse`（与现有非流式响应同构）+ 增量回调。

#### 接口草案

```ts
export interface SseEvent {
  event?: string;
  data: string;
}

export interface StreamCallbacks {
  /** Each text_delta from Claude. */
  onTextDelta?: (delta: string) => void;
  /** Optional: tool_use input_json_delta (rarely needed by UI). */
  onToolInputDelta?: (toolUseId: string, jsonChunk: string) => void;
}

export class AnthropicStreamAssembler {
  constructor(callbacks: StreamCallbacks);
  /** Feed raw SSE text fragments. Tolerant to partial events across calls. */
  push(chunk: string): void;
  /** Mark stream end; throws if assembled state is inconsistent. */
  finalize(): ApiResponse; // { content: ContentBlock[], stop_reason, usage }
}
```

#### Anthropic 事件类型清单（必须正确处理）

| 事件 | 处理 |
|---|---|
| `message_start` | 初始化 message 元信息（usage 占位） |
| `content_block_start` | 在 blocks 数组中开新 block（`text` 或 `tool_use`） |
| `content_block_delta`（`text_delta`） | 追加到 block.text + 触发 `onTextDelta` |
| `content_block_delta`（`input_json_delta`） | 追加到该 tool_use 的 partial JSON 缓冲 |
| `content_block_stop` | 关闭 block；若是 tool_use 则 `JSON.parse(buffer)` 写入 `input` |
| `message_delta` | 更新 `stop_reason`、累计 usage |
| `message_stop` | 标记结束 |
| `ping` / `error` | `ping` 忽略；`error` 抛异常以触发 fallback |

#### 验收

- [ ] 单测覆盖：完整对话事件流、tool_use 事件流、CRLF/LF 混合、跨 chunk 切分（如把一个 event 切成 3 段 push）。
- [ ] 流末尾未收到 `message_stop` 时 `finalize()` 抛错。
- [ ] tool_use 的 `input` 解析失败时 `finalize()` 抛错并附 partial JSON 用于排查。

---

### Phase 2：接入 ClaudeClient（带 fallback 链）

**目的**：在 `callApi` 内按"真流 → 伪流 → 整段非流"三级降级，业务层无感。

#### 方案

- `src/claude.ts` 新增 `private async callApiRealStream(onTextDelta)`：
  - 用 Phase 0 验证过的 fetch + headers 发起请求。
  - 用 Phase 1 的 `AnthropicStreamAssembler` 装配。
  - 任意异常向上抛，由 `callApi` 决定降级。
- 改写 `callApi` 调度：

```ts
private async callApi(onTextDelta?): Promise<ApiResponse> {
  if (this.streamMode === "off") return this.callApiNonStreaming();

  if (this.streamMode === "real" || this.streamMode === "auto") {
    try {
      return await this.callApiRealStream(onTextDelta);
    } catch (e) {
      console.warn("[ai-daily] real stream failed, fallback", e);
      if (this.streamMode === "real") throw e; // 用户强制 real 时不掩盖错误
    }
  }
  // typewriter / auto 兜底
  return this.callApiTypewriter(onTextDelta);
}
```

- 现有 typewriter 路径保留，重命名为 `callApiTypewriter`。

#### 与现有 tool_use 循环的契合点

- 真流式分支返回的 `ApiResponse` 形态必须和 `callApiNonStreaming` **完全一致**（同样的 `content: ContentBlock[]`、`stop_reason`、`usage`），这样 `chat()` 主循环零修改。
- `onTextDelta` 在多轮 tool 调用中沿用现有的 `priorAssistantText + roundStream` 累加策略（见 `claude.ts:246-251`），不动这部分。

#### 验收

- [ ] 桌面端开启流式后，`onTextDelta` 在响应到达 Claude 第一个 token 的瞬间就被触发（不是等 1s 后批量触发）。
- [ ] tool_use 场景下，工具调用的 `input` 与现有非流式版本逐字段相等（写一个 echo tool 做对照测试）。
- [ ] 故意用错误 API key 时，错误信息能正确冒泡到 UI（不是被 fallback 默默吞掉）。

---

### Phase 3：设置项与文档

#### 方案

- `src/settings.ts` 把 `chatStreaming: boolean` 升级为：

```ts
/** 'auto' = real with typewriter fallback; 'real' = strict real, error out on failure; 'typewriter' = current behavior; 'off' = single-shot */
chatStreamMode: "auto" | "real" | "typewriter" | "off";
```

- 兼容老配置：迁移逻辑 `if (chatStreaming === false) → "off"`，否则 → `"auto"`。
- 设置 UI 改为下拉框，每个选项给一行说明。
- `README.md` 增加一段"流式输出"说明，明确桌面/移动行为差异。
- `TEST.md` 增加流式相关的手测清单。
- `CLAUDE.md` 在"架构概览"补一行 `src/anthropic-sse.ts` 职责。

#### 验收

- [ ] 老用户升级后无配置丢失（`chatStreaming: true → "auto"`）。
- [ ] 三个文档同步更新。

---

## 测试计划（Checklist）

### 单元测试（`src/anthropic-sse.test.ts`）

- [ ] 完整事件序列正确组装为 `ApiResponse`
- [ ] CRLF 与 LF 混合分隔均能识别
- [ ] 单个 SSE event 跨 chunk 边界切分仍能正确解析
- [ ] tool_use 的 `input_json_delta` 拼接 + `JSON.parse` 正确
- [ ] 缺失 `message_stop` 时 `finalize()` 抛错
- [ ] tool_use partial JSON 解析失败时抛错并保留原文用于排查

### 集成测试（手测，记入 TEST.md）

- [ ] 桌面端开启 `auto` 模式，长回复（要求模型数到 100）能看到逐字显示
- [ ] 桌面端首字节延迟肉眼 < 2s
- [ ] tool_use 链路（"列出我所有 Wiki 笔记"）完整工作，与原非流式输出一致
- [ ] 移动端 iOS Obsidian：要么真流，要么自动退化成伪流，**不能报错**
- [ ] 移动端 Android Obsidian：同上
- [ ] 故意填错 API key：`auto` 模式应优雅 fallback 后再报错；`real` 模式立刻报错

### 回归测试

- [ ] 历史会话保存/恢复行为不变
- [ ] Token 估算与压缩摘要行为不变
- [ ] Feed 生成流程（仍走 `requestUrl`）不受影响

---

## 风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| Anthropic 改动 `dangerous-direct-browser-access` 策略 | 低 | Phase 0 验证 + 持续在 fallback 链中保留伪流 |
| 移动端 WebView 对长 SSE 连接不稳定（断流） | 中 | 真流失败时立刻 fallback，不重试，避免双倍延迟 |
| tool_use partial JSON 在边界条件下解析失败 | 中 | 单测覆盖跨 chunk 切分；解析失败时整轮 fallback 到 `requestUrl` 重发同一请求（无 `stream:true`） |
| 用户开启 `real` 模式后频繁报错 | 低 | UI 设置项里明确写"调试用，仅桌面"，默认仍是 `auto` |
| 重复 `fc03352` 的覆辙 | — | **Phase 0 必须先单独验证**，不允许一次性写完全套再调试 |

---

## 验收标准（DoD）

- 桌面端默认行为变为真流式，首字节延迟肉眼可感地缩短
- 移动端在 CORS 通过时享受真流，否则自动退化为伪流，**绝不报错**
- `tool_use` agentic loop 行为与改造前 100% 一致
- 单元测试覆盖 SSE 解析的关键边界情况，CI 全绿
- `README.md` / `TEST.md` / `CLAUDE.md` 同步更新
- `PROGRESS.md` 记录本次实施经验，特别是 Phase 0 验证结论
