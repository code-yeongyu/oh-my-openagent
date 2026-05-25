# src/hooks/anthropic-context-window-limit-recovery/ — 多策略上下文恢复

**生成时间:** 2026-05-15

## 概述

31 个文件（约 2232 行）。最复杂的钩子。通过按顺序应用的多种策略从上下文窗口限制错误中恢复。

## 恢复策略（按优先级排序）

| 策略 | 文件 | 机制 |
|----------|------|-----------|
| **空内容恢复** | `empty-content-recovery.ts` | 处理消息中的空/空内容块 |
| **去重** | `deduplication-recovery.ts` | 从上下文中移除重复的工具结果 |
| **目标令牌截断** | `target-token-truncation.ts` | 截断最大的工具输出以适应目标比例 |
| **激进截断** | `aggressive-truncation-strategy.ts` | 最终手段的截断，仅保留最少输出 |
| **摘要重试** | `summarize-retry-strategy.ts` | 压缩 + 摘要后重试 |

## 关键文件

| 文件 | 用途 |
|------|---------|
| `recovery-hook.ts` | 主钩子入口 — `session.error` 处理器，策略编排 |
| `executor.ts` | 按顺序执行恢复策略 |
| `parser.ts` | 解析 Anthropic 令牌限制错误消息 |
| `state.ts` | `AutoCompactState` — 每会话的重试/截断跟踪 |
| `types.ts` | `ParsedTokenLimitError`、`RetryState`、`TruncateState`、配置常量 |
| `storage.ts` | 持久化工具结果以便后续截断 |
| `tool-result-storage.ts` | 存储/检索单个工具调用结果 |
| `message-builder.ts` | 在恢复后构建重试消息 |

## 重试配置

- 最大尝试次数：2
- 初始延迟：2 秒，退避 ×2，最长 30 秒
- 最大截断尝试次数：20
- 目标令牌比例：0.5（截断到限制的 50%）
- 每令牌字符估算：4

## 剪枝系统

`pruning-*.ts` 文件处理智能输出剪枝：
- `pruning-deduplication.ts` — 移除工具结果间的重复内容
- `pruning-tool-output-truncation.ts` — 截断过大的工具输出
- `pruning-types.ts` — 剪枝专用的类型定义

## SDK 变体

`empty-content-recovery-sdk.ts` 和 `tool-result-storage-sdk.ts` 提供基于 SDK 的实现，用于 OpenCode 客户端交互。
