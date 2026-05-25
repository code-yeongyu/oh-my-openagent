# src/hooks/ralph-loop/ — 自指开发循环

**生成时间:** 2026-05-15

## 概述

14 个文件（约 1687 行）。`ralphLoop` 会话层钩子 — 驱动 `/ralph-loop` 命令。迭代开发循环，直到 Agent 发出 `<promise>DONE</promise>` 或达到最大迭代次数。

## 循环生命周期

```
/ralph-loop → startLoop(sessionID, prompt, options)
  → loopState.startLoop() → 持久化状态到 .omo/ralph-loop.local.md
  → session.idle 事件 → createRalphLoopEventHandler()
    → completionPromiseDetector: 扫描输出中是否有 <promise>DONE</promise>
    → 如果未完成：注入延续提示 → 循环
    → 如果完成或达到 maxIterations：cancelLoop()
```

## 关键文件

| 文件 | 用途 |
|------|---------|
| `ralph-loop-hook.ts` | `createRalphLoopHook()` — 组合控制器 + 恢复 + 事件处理器 |
| `ralph-loop-event-handler.ts` | `createRalphLoopEventHandler()` — 处理 session.idle，驱动循环 |
| `loop-state-controller.ts` | 状态 CRUD：startLoop、cancelLoop、getState、持久化到磁盘 |
| `loop-session-recovery.ts` | 从崩溃/中断的循环会话中恢复 |
| `completion-promise-detector.ts` | 扫描会话记录中是否有 `<promise>DONE</promise>` |
| `continuation-prompt-builder.ts` | 为下一次迭代构建延续消息 |
| `continuation-prompt-injector.ts` | 将构建的提示注入活跃会话 |
| `storage.ts` | 读/写 `.omo/ralph-loop.local.md` 状态文件 |
| `message-storage-directory.ts` | 提示注入的临时目录 |
| `with-timeout.ts` | 带超时的 API 调用包装器（默认 5000 毫秒）|
| `types.ts` | `RalphLoopState`、`RalphLoopOptions`、循环迭代类型 |

## 状态文件

```
.omo/ralph-loop.local.md  (gitignored)
  → sessionID、prompt、迭代计数、maxIterations、completionPromise、ultrawork 标志
```

## 选项

```typescript
startLoop(sessionID, prompt, {
  maxIterations?: number  // 从配置读取默认（默认：100）
  completionPromise?: string  // 自定义"完成"信号（默认："<promise>DONE</promise>"）
  ultrawork?: boolean  // 为迭代启用 ultrawork 模式
})
```

## 导出的接口

```typescript
interface RalphLoopHook {
  event: (input) => Promise<void>  // session.idle 处理器
  startLoop: (sessionID, prompt, options?) => boolean
  cancelLoop: (sessionID) => boolean
  getState: () => RalphLoopState | null
}
```
