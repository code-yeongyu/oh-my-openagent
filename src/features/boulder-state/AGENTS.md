# src/features/boulder-state/ — 活跃工作计划跟踪器

**生成时间:** 2026-05-15

## 概述

10 个文件（约 1k 行，不含测试）。跟踪 Sisyphus 的"巨石"——跨越会话、工作树和子 Agent 任务委派的当前活跃工作计划。取名于西西弗斯神话：巨石必须持续滚动直到计划完成。

可通过 `bunx oh-my-opencode boulder` 交互式查看（参见 [`src/cli/boulder/`](file:///Users/yeongyu/local-workspaces/omo/src/cli/boulder/)）。

## 模式（v2）

```typescript
interface BoulderState {
  schema_version?: 2
  active_work_id?: string
  works?: Record<string, BoulderWorkState>
  active_plan: string                            // 当前活跃 .md 计划的绝对路径
  started_at: string                             // ISO 时间戳
  ended_at?: string
  elapsed_ms?: number
  status?: "active" | "completed" | "paused" | "abandoned"
  session_ids: string[]                          // 所有曾推动过巨石的会话
  session_origins?: Record<string, "direct" | "appended">
  plan_name: string                              // active_plan 的文件名
  agent?: string                                 // 恢复时的 Agent（atlas | sisyphus | ...）
  worktree_path?: string                         // git 工作树根路径
  task_sessions?: Record<string, TaskSessionState>  // 每个顶层任务的可复用子 Agent 会话
}
```

## 文件

| 文件 | 用途 |
|------|------|
| `types.ts` | `BoulderState`、`BoulderWorkState`、`TaskSessionState`、状态枚举 |
| `storage.ts` | `.omo/boulder.json` 的原子 CRUD。通过临时文件 + 重命名写入；按 work_id 文件锁 |
| `constants.ts` | 路径解析 + 模式版本常量 |
| `top-level-task.ts` | 辅助函数，识别当前顶层计划任务并解析其可复用的子 Agent 会话 |
| `format-duration.ts` | `formatDurationHuman(ms)` — "1h 23m 5s" 格式的巨石持续时间 |
| `index.ts` | 桶导出 |

## 生命周期

```
session.startWork(plan)
  → 创建 BoulderState，记录 active_plan、started_at、plan_name
  → atlas-hook 在 session.idle 时读取 BoulderState 以进行巨石延续
  → ralph-loop 读取 task_sessions 以恢复子 Agent 工作
session.idle（计划未完成）
  → todoContinuationEnforcer + atlasHook 检查状态
  → 注入 CONTINUATION_PROMPT 或 BOULDER_COMPLETE_PROMPT
session.completed
  → BoulderState status="completed"，记录 ended_at、elapsed_ms
```

## 集成点

| 位置 | 作用 |
|-------|------|
| [`src/cli/boulder/`](file:///Users/yeongyu/local-workspaces/omo/src/cli/boulder/) | CLI 检查器格式化此状态 |
| [`src/hooks/atlas/`](file:///Users/yeongyu/local-workspaces/omo/src/hooks/atlas/) | Reads work state, drives boulder-complete and parallel-delegation prompts |
| [`src/hooks/ralph-loop/`](file:///Users/yeongyu/local-workspaces/omo/src/hooks/ralph-loop/) | Resumes subagent task sessions via `task_sessions` |
| [`src/hooks/start-work/`](file:///Users/yeongyu/local-workspaces/omo/src/hooks/start-work/) | Creates the BoulderState on `/start-work` invocation |
| [`src/hooks/todo-continuation-enforcer/`](file:///Users/yeongyu/local-workspaces/omo/src/hooks/todo-continuation-enforcer/) | Session-idle continuation when boulder incomplete |

## STORAGE

```
<worktree-root>/.omo/boulder.json   # gitignored; one file per worktree
```

Atomic writes: temp file → fsync (where supported) → rename. File lock prevents concurrent corruption. Schema migrations between versions handled inline in `storage.ts`.

## NOTES

- **task_sessions reuse**: same subagent session is reused across iterations for the same top-level task to preserve context.
- **Multi-work**: `works` map allows tracking multiple concurrent plans; `active_work_id` selects the current one.
- **Worktree-scoped**: state lives in the worktree, not user-global; ensures parallel work plans across worktrees stay isolated.
