# 桌面代理模式（Proxy Mode）

> 移动端通过桌面端 proxy-server 使用 Claude Code 订阅额度，无需直接调用 API。

## 架构

```
移动端 Obsidian → (HTTPS) → proxy-server → Claude Code CLI → MCP Server → HTTP → 插件 API Server → Obsidian API
                                                                          ↘ (fallback) → filesystem
```

## 模块

### Module 1: Plugin HTTP API ✅
- `src/plugin-api-server.ts` — 桌面端 localhost HTTP server (127.0.0.1:27080)
- 暴露所有 vault/image/podcast 工具，通过 Obsidian API 执行
- 仅桌面端启动

### Module 2: MCP Server 重构 ✅
- `mcp-server/src/vault-ops-api.ts` — HTTP 客户端调用插件 API
- `mcp-server/src/index.ts` — 优先 API 后端，回退 filesystem
- 新增 read_image、podcast_* 工具（仅 API 模式）

### Module 3: Proxy Server ✅
- `proxy-server/src/server.ts` — 独立 HTTP server
- POST /chat: 接收消息 → 生成 `claude -p` / `claude -r <sid> -p` → SSE 流式返回
- GET /health: 健康检查
- Bearer token 认证
- Session ID 管理（首次创建，后续 `--resume`）
- 部署：systemd + nginx 反向代理 + HTTPS

### Module 4: 插件代理模式 ✅
- 设置：proxyEnabled / proxyUrl / proxyToken / proxyFallbackToApi
- `ClaudeClient.proxyChat()`: SSE 流式接收代理响应
- 代理不可用时自动回退本地 API
- 设置界面代理配置区

## 部署步骤

1. 桌面端安装 Claude Code CLI（`npm i -g @anthropic-ai/claude-code`）
2. 编译 proxy-server: `cd proxy-server && npm install && npm run build`
3. 复制 `mcp-config.example.json` → `mcp-config.json`，填入 vault 路径
4. 设置环境变量：`AUTH_TOKEN=<your-token> PORT=27090`
5. 启动：`node dist/server.js` 或使用 systemd service
6. Nginx 反向代理 + HTTPS 证书
7. 移动端设置：启用代理模式，填入 URL 和 Token
