# Bug: Enter 键发送行为不一致

**状态**: ✅ 已完成

## 问题描述

当前 Enter 键行为不符合平台惯例。

## 预期行为

| 平台 | Enter | Cmd/Ctrl+Enter |
|------|-------|----------------|
| PC 端 | 换行 | 发送消息 |
| 手机端 | 换行 | — |

手机端通过点击发送按钮来发送消息。

## 实现思路

- 检测平台类型（`Platform.isMobile`）
- PC 端：监听 keydown，仅 Cmd/Ctrl+Enter 触发发送，Enter 保持换行
- 手机端：Enter 保持默认换行行为，仅按钮触发发送
- 输入框根据 `scrollHeight` 自动增高，常规高度上限为 200px，超过后内部滚动
