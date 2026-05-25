# src/hooks/atlas/ — 主 Boulder 编排器

**生成时间:** 2026-05-15

## 概述

17 个文件（约 1976 行）。`atlasHook` — 延续层钩子，监控 session.idle 事件，当 boulder 会话（ralph-loop、任务孵化的 Agent）有未完成工作时强制延续。同时为子 Agent 会话执行写入/编辑策略。

## ATLAS 的职责

Atlas 是"会话的守护者"——它跟踪每个会话并决定：
1. 此会话是否应该被强制延续？（如果 boulder 会话有待办未完成）
2. 是否应阻止写入/编辑？（针对某些会话类型的策略执行）
3. 是否应注入验证提醒？（工具执行后）

## 决策门（session.idle）

```
session.idle 事件
  → 这是 boulder/ralph/atlas 会话吗？（session-last-agent.ts）
  → 是否有中止信号？（is-abort-error.ts）
  → 失败次数 < 最大值？（state.promptFailureCount）
  → 没有正在运行的后台任务？
  → Agent 符合预期？（recent-model-resolver.ts）
  → 计划完成？（todo status）
  → 冷却时间已过？（注入间隔 5 秒）
  → 注入延续提示（boulder-continuation-injector.ts）
```

## 关键文件

| 文件 | 用途 |
|------|---------|
| `atlas-hook.ts` | `createAtlasHook()` — 组合事件 + 工具处理器，维护会话状态 |
| `event-handler.ts` | `createAtlasEventHandler()` — session.idle 事件的决策门 |
| `boulder-continuation-injector.ts` | 构建 + 将会话延续提示注入 |
| `system-reminder-templates.ts` | 延续提醒消息的模板 |
| `tool-execute-before.ts` | 根据会话策略阻止写入/编辑 |
| `tool-execute-after.ts` | 在工具执行后注入验证提醒 |
| `write-edit-tool-policy.ts` | 策略：哪些会话可以写入/编辑？ |
| `verification-reminders.ts` | 用于验证工作的提醒内容 |
| `session-last-agent.ts` | 确定哪个 Agent 拥有该会话 |
| `recent-model-resolver.ts` | 解析最近消息中使用的模型 |
| `subagent-session-id.ts` | 检测会话是否为子 Agent 会话 |
| `omo-path.ts` | 解析 `.omo/` 目录路径 |
| `is-abort-error.ts` | 检测会话输出中的中止信号 |
| `types.ts` | `SessionState`、`AtlasHookOptions`、`AtlasContext` |

## 每会话状态

```typescript
interface SessionState {
  promptFailureCount: number  // 在失败的延续时递增
  // 在成功的延续时重置
}
```

5 分钟暂停前的最大连续失败次数：5（todo-continuation-enforcer 中的指数退避）。

## 与其他钩子的关系

- **atlasHook**（延续层）：主编排器，处理 boulder 会话
- **todoContinuationEnforcer**（延续层）：主 Sisyphus 会话的"Boulder"机制
- 两者都注入 session.idle，但服务于不同的会话类型
