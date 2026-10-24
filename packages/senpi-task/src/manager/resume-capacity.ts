import type { TaskRecord } from "../state"
import type { TaskConcurrency, ParkedLease } from "./concurrency"
import type { QueuedTaskAdmission } from "./concurrency-waiters"

export type ResumeAllocation = Pick<QueuedTaskAdmission, "model" | "laneKey" | "sequence">

export class ResumeCapacity {
  readonly #parked = new Map<string, ParkedLease>()
  readonly #concurrency: TaskConcurrency

  constructor(concurrency: TaskConcurrency) { this.#concurrency = concurrency }

  park(taskId: string, epoch: number): void {
    const lease = this.#concurrency.park(taskId, epoch)
    if (lease !== undefined) this.#parked.set(taskId, lease)
  }

  async acquire(record: TaskRecord, signal: AbortSignal, allocation?: ResumeAllocation): Promise<boolean> {
    if (signal.aborted) return false
    const taskId = record.task_id
    const epoch = record.notification.run_epoch
    const token = this.#parked.get(taskId)
    if (token !== undefined) {
      const cancel = (): void => this.#concurrency.suspendUnpark(token)
      signal.addEventListener("abort", cancel, { once: true })
      try {
        await this.#concurrency.unpark(token)
        if (signal.aborted) return false
        const held = this.#concurrency.leaseState(taskId, epoch) === "held"
        if (held && this.#parked.get(taskId) === token) this.#parked.delete(taskId)
        return held
      } finally {
        signal.removeEventListener("abort", cancel)
      }
    }
    if (this.#concurrency.leaseState(taskId, epoch) === "held") return true
    // A restarted owner has no original token. Acquire a new lease for its recorded epoch.
    const model = allocation?.model ?? record.model
    const granted = Promise.withResolvers<void>()
    const cancel = (): void => {
      this.#concurrency.withdraw(model, taskId, epoch)
      granted.resolve()
    }
    signal.addEventListener("abort", cancel, { once: true })
    try {
      if (allocation === undefined) this.#concurrency.enqueue(model, taskId, epoch, () => granted.resolve())
      else this.#concurrency.requeue({
        taskId, runEpoch: epoch, model, laneKey: allocation.laneKey, sequence: allocation.sequence,
      }, () => granted.resolve())
      this.#concurrency.drain()
      await granted.promise
      return !signal.aborted && this.#concurrency.leaseState(taskId, epoch) === "held"
    } finally {
      signal.removeEventListener("abort", cancel)
    }
  }

  forget(taskId: string): void { this.#parked.delete(taskId) }
}
