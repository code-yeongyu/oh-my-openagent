# Bug: Compaction 与 Todo Continuation 竞态条件导致聊天记录崩溃

## 问题概述

当 preemptive-compaction 执行后，如果速度太快完成，todo-continuation-enforcer 可能在 compaction 完成后立即注入 continuation prompt。由于 compaction 后 context 被压缩，agent 可能无法正确输出内容，但 todo list 中仍存在未完成任务。这导致 session 快速进入 idle 状态，hook 反复提醒还有 todo 没做，形成无限循环，最终导致聊天记录崩溃。

## 影响范围

- **严重程度**: Critical
- **影响版本**: 当前版本
- **触发条件**: Preemptive compaction + 存在未完成的 todos

## 根本原因分析

### 1. 事件处理顺序

在 `src/index.ts` 第 359-374 行，事件处理顺序如下：

```typescript
event: async (input) => {
  // ...
  await todoContinuationEnforcer?.handler(input);   // 先处理
  // ...
  await preemptiveCompaction?.event(input);         // 后处理
  // ...
}
```

两个 hook 都会响应 `session.idle` 事件，且都可能触发新的 prompt 注入。

### 2. Preemptive Compaction 的快速恢复

在 `src/hooks/preemptive-compaction/index.ts` 第 191-205 行：

```typescript
// compaction 成功后仅 500ms 就发送 "Continue"
setTimeout(async () => {
  try {
    await ctx.client.session.promptAsync({
      path: { id: sessionID },
      body: {
        agent: storedMessage?.agent,
        parts: [{ type: "text", text: "Continue" }],
      },
      query: { directory: ctx.directory },
    })
  } catch {}
}, 500)
```

### 3. Todo Continuation 缺乏 Compaction 感知

在 `src/hooks/todo-continuation-enforcer.ts` 中：

- **没有检测 compaction 状态**：不知道 compaction 是否正在进行或刚刚完成
- **countdown 仅 2 秒**：`COUNTDOWN_SECONDS = 2`
- **没有全局节流**：测试明确验证 "should not have 10s throttle between injections"
- **Grace period 仅 500ms**：`COUNTDOWN_GRACE_PERIOD_MS = 500`

### 4. 竞态时间线

```
T+0ms     : session.idle 事件触发
T+0ms     : todo-continuation-enforcer 检测到 incomplete todos
T+0ms     : 启动 2s countdown 并显示 toast
T+0ms     : preemptive-compaction 检测到 token usage 超过阈值
T+0ms     : 开始执行 ctx.client.session.summarize()
T+Xms     : summarize 完成（X 可能 < 2000ms）
T+X+500ms : preemptive-compaction 发送 "Continue" prompt
T+X+500ms : 这会触发 message.updated 事件
           
           [关键问题] 如果 X+500ms < 2000ms：
           - message.updated(role="user") 可能在 grace period 内被忽略
           - 或者 countdown 仍在运行
           
T+2000ms  : todo-continuation countdown 结束
T+2000ms  : injectContinuation() 被调用
T+2000ms  : 发送 "[SYSTEM REMINDER - TODO CONTINUATION]" prompt

           [结果] 两个 prompts 几乎同时到达：
           1. "Continue" (from compaction)
           2. "[SYSTEM REMINDER...]" (from todo-continuation)
           
           Agent 可能：
           - 只响应其中一个
           - 响应混乱或为空
           - 快速完成并进入 idle
           
T+2100ms  : session.idle 再次触发
T+2100ms  : todos 仍未完成（agent 没有正确处理）
T+2100ms  : todo-continuation 再次启动 countdown
           
           [循环开始] → 无限重复 → 聊天记录崩溃
```

## 问题代码位置

| 文件 | 行号 | 问题 |
|------|------|------|
| `src/hooks/preemptive-compaction/index.ts` | 191-205 | 500ms 后立即发送 Continue，无协调机制 |
| `src/hooks/todo-continuation-enforcer.ts` | 46 | COUNTDOWN_SECONDS = 2，太短 |
| `src/hooks/todo-continuation-enforcer.ts` | 150-224 | injectContinuation 没有检查 compaction 状态 |
| `src/index.ts` | 364, 371 | 两个 hook 独立处理 session.idle，无协调 |

## 复现步骤

1. 创建一个包含多个 todos 的 session
2. 执行大量操作直到 context window 使用率达到 85%+
3. 让 agent 完成部分工作后停止（session.idle）
4. 观察：
   - preemptive-compaction 触发 summarize
   - summarize 完成后发送 "Continue"
   - todo-continuation 同时注入 reminder
   - Agent 响应混乱
   - 快速循环开始
   - 聊天记录中充满重复的 "[SYSTEM REMINDER - TODO CONTINUATION]"

## 建议修复方案

### 方案 A: Compaction 状态共享

在 preemptive-compaction 中暴露状态，让 todo-continuation 可以检查：

```typescript
// preemptive-compaction/index.ts
export interface PreemptiveCompactionHook {
  event: (input: EventInput) => Promise<void>
  isCompactionInProgress: (sessionID: string) => boolean
  getLastCompactionTime: (sessionID: string) => number | undefined
}

// todo-continuation-enforcer.ts
// 在 injectContinuation 中检查
if (preemptiveCompaction?.isCompactionInProgress(sessionID)) {
  log(`[${HOOK_NAME}] Skipped: compaction in progress`)
  return
}

const lastCompaction = preemptiveCompaction?.getLastCompactionTime(sessionID) ?? 0
const COMPACTION_COOLDOWN = 5000 // 5秒冷却
if (Date.now() - lastCompaction < COMPACTION_COOLDOWN) {
  log(`[${HOOK_NAME}] Skipped: recently compacted`)
  return
}
```

### 方案 B: 添加全局节流

在 todo-continuation-enforcer 中添加最小注入间隔：

```typescript
const MIN_INJECTION_INTERVAL_MS = 10000 // 10秒

// 在 injectContinuation 中
const lastInjection = state.lastInjectionTime ?? 0
if (Date.now() - lastInjection < MIN_INJECTION_INTERVAL_MS) {
  log(`[${HOOK_NAME}] Skipped: throttled`)
  return
}
```

### 方案 C: Preemptive Compaction 禁用 Todo Continuation

compaction 完成后标记 session 为 "recovering" 状态：

```typescript
// preemptive-compaction/index.ts
// 在 summarize 成功后
if (todoContinuationEnforcer) {
  todoContinuationEnforcer.markRecovering(sessionID)
  
  setTimeout(() => {
    todoContinuationEnforcer.markRecoveryComplete(sessionID)
  }, 5000) // 5秒后恢复
}
```

### 方案 D: 统一 Continuation 管理器

创建一个中央协调器来管理所有 continuation prompts：

```typescript
interface ContinuationManager {
  requestContinuation(sessionID: string, source: string, priority: number): void
  isRequestPending(sessionID: string): boolean
  cancelRequest(sessionID: string, source: string): void
}
```

## 推荐方案

**方案 A + B 组合**：

1. 暴露 compaction 状态供其他 hooks 查询
2. 添加 10 秒全局节流作为安全网
3. 这样既解决了竞态问题，又提供了防止任何形式循环的保护

## 相关文件

- `src/hooks/preemptive-compaction/index.ts`
- `src/hooks/todo-continuation-enforcer.ts`
- `src/index.ts`
- `src/hooks/preemptive-compaction/constants.ts`

## 测试建议

1. 添加集成测试：compaction + todos 场景
2. 添加 mock 测试：快速 compaction 完成时的行为
3. 验证修复后不会出现重复 injection
