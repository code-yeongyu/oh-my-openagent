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

  constructor(config?: BackgroundTaskConfig) {
    this.config = config
  }

  private normalizeLimit(value: number): number {
    if (!Number.isFinite(value)) return 0
    if (value <= 0) return 0
    const floored = Math.floor(value)
    if (floored <= 0) return 0
    return Math.min(floored, 10)
  }

  getConcurrencyLimit(model: string): number {
    const modelLimit = this.config?.modelConcurrency?.[model]
    if (modelLimit !== undefined) {
      return this.normalizeLimit(modelLimit)
    }
    const provider = model.split('/')[0]
    const providerLimit = this.config?.providerConcurrency?.[provider]
    if (providerLimit !== undefined) {
      return this.normalizeLimit(providerLimit)
    }
    const defaultLimit = this.config?.defaultConcurrency
    if (defaultLimit !== undefined) {
      return this.normalizeLimit(defaultLimit)
    }
    return 5
  }

  async acquire(model: string): Promise<void> {
    const limit = this.getConcurrencyLimit(model)
    if (limit <= 0) {
      throw new Error("Background tasks are disabled (concurrency=0)")
    }

    const current = this.counts.get(model) ?? 0
    if (current < limit) {
      this.counts.set(model, current + 1)
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
    const limit = this.getConcurrencyLimit(model)
    if (limit <= 0) return

    const queue = this.queues.get(model)

    // Try to hand off to a waiting entry (skip any settled entries from cancelWaiters)
    while (queue && queue.length > 0) {
      const next = queue.shift()!
      if (!next.settled) {
        // Hand off the slot to this waiter (count stays the same)
        next.resolve()
        return
      }
    }

    // No handoff occurred - decrement the count to free the slot
    const current = this.counts.get(model) ?? 0
    if (current > 0) {
      this.counts.set(model, current - 1)
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
}
