# Code Changes: `max_background_agents` Config Option

## 1. `src/config/schema/background-task.ts` — Add schema field

```typescript
import { z } from "zod"

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  maxDepth: z.number().int().min(1).optional(),
  maxDescendants: z.number().int().min(1).optional(),
  /** Maximum number of background agents that can run simultaneously across all models/providers (default: 5, minimum: 1) */
  maxBackgroundAgents: z.number().int().min(1).optional(),
  /** Stale timeout in milliseconds - interrupt tasks with no activity for this duration (default: 180000 = 3 minutes, minimum: 60000 = 1 minute) */
  staleTimeoutMs: z.number().min(60000).optional(),
  /** Timeout for tasks that never received any progress update, falling back to startedAt (default: 1800000 = 30 minutes, minimum: 60000 = 1 minute) */
  messageStalenessTimeoutMs: z.number().min(60000).optional(),
  syncPollTimeoutMs: z.number().min(60000).optional(),
})

export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>
```

**Rationale:** Follows exact same pattern as `maxDepth` and `maxDescendants` — `z.number().int().min(1).optional()`. The field is optional; runtime default of 5 is applied in `ConcurrencyManager`. No barrel export changes needed since `src/config/schema.ts` already does `export * from "./schema/background-task"` and the type is inferred.

---

## 2. `src/config/schema/background-task.test.ts` — Add validation tests

Append after the existing `syncPollTimeoutMs` describe block (before the closing `})`):

```typescript
  describe("maxBackgroundAgents", () => {
    describe("#given valid maxBackgroundAgents (10)", () => {
      test("#when parsed #then returns correct value", () => {
        const result = BackgroundTaskConfigSchema.parse({ maxBackgroundAgents: 10 })

        expect(result.maxBackgroundAgents).toBe(10)
      })
    })

    describe("#given maxBackgroundAgents of 1 (minimum)", () => {
      test("#when parsed #then returns correct value", () => {
        const result = BackgroundTaskConfigSchema.parse({ maxBackgroundAgents: 1 })

        expect(result.maxBackgroundAgents).toBe(1)
      })
    })

    describe("#given maxBackgroundAgents below minimum (0)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          BackgroundTaskConfigSchema.parse({ maxBackgroundAgents: 0 })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given maxBackgroundAgents not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = BackgroundTaskConfigSchema.parse({})

        expect(result.maxBackgroundAgents).toBeUndefined()
      })
    })

    describe('#given maxBackgroundAgents is non-integer (2.5)', () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          BackgroundTaskConfigSchema.parse({ maxBackgroundAgents: 2.5 })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })
  })
```

**Rationale:** Follows exact test pattern from `maxDepth`, `maxDescendants`, and `syncPollTimeoutMs` tests. Uses `#given`/`#when`/`#then` nested describe style. Tests valid, minimum boundary, below minimum, not provided, and non-integer cases.

---

## 3. `src/features/background-agent/concurrency.ts` — Add global agent limit

```typescript
import type { BackgroundTaskConfig } from "../../config/schema"

const DEFAULT_MAX_BACKGROUND_AGENTS = 5

/**
 * Queue entry with settled-flag pattern to prevent double-resolution.
 *
 * The settled flag ensures that cancelWaiters() doesn't reject
 * an entry that was already resolved by release().
 */
interface QueueEntry {
  resolve: () => void
  rawReject: (error: Error) => void
  settled: boolean
}

export class ConcurrencyManager {
  private config?: BackgroundTaskConfig
  private counts: Map<string, number> = new Map()
  private queues: Map<string, QueueEntry[]> = new Map()
  private globalRunningCount = 0

  constructor(config?: BackgroundTaskConfig) {
    this.config = config
  }

  getMaxBackgroundAgents(): number {
    return this.config?.maxBackgroundAgents ?? DEFAULT_MAX_BACKGROUND_AGENTS
  }

  getGlobalRunningCount(): number {
    return this.globalRunningCount
  }

  canSpawnGlobally(): boolean {
    return this.globalRunningCount < this.getMaxBackgroundAgents()
  }

  acquireGlobal(): void {
    this.globalRunningCount++
  }

  releaseGlobal(): void {
    if (this.globalRunningCount > 0) {
      this.globalRunningCount--
    }
  }

  getConcurrencyLimit(model: string): number {
    // ... existing implementation unchanged ...
  }

  async acquire(model: string): Promise<void> {
    // ... existing implementation unchanged ...
  }

  release(model: string): void {
    // ... existing implementation unchanged ...
  }

  cancelWaiters(model: string): void {
    // ... existing implementation unchanged ...
  }

  clear(): void {
    for (const [model] of this.queues) {
      this.cancelWaiters(model)
    }
    this.counts.clear()
    this.queues.clear()
    this.globalRunningCount = 0
  }

  getCount(model: string): number {
    return this.counts.get(model) ?? 0
  }

  getQueueLength(model: string): number {
    return this.queues.get(model)?.length ?? 0
  }
}
```

**Key changes:**
- Add `DEFAULT_MAX_BACKGROUND_AGENTS = 5` constant
- Add `globalRunningCount` private field
- Add `getMaxBackgroundAgents()`, `getGlobalRunningCount()`, `canSpawnGlobally()`, `acquireGlobal()`, `releaseGlobal()` methods
- `clear()` resets `globalRunningCount` to 0
- All existing per-model methods remain unchanged

---

## 4. `src/features/background-agent/concurrency.test.ts` — Add global limit tests

Append new describe block:

```typescript
describe("ConcurrencyManager global background agent limit", () => {
  test("should default max background agents to 5 when no config", () => {
    // given
    const manager = new ConcurrencyManager()

    // when
    const max = manager.getMaxBackgroundAgents()

    // then
    expect(max).toBe(5)
  })

  test("should use configured maxBackgroundAgents", () => {
    // given
    const config: BackgroundTaskConfig = { maxBackgroundAgents: 10 }
    const manager = new ConcurrencyManager(config)

    // when
    const max = manager.getMaxBackgroundAgents()

    // then
    expect(max).toBe(10)
  })

  test("should allow spawning when under global limit", () => {
    // given
    const config: BackgroundTaskConfig = { maxBackgroundAgents: 2 }
    const manager = new ConcurrencyManager(config)

    // when
    manager.acquireGlobal()

    // then
    expect(manager.canSpawnGlobally()).toBe(true)
    expect(manager.getGlobalRunningCount()).toBe(1)
  })

  test("should block spawning when at global limit", () => {
    // given
    const config: BackgroundTaskConfig = { maxBackgroundAgents: 2 }
    const manager = new ConcurrencyManager(config)

    // when
    manager.acquireGlobal()
    manager.acquireGlobal()

    // then
    expect(manager.canSpawnGlobally()).toBe(false)
    expect(manager.getGlobalRunningCount()).toBe(2)
  })

  test("should allow spawning again after release", () => {
    // given
    const config: BackgroundTaskConfig = { maxBackgroundAgents: 1 }
    const manager = new ConcurrencyManager(config)
    manager.acquireGlobal()

    // when
    manager.releaseGlobal()

    // then
    expect(manager.canSpawnGlobally()).toBe(true)
    expect(manager.getGlobalRunningCount()).toBe(0)
  })

  test("should not go below zero on extra release", () => {
    // given
    const manager = new ConcurrencyManager()

    // when
    manager.releaseGlobal()

    // then
    expect(manager.getGlobalRunningCount()).toBe(0)
  })

  test("should reset global count on clear", () => {
    // given
    const config: BackgroundTaskConfig = { maxBackgroundAgents: 5 }
    const manager = new ConcurrencyManager(config)
    manager.acquireGlobal()
    manager.acquireGlobal()
    manager.acquireGlobal()

    // when
    manager.clear()

    // then
    expect(manager.getGlobalRunningCount()).toBe(0)
  })
})
```

---

## 5. `src/features/background-agent/manager.ts` — Enforce global limit

### In `launch()` method — add check before task creation (after `reserveSubagentSpawn`):

```typescript
  async launch(input: LaunchInput): Promise<BackgroundTask> {
    // ... existing logging ...

    if (!input.agent || input.agent.trim() === "") {
      throw new Error("Agent parameter is required")
    }

    // Check global background agent limit before spawn guard
    if (!this.concurrencyManager.canSpawnGlobally()) {
      const max = this.concurrencyManager.getMaxBackgroundAgents()
      const current = this.concurrencyManager.getGlobalRunningCount()
      throw new Error(
        `Background agent spawn blocked: ${current} agents running, max is ${max}. Wait for existing tasks to complete or increase background_task.maxBackgroundAgents.`
      )
    }

    const spawnReservation = await this.reserveSubagentSpawn(input.parentSessionID)

    try {
      // ... existing code ...

      // After task creation, before queueing:
      this.concurrencyManager.acquireGlobal()

      // ... rest of existing code ...
    } catch (error) {
      spawnReservation.rollback()
      throw error
    }
  }
```

### In `trackTask()` method — add global check:

```typescript
  async trackTask(input: { ... }): Promise<BackgroundTask> {
    const existingTask = this.tasks.get(input.taskId)
    if (existingTask) {
      // ... existing re-registration logic unchanged ...
      return existingTask
    }

    // Check global limit for new external tasks
    if (!this.concurrencyManager.canSpawnGlobally()) {
      const max = this.concurrencyManager.getMaxBackgroundAgents()
      const current = this.concurrencyManager.getGlobalRunningCount()
      throw new Error(
        `Background agent spawn blocked: ${current} agents running, max is ${max}. Wait for existing tasks to complete or increase background_task.maxBackgroundAgents.`
      )
    }

    // ... existing task creation ...
    this.concurrencyManager.acquireGlobal()

    // ... rest unchanged ...
  }
```

### In `tryCompleteTask()` — release global slot:

```typescript
  private async tryCompleteTask(task: BackgroundTask, source: string): Promise<boolean> {
    if (task.status !== "running") {
      // ... existing guard ...
      return false
    }

    task.status = "completed"
    task.completedAt = new Date()
    // ... existing history record ...

    removeTaskToastTracking(task.id)

    // Release per-model concurrency
    if (task.concurrencyKey) {
      this.concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }

    // Release global slot
    this.concurrencyManager.releaseGlobal()

    // ... rest unchanged ...
  }
```

### In `cancelTask()` — release global slot:

```typescript
  async cancelTask(taskId: string, options?: { ... }): Promise<boolean> {
    // ... existing code up to concurrency release ...

    if (task.concurrencyKey) {
      this.concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }

    // Release global slot (only for running tasks, pending never acquired)
    if (task.status !== "pending") {
      this.concurrencyManager.releaseGlobal()
    }

    // ... rest unchanged ...
  }
```

### In `handleEvent()` session.error handler — release global slot:

```typescript
    if (event.type === "session.error") {
      // ... existing error handling ...

      task.status = "error"
      // ...

      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey)
        task.concurrencyKey = undefined
      }

      // Release global slot
      this.concurrencyManager.releaseGlobal()

      // ... rest unchanged ...
    }
```

### In prompt error handler inside `startTask()` — release global slot:

```typescript
    promptWithModelSuggestionRetry(this.client, { ... }).catch((error) => {
      // ... existing error handling ...
      if (existingTask) {
        existingTask.status = "interrupt"
        // ...
        if (existingTask.concurrencyKey) {
          this.concurrencyManager.release(existingTask.concurrencyKey)
          existingTask.concurrencyKey = undefined
        }

        // Release global slot
        this.concurrencyManager.releaseGlobal()

        // ... rest unchanged ...
      }
    })
```

---

## Summary of Changes

| File | Lines Added | Lines Modified |
|------|-------------|----------------|
| `src/config/schema/background-task.ts` | 2 | 0 |
| `src/config/schema/background-task.test.ts` | ~50 | 0 |
| `src/features/background-agent/concurrency.ts` | ~25 | 1 (`clear()`) |
| `src/features/background-agent/concurrency.test.ts` | ~70 | 0 |
| `src/features/background-agent/manager.ts` | ~20 | 0 |

Total: ~167 lines added, 1 line modified across 5 files.
