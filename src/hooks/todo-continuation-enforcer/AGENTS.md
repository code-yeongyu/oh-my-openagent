# src/hooks/todo-continuation-enforcer/ — Boulder 延续机制

**生成时间:** 2026-05-15

## 概述

14 个文件（约 2061 行）。"巨石" — 延续层钩子，在有待办未完成时强制 Sisyphus 持续滚动。在 `session.idle` 时触发，在 2 秒倒计时提示后注入延续提示。

## 工作原理

```
session.idle
  → 是主会话（不是 prometheus/compaction）?（DEFAULT_SKIP_AGENTS）
  → 近期未检测到中止?（ABORT_WINDOW_MS = 3s）
  → 待办仍不完整?（todo.ts）
  → 没有后台任务在运行?
  → 冷却已过?（CONTINUATION_COOLDOWN_MS = 30s）
  → 失败次数 < 最大值?（MAX_CONSECUTIVE_FAILURES = 5）
  → 开始 2 秒倒计时提示 → 注入 CONTINUATION_PROMPT
```

## 关键文件

| 文件 | 用途 |
|------|---------|
| `handler.ts` | `createTodoContinuationHandler()` — 事件路由器，委派给空闲/非空闲处理器 |
| `idle-event.ts` | `handleSessionIdle()` — session.idle 的主决策门 |
| `non-idle-events.ts` | `handleNonIdleEvent()` — 处理 session.error（中止检测）|
| `session-state.ts` | `SessionStateStore` — 每会话的失败/中止/冷却状态 |
| `todo.ts` | 通过会话存储检查待办完成状态 |
| `countdown.ts` | 注入前的 2 秒倒计时提示 |
| `abort-detection.ts` | 检测 MessageAbortedError / AbortError |
| `continuation-injection.ts` | 构建 + 将 CONTINUATION_PROMPT 注入会话 |
| `message-directory.ts` | 消息注入交换的临时目录 |
| `constants.ts` | 计时常量、CONTINUATION_PROMPT、跳过的 Agent |
| `types.ts` | `SessionState`、处理器参数类型 |

## 常量

```typescript
DEFAULT_SKIP_AGENTS = ["prometheus", "compaction", "plan"]
CONTINUATION_COOLDOWN_MS = 30_000     // 注入间隔 30 秒
MAX_CONSECUTIVE_FAILURES = 5          // 然后暂停 5 分钟（指数退避）
FAILURE_RESET_WINDOW_MS = 5 * 60_000  // 失败重置的时间窗口 5 分钟
COUNTDOWN_SECONDS = 2
ABORT_WINDOW_MS = 3000                // 中止信号后的宽限期
```

## 每会话状态

```typescript
interface SessionState {
  failureCount: number       // 连续失败次数
  lastFailureAt?: number     // 时间戳
  abortDetectedAt?: number   // 在 ABORT_WINDOW_MS 后重置
  cooldownUntil?: number     // 在此之后才允许下次注入
  countdownTimer?: Timer     // 活跃倒计时引用
}
```

## 与 ATLAS 的关系

`todoContinuationEnforcer` 仅处理**主 Sisyphus 会话**。
`atlasHook` 使用不同的决策门处理 **boulder/ralph/子 Agent 会话**。
两者都在 `session.idle` 时触发，但先检查会话类型。
