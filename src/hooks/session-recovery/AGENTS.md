# src/hooks/session-recovery/ — 自动会话错误恢复

**生成时间:** 2026-05-15

## 概述

16 个文件 + storage/ 子目录。会话层钩子，处理 `session.error` 事件。检测可恢复的错误类型，应用针对性的恢复策略，并透明地恢复会话。

## 恢复策略

| 错误类型 | 文件 | 恢复操作 |
|------------|------|-----------------|
| `tool_result_missing` | `recover-tool-result-missing.ts` | 从存储中重建缺失的工具结果 |
| `thinking_block_order` | `recover-thinking-block-order.ts` | 重新排序格式错误的思考块 |
| `thinking_disabled_violation` | `recover-thinking-disabled-violation.ts` | 在禁用时剥离思考块 |
| `empty_content_message` | `recover-empty-content-message*.ts` | 处理空/空内容块 |

## 关键文件

| 文件 | 用途 |
|------|---------|
| `hook.ts` | `createSessionRecoveryHook()` — 错误检测、策略分派、恢复 |
| `detect-error-type.ts` | `detectErrorType(error)` → `RecoveryErrorType \| null` |
| `resume.ts` | `resumeSession()` — 重建会话上下文，触发重试 |
| `storage.ts` | 用于恢复重建的每会话消息存储 |
| `recover-tool-result-missing.ts` | 从存储的元数据重建工具结果 |
| `recover-thinking-block-order.ts` | 修复格式错误的思考块序列 |
| `recover-thinking-disabled-violation.ts` | 从模型上下文中移除思考块 |
| `recover-empty-content-message.ts` | 处理空助手消息 |
| `recover-empty-content-message-sdk.ts` | 空内容恢复的 SDK 变体 |
| `types.ts` | `StoredMessageMeta`、`StoredPart`、`ResumeConfig`、`MessageData` |

## 存储子目录

```
storage/
  ├── message-store.ts    # 内存 + 文件消息缓存
  ├── part-store.ts       # 单个消息部分存储
  └── index.ts            # 桶导出
```

存储每会话的消息元数据和部分，用于恢复重建。

## 钩子接口

```typescript
interface SessionRecoveryHook {
  handleSessionRecovery: (info: MessageInfo) => Promise<boolean>
  isRecoverableError: (error: unknown) => boolean
  setOnAbortCallback: (cb: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (cb: (sessionID: string) => void) => void
}
```

## 注意

- 使用 `processingErrors` 集合进行防护，防止对同一错误重复恢复尝试
- 支持 `experimental` 配置以控制行为标志
- 与 `anthropic-context-window-limit-recovery` 不同（后者处理令牌限制；此处处理结构性错误）
