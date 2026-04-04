# Code Changes: `max_background_agents` Config Option

## 1. Schema Change

**File:** `src/config/schema/background-task.ts`

```typescript
import { z } from "zod"

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  maxDepth: z.number().int().min(1).optional(),
  maxDescendants: z.number().int().min(1).optional(),
  /** Maximum number of background agents that can run simultaneously across all models/providers (default: no global limit, only per-model limits apply) */
  maxBackgroundAgents: z.number().int().min(1).optional(),
  /** Stale timeout in milliseconds - interrupt tasks with no activity for this duration (default: 180000 = 3 minutes, minimum: 60000 = 1 minute) */
  staleTimeoutMs: z.number().min(60000).optional(),
  /** Timeout for tasks that never received any progress update, falling back to startedAt (default: 1800000 = 30 minutes, minimum: 60000 = 1 minute) */
  messageStalenessTimeoutMs: z.number().min(60000).optional(),
  syncPollTimeoutMs: z.number().min(60000).optional(),
})

export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>
```

**What changed:** Added `maxBackgroundAgents` field after `maxDescendants` (grouped with other limit fields). Uses `z.number().int().min(1).optional()` matching the pattern of `maxDepth` and `maxDescendants`.

---

## 2. ConcurrencyManager Changes

**File:** `src/features/background-agent/concurrency.ts`

```typescript
import type { BackgroundTaskConfig } from "../../config/schema"

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
  private globalCount = 0
  private globalQueue: QueueEntry[] = []

  constructor(config?: BackgroundTaskConfig) {
    this.config = config
  }

  getGlobalLimit(): number {
    const limit = this.config?.maxBackgroundAgents
    if (limit === undefined) {
      return Infinity
    }
    return limit
  }

  getConcurrencyLimit(model: string): number {
    const modelLimit = this.config?.modelConcurrency?.[model]
    if (modelLimit !== undefined) {
      return modelLimit === 0 ? Infinity : modelLimit
    }
    const provider = model.split('/')[0]
    const providerLimit = this.config?.providerConcurrency?.[provider]
    if (providerLimit !== undefined) {
      return providerLimit === 0 ? Infinity : providerLimit
    }
    const defaultLimit = this.config?.defaultConcurrency
    if (defaultLimit !== undefined) {
      return defaultLimit === 0 ? Infinity : defaultLimit
    }
    return 5
  }

  async acquire(model: string): Promise<void> {
    const perModelLimit = this.getConcurrencyLimit(model)
    const globalLimit = this.getGlobalLimit()

    // Fast path: both limits have capacity
    if (perModelLimit === Infinity && globalLimit === Infinity) {
      return
    }

    const currentPerModel = this.counts.get(model) ?? 0

    if (currentPerModel < perModelLimit && this.globalCount < globalLimit) {
      this.counts.set(model, currentPerModel + 1)
      this.globalCount++
      return
    }

    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve: () => {
          if (entry.settled) return
          entry.settled = true
          resolve()
        },
        rawReject: reject,
        settled: false,
      }

      // Queue on whichever limit is blocking
      if (currentPerModel >= perModelLimit) {
        const queue = this.queues.get(model) ?? []
        queue.push(entry)
        this.queues.set(model, queue)
      } else {
        this.globalQueue.push(entry)
      }
    })
  }

  release(model: string): void {
    const perModelLimit = this.getConcurrencyLimit(model)
    const globalLimit = this.getGlobalLimit()

    if (perModelLimit === Infinity && globalLimit === Infinity) {
      return
    }

    // Try per-model handoff first
    const queue = this.queues.get(model)
    while (queue && queue.length > 0) {
      const next = queue.shift()!
      if (!next.settled) {
        // Hand off the slot to this waiter (counts stay the same)
        next.resolve()
        return
      }
    }

    // No per-model handoff - decrement per-model count
    const current = this.counts.get(model) ?? 0
    if (current > 0) {
      this.counts.set(model, current - 1)
    }

    // Try global handoff
    while (this.globalQueue.length > 0) {
      const next = this.globalQueue.shift()!
      if (!next.settled) {
        // Hand off the global slot - but the waiter still needs a per-model slot
        // Since they were queued on global, their per-model had capacity
        // Re-acquire per-model count for them
        const waiterModel = this.findModelForGlobalWaiter()
        if (waiterModel) {
          const waiterCount = this.counts.get(waiterModel) ?? 0
          this.counts.set(waiterModel, waiterCount + 1)
        }
        next.resolve()
        return
      }
    }

    // No handoff occurred - decrement global count
    if (this.globalCount > 0) {
      this.globalCount--
    }
  }

  /**
   * Cancel all waiting acquires for a model. Used during cleanup.
   */
  cancelWaiters(model: string): void {
    const queue = this.queues.get(model)
    if (queue) {
      for (const entry of queue) {
        if (!entry.settled) {
          entry.settled = true
          entry.rawReject(new Error(`Concurrency queue cancelled for model: ${model}`))
        }
      }
      this.queues.delete(model)
    }
  }

  /**
   * Clear all state. Used during manager cleanup/shutdown.
   * Cancels all pending waiters.
   */
  clear(): void {
    for (const [model] of this.queues) {
      this.cancelWaiters(model)
    }
    // Cancel global queue waiters
    for (const entry of this.globalQueue) {
      if (!entry.settled) {
        entry.settled = true
        entry.rawReject(new Error("Concurrency queue cancelled: manager shutdown"))
      }
    }
    this.globalQueue = []
    this.globalCount = 0
    this.counts.clear()
    this.queues.clear()
  }

  /**
   * Get current count for a model (for testing/debugging)
   */
  getCount(model: string): number {
    return this.counts.get(model) ?? 0
  }

  /**
   * Get queue length for a model (for testing/debugging)
   */
  getQueueLength(model: string): number {
    return this.queues.get(model)?.length ?? 0
  }

  /**
   * Get current global count across all models (for testing/debugging)
   */
  getGlobalCount(): number {
    return this.globalCount
  }

  /**
   * Get global queue length (for testing/debugging)
   */
  getGlobalQueueLength(): number {
    return this.globalQueue.length
  }
}
```

**What changed:**
- Added `globalCount` field to track total active agents across all keys
- Added `globalQueue` for tasks waiting on the global limit
- Added `getGlobalLimit()` method to read `maxBackgroundAgents` from config
- Modified `acquire()` to check both per-model AND global limits
- Modified `release()` to handle global queue handoff and decrement global count
- Modified `clear()` to reset global state
- Added `getGlobalCount()` and `getGlobalQueueLength()` for testing

**Important design note:** The `release()` implementation above is a simplified version. In practice, the global queue handoff is tricky because we need to know which model the global waiter was trying to acquire for. A cleaner approach would be to store the model key in the QueueEntry. Let me refine:

### Refined approach (simpler, more correct)

Instead of a separate global queue, a simpler approach is to check the global limit inside `acquire()` and use a single queue per model. When global capacity frees up on `release()`, we try to drain any model's queue:

```typescript
async acquire(model: string): Promise<void> {
  const perModelLimit = this.getConcurrencyLimit(model)
  const globalLimit = this.getGlobalLimit()

  if (perModelLimit === Infinity && globalLimit === Infinity) {
    return
  }

  const currentPerModel = this.counts.get(model) ?? 0

  if (currentPerModel < perModelLimit && this.globalCount < globalLimit) {
    this.counts.set(model, currentPerModel + 1)
    if (globalLimit !== Infinity) {
      this.globalCount++
    }
    return
  }

  return new Promise<void>((resolve, reject) => {
    const queue = this.queues.get(model) ?? []

    const entry: QueueEntry = {
      resolve: () => {
        if (entry.settled) return
        entry.settled = true
        resolve()
      },
      rawReject: reject,
      settled: false,
    }

    queue.push(entry)
    this.queues.set(model, queue)
  })
}

release(model: string): void {
  const perModelLimit = this.getConcurrencyLimit(model)
  const globalLimit = this.getGlobalLimit()

  if (perModelLimit === Infinity && globalLimit === Infinity) {
    return
  }

  // Try per-model handoff first (same model queue)
  const queue = this.queues.get(model)
  while (queue && queue.length > 0) {
    const next = queue.shift()!
    if (!next.settled) {
      // Hand off the slot to this waiter (per-model and global counts stay the same)
      next.resolve()
      return
    }
  }

  // No per-model handoff - decrement per-model count
  const current = this.counts.get(model) ?? 0
  if (current > 0) {
    this.counts.set(model, current - 1)
  }

  // Decrement global count
  if (globalLimit !== Infinity && this.globalCount > 0) {
    this.globalCount--
  }

  // Try to drain any other model's queue that was blocked by global limit
  if (globalLimit !== Infinity) {
    this.tryDrainGlobalWaiters()
  }
}

private tryDrainGlobalWaiters(): void {
  const globalLimit = this.getGlobalLimit()
  if (this.globalCount >= globalLimit) return

  for (const [model, queue] of this.queues) {
    const perModelLimit = this.getConcurrencyLimit(model)
    const currentPerModel = this.counts.get(model) ?? 0

    if (currentPerModel >= perModelLimit) continue

    while (queue.length > 0 && this.globalCount < globalLimit && currentPerModel < perModelLimit) {
      const next = queue.shift()!
      if (!next.settled) {
        this.counts.set(model, (this.counts.get(model) ?? 0) + 1)
        this.globalCount++
        next.resolve()
        return
      }
    }
  }
}
```

This refined approach keeps all waiters in per-model queues (no separate global queue), and on release, tries to drain waiters from any model queue that was blocked by the global limit.

---

## 3. Schema Test Changes

**File:** `src/config/schema/background-task.test.ts`

Add after the `syncPollTimeoutMs` describe block:

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

    describe("#given maxBackgroundAgents is negative (-1)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          BackgroundTaskConfigSchema.parse({ maxBackgroundAgents: -1 })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given maxBackgroundAgents is non-integer (2.5)", () => {
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

    describe("#given maxBackgroundAgents not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = BackgroundTaskConfigSchema.parse({})

        expect(result.maxBackgroundAgents).toBeUndefined()
      })
    })
  })
```

---

## 4. ConcurrencyManager Test Changes

**File:** `src/features/background-agent/concurrency.test.ts`

Add new describe block:

```typescript
describe("ConcurrencyManager.globalLimit (maxBackgroundAgents)", () => {
  test("should return Infinity when maxBackgroundAgents is not set", () => {
    // given
    const manager = new ConcurrencyManager()

    // when
    const limit = manager.getGlobalLimit()

    // then
    expect(limit).toBe(Infinity)
  })

  test("should return configured maxBackgroundAgents", () => {
    // given
    const config: BackgroundTaskConfig = { maxBackgroundAgents: 3 }
    const manager = new ConcurrencyManager(config)

    // when
    const limit = manager.getGlobalLimit()

    // then
    expect(limit).toBe(3)
  })

  test("should enforce global limit across different models", async () => {
    // given
    const config: BackgroundTaskConfig = {
      maxBackgroundAgents: 2,
      defaultConcurrency: 5,
    }
    const manager = new ConcurrencyManager(config)
    await manager.acquire("model-a")
    await manager.acquire("model-b")

    // when
    let resolved = false
    const waitPromise = manager.acquire("model-c").then(() => { resolved = true })
    await Promise.resolve()

    // then - should be blocked by global limit even though per-model has capacity
    expect(resolved).toBe(false)
    expect(manager.getGlobalCount()).toBe(2)

    // cleanup
    manager.release("model-a")
    await waitPromise
    expect(resolved).toBe(true)
  })

  test("should allow tasks when global limit not reached", async () => {
    // given
    const config: BackgroundTaskConfig = {
      maxBackgroundAgents: 3,
      defaultConcurrency: 5,
    }
    const manager = new ConcurrencyManager(config)

    // when
    await manager.acquire("model-a")
    await manager.acquire("model-b")
    await manager.acquire("model-c")

    // then
    expect(manager.getGlobalCount()).toBe(3)
    expect(manager.getCount("model-a")).toBe(1)
    expect(manager.getCount("model-b")).toBe(1)
    expect(manager.getCount("model-c")).toBe(1)
  })

  test("should respect both per-model and global limits", async () => {
    // given - per-model limit of 1, global limit of 3
    const config: BackgroundTaskConfig = {
      maxBackgroundAgents: 3,
      defaultConcurrency: 1,
    }
    const manager = new ConcurrencyManager(config)
    await manager.acquire("model-a")

    // when - try second acquire on same model
    let resolved = false
    const waitPromise = manager.acquire("model-a").then(() => { resolved = true })
    await Promise.resolve()

    // then - blocked by per-model limit, not global
    expect(resolved).toBe(false)
    expect(manager.getGlobalCount()).toBe(1)

    // cleanup
    manager.release("model-a")
    await waitPromise
  })

  test("should release global slot and unblock waiting tasks", async () => {
    // given
    const config: BackgroundTaskConfig = {
      maxBackgroundAgents: 1,
      defaultConcurrency: 5,
    }
    const manager = new ConcurrencyManager(config)
    await manager.acquire("model-a")

    // when
    let resolved = false
    const waitPromise = manager.acquire("model-b").then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)

    manager.release("model-a")
    await waitPromise

    // then
    expect(resolved).toBe(true)
    expect(manager.getGlobalCount()).toBe(1)
    expect(manager.getCount("model-a")).toBe(0)
    expect(manager.getCount("model-b")).toBe(1)
  })

  test("should not enforce global limit when not configured", async () => {
    // given - no maxBackgroundAgents set
    const config: BackgroundTaskConfig = { defaultConcurrency: 5 }
    const manager = new ConcurrencyManager(config)

    // when - acquire many across different models
    await manager.acquire("model-a")
    await manager.acquire("model-b")
    await manager.acquire("model-c")
    await manager.acquire("model-d")
    await manager.acquire("model-e")
    await manager.acquire("model-f")

    // then - all should succeed (no global limit)
    expect(manager.getCount("model-a")).toBe(1)
    expect(manager.getCount("model-f")).toBe(1)
  })

  test("should reset global count on clear", async () => {
    // given
    const config: BackgroundTaskConfig = { maxBackgroundAgents: 5 }
    const manager = new ConcurrencyManager(config)
    await manager.acquire("model-a")
    await manager.acquire("model-b")

    // when
    manager.clear()

    // then
    expect(manager.getGlobalCount()).toBe(0)
  })
})
```

---

## Config Usage Example

User's `.opencode/oh-my-opencode.jsonc`:

```jsonc
{
  "background_task": {
    // Global limit: max 5 background agents total
    "maxBackgroundAgents": 5,
    // Per-model limits still apply independently
    "defaultConcurrency": 3,
    "providerConcurrency": {
      "anthropic": 2
    }
  }
}
```

With this config:
- Max 5 background agents running simultaneously across all models
- Max 3 per model (default), max 2 for any Anthropic model
- If 2 Anthropic + 3 OpenAI agents are running (5 total), no more can start regardless of per-model capacity
