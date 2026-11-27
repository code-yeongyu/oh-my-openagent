import type { QueuedTaskAdmission } from "./concurrency-waiters"

export type ParkedEntry = {
  readonly lease: QueuedTaskAdmission
  readonly resumed: Promise<void>
  readonly resolve: () => void
  resumable: boolean
}

export class ParkedLeases extends Map<string, Map<string, ParkedEntry>> {
  store(lease: QueuedTaskAdmission): void {
    const lane = this.get(lease.laneKey) ?? new Map<string, ParkedEntry>()
    lane.set(taskLeaseKey(lease.taskId, lease.runEpoch), entryOf(lease))
    this.set(lease.laneKey, lane)
  }

  suspend(lease: QueuedTaskAdmission): void {
    const lane = this.get(lease.laneKey)
    const key = taskLeaseKey(lease.taskId, lease.runEpoch)
    const entry = lane?.get(key)
    if (lane === undefined || entry?.lease !== lease || !entry.resumable) return
    // Settle only this Resume's waiter; the original parked ownership remains dormant.
    lane.set(key, entryOf(lease))
    entry.resolve()
  }

  remove(entry: ParkedEntry): void {
    const lane = this.get(entry.lease.laneKey)
    const key = taskLeaseKey(entry.lease.taskId, entry.lease.runEpoch)
    if (lane === undefined || lane.get(key) !== entry) return
    lane.delete(key)
    if (lane.size === 0) this.delete(entry.lease.laneKey)
    entry.resolve()
  }
}

function entryOf(lease: QueuedTaskAdmission): ParkedEntry {
  const { promise, resolve } = Promise.withResolvers<void>()
  return { lease, resumed: promise, resolve, resumable: false }
}

export function taskLeaseKey(taskId: string, runEpoch: number): string {
  return `${taskId.length}:${taskId}:${runEpoch}`
}
