# Feature: 本地文件处理（先支持图片）

**状态**: ⬜ 待开始
**优先级**: P1
**难度**: 中

## 概述

当前对话链路是纯文本，`Raw/` 笔记中的本地图片不会进入模型输入。  
本功能先补齐“本地图片可读可问”能力：当用户在笔记中引用本地图片时，插件可将图片与文本一起发送给 Claude（多模态）。

---

## 目标与边界

### 本期目标
- 支持解析并处理笔记内本地图片引用（wiki-link 与 Markdown 图片语法）
- 支持将图片作为多模态输入发送给 Claude
- 失败时优雅降级，不阻塞原有文本对话流程

### 非目标（本期不做）
- 不做 OCR 结构化提取
- 不做 PDF / 音频 / 视频附件理解
- 不做自动抓取外链图片到本地

---

## 用户场景

1. 用户在 `Raw/xxx.md` 中插入本地截图，提问“这张图里的架构有什么问题？”
2. 用户在当前打开笔记中混合文本与图片，提问“结合这段文字和图，帮我总结关键点”
3. 图片过大或格式不支持时，系统提示原因并继续文本回答

---

## 实现分期

### Phase 1：图片引用解析与文件收集

### 方案
- 从用户输入文本与当前笔记内容中抽取图片引用
- 统一解析以下格式：
  - `![[image.png]]`
  - `![[subdir/image.jpg|300]]`
  - `![alt](./assets/a.webp)`
  - `![alt](assets/a.png)`
- 解析为 vault 中真实路径，并过滤非本地 URL（`http://`、`https://`）

### 输出
- `ImageRef` 列表（去重后）

### 接口草案

```ts
export interface ImageRef {
  originalRef: string;      // 原始引用片段
  vaultPath: string;        // 解析后的 vault 路径
  ext: string;              // png/jpg/webp/gif
}

export function extractLocalImageRefs(
  messageText: string,
  currentNoteContent?: string
): ImageRef[];
```

---

### Phase 2：二进制读取与校验

### 方案
- 使用 Obsidian `vault.adapter.readBinary` 读取本地文件
- 白名单 MIME：`image/png`、`image/jpeg`、`image/webp`、`image/gif`
- 限制：
  - 单图最大大小（如 3MB，可配置）
  - 单次最多图片数（如 3 张，可配置）
- 转换为 base64 数据结构供请求体组装

### 输出
- `PreparedImage[]`
- 同时返回 `skipped[]` 用于 UI 提示（超限、缺失、格式不支持）

### 接口草案

```ts
export interface PreparedImage {
  vaultPath: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  dataBase64: string;
  sizeBytes: number;
}

export interface SkippedImage {
  vaultPath: string;
  reason: "not_found" | "unsupported_type" | "too_large" | "read_failed";
}

export async function prepareLocalImages(
  refs: ImageRef[],
  opts: {
    maxImages: number;
    maxBytesPerImage: number;
  }
): Promise<{ images: PreparedImage[]; skipped: SkippedImage[] }>;
```

---

### Phase 3：Claude 请求体组装（文本 + 图片）

### 方案
- 扩展 `src/claude.ts` 中 message content 类型，支持 image block
- 将用户消息由纯字符串改为结构化 content：
  - `[{type:"text", text:"..."}, {type:"image", source:{...}}]`
- 仅对用户消息注入图片，assistant/tool_result 保持现状

### 接口草案

```ts
interface ImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    data: string;
  };
}

type UserContentBlock = { type: "text"; text: string } | ImageBlock;
```

---

### Phase 4：降级、提示与设置

### 方案
- 任一图片失败不影响整轮对话
- 在 UI 通过 Notice 提示：
  - 使用了几张图片
  - 跳过了哪些图片及原因
- 设置项：
  - `enableLocalImageInput`（默认开）
  - `maxImagesPerMessage`（默认 3）
  - `maxImageBytes`（默认 3MB）

### 配置草案

```ts
enableLocalImageInput: boolean;
maxImagesPerMessage: number;
maxImageBytes: number;
```

---

## 测试计划（Checklist）

### 单元测试
- [ ] `extractLocalImageRefs()` 可识别 wiki-link 与 Markdown 图片语法
- [ ] 路径去重与相对路径解析正确
- [ ] URL 图片被忽略
- [ ] 不支持后缀被过滤

### 集成测试
- [ ] 单张本地图片 + 提问，可正常返回
- [ ] 多张图片超过上限时，仅前 N 张进入请求
- [ ] 文件不存在时显示跳过提示，且文本对话正常
- [ ] 关闭 `enableLocalImageInput` 后退化为纯文本路径

### 回归测试
- [ ] 不含图片的普通对话行为不变
- [ ] 现有 tool_use（read/search/append/list）行为不受影响
- [ ] Feed 生成流程不受影响

---

## 风险与缓解

- **请求体过大**：严格限制图片数和大小，必要时优先保留用户明确提到的图片
- **移动端性能波动**：延迟读取 + 分步提示，避免主线程长时间阻塞
- **路径解析复杂**：先覆盖主流语法，异常路径直接降级并提示

---

## 验收标准（DoD）

- 用户在 `Raw/` 笔记中引用本地图片后，可在对话中对图片提问
- 图片处理失败不会中断文本流程
- 设置可控（开关、数量、大小）且默认值合理
- 文档同步更新：`README.md`、`TEST.md`（若行为变化）
