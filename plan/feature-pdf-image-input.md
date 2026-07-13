# PDF/图片输入支持计划

> 在聊天输入框支持粘贴/拖拽图片和 PDF 文件，直接发送给 Claude 分析。

## 背景

当前聊天只支持文本输入。用户希望能直接粘贴截图、拖拽 PDF 到输入框，让 Claude 分析内容。这与现有的 `read_image` 工具（读取 vault 内已有图片）互补——本功能处理的是用户临时提供的外部文件。

## 架构设计

### 数据流

```
用户粘贴/拖拽文件
  → chat-view.ts 捕获事件
  → 读取文件为 ArrayBuffer
  → 转换为 base64
  → 构建 Anthropic content block
  → 发送到 Claude API
```

### 新增类型

```typescript
interface PreparedDocument {
  type: "image" | "pdf";
  name: string;
  mediaType: string;        // image/png, image/jpeg, application/pdf
  base64Data: string;
  sizeBytes: number;
  estimatedTokens: number;  // 粗略估算，用于 warning
}
```

### Anthropic API 格式

图片：
```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "<base64>"
  }
}
```

PDF（document type）：
```json
{
  "type": "document",
  "source": {
    "type": "base64",
    "media_type": "application/pdf",
    "data": "<base64>"
  }
}
```

## 实现细节

### 1. 输入捕获（chat-view.ts）

事件监听：
- `paste` 事件：检查 `clipboardData.files` 和 `clipboardData.items`
- `drop` 事件：检查 `dataTransfer.files`
- 支持格式：`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`

UI 反馈：
- 拖拽时输入框显示虚线边框 + "松开以添加附件" 提示
- 添加后在输入框上方显示缩略图/文件名标签，带 × 删除按钮
- 多个附件横向排列

### 2. 文件处理（pdf-tools.ts — 新文件）

```typescript
export async function prepareDocument(file: File): Promise<PreparedDocument>
export function estimateTokens(doc: PreparedDocument): number
export function validateFile(file: File): { valid: boolean; error?: string }
```

验证规则：
- 图片最大 20MB（Anthropic 限制）
- PDF 最大可配置（默认 32MB）
- PDF 页数无硬限制，但超过 100 页时警告

Token 估算：
- 图片：基于分辨率（width × height / 750 ≈ tokens）
- PDF：约 1,500 tokens/页（粗略估算）

### 3. API 集成（claude.ts）

修改 `sendMessage` 方法：
- 接受可选的 `attachments: PreparedDocument[]` 参数
- 构建 `content` 数组时，将附件转为对应的 content block
- 附件放在用户文本消息之前

### 4. Proxy 模式支持

proxy-server 需要透传 base64 数据：
- 请求体增大，可能需要调整 body size limit
- SSE 响应不受影响（只有请求变大）

### 5. 设置项（settings.ts）

| 设置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableFileInput` | boolean | true | 启用文件输入 |
| `maxPdfSizeMB` | number | 32 | PDF 最大文件大小 |
| `attachTokenWarningThreshold` | number | 50000 | 附件估算 token 超过此值时警告 |

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/chat-view.ts` | paste/drop 事件、附件预览 UI、发送时附加 content blocks |
| `src/pdf-tools.ts` | **新增** — 文件验证、base64 转换、token 估算 |
| `src/claude.ts` | sendMessage 接受 attachments，构建多模态 content |
| `src/settings.ts` | 新增 3 个设置项 |
| `styles.css` | 附件预览、拖拽提示样式 |
| `proxy-server/` | 调整 body size limit |

## 限制与注意事项

- Claude Code 模式（MCP）不支持多模态输入，此功能仅限 API 和 Proxy 模式
- base64 编码会使数据体积增大约 33%，大文件注意内存占用
- 移动端 Obsidian 的 paste/drop 行为可能与桌面端不同，需单独测试
