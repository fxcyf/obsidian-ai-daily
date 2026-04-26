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

## 测试配置

- 框架: vitest
- obsidian 模块通过 `src/__mocks__/obsidian.ts` mock
- 配置文件: `vitest.config.ts`（设置 obsidian alias）
