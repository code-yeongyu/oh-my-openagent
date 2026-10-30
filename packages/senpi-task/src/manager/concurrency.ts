import { TaskWaitQueue, type QueuedTaskAdmission, type TaskWaiter as Waiter } from "./concurrency-waiters"
import { getTaskLimit, getTaskLaneKey, type TaskConcurrencyConfig } from "./concurrency-routing"
import { ParkedLeases, type ParkedEntry, taskLeaseKey as leaseKeyOf } from "./parked-leases"

export type { TaskConcurrencyConfig } from "./concurrency-routing"

type Lease = QueuedTaskAdmission

export type ParkedLease = Lease

// Synchronous lease allocator. Model/provider precedence is intentionally unchanged; global
// capacity is independent, so even an unbounded lane consumes one global permit.
export class TaskConcurrency {
  readonly #config: TaskConcurrencyConfig
  readonly #counts = new Map<string, number>()
  readonly #queues = new TaskWaitQueue()
  readonly #leases = new Map<string, Lease>()
  readonly #parked = new ParkedLeases()
  #legacyEpoch = -1
  #granting: Waiter | undefined
  #dispatching = false

  constructor(config: TaskConcurrencyConfig = {}) {
    this.#config = config
  }

  getLimit(model: string): number {
    return getTaskLimit(this.#config, model)
  }

  getKey(model: string): string {
    return getTaskLaneKey(this.#config, model)
  }

  hasFreeSlot(model: string): boolean {
    const laneKey = this.getKey(model)
    return !this.#queues.has(laneKey) && this.#laneHasRoom(model, laneKey) && this.#globalHasRoom()
  }

  tryAcquire(model: string, taskId: string, runEpoch: number): boolean {
    const laneKey = this.getKey(model)
    if (this.leaseState(taskId, runEpoch) !== undefined) return false
    if (this.#queues.has(laneKey) && (this.#granting?.taskId !== taskId || this.#granting.runEpoch !== runEpoch)) return false
    if (!this.#laneHasRoom(model, laneKey) || !this.#globalHasRoom()) return false
    this.#recordLease(model, { laneKey, taskId, runEpoch })
    return true
  }

  // Legacy callers already check hasFreeSlot, except revive accounting which deliberately forces
  // occupancy. A synthetic epoch preserves that behavior until callers adopt tryAcquire.
  acquire(model: string, taskId: string): void {
    this.#recordLease(model, { laneKey: this.getKey(model), taskId, runEpoch: this.#nextLegacyEpoch() })
  }

  enqueue(model: string, taskId: string, grant: () => void): number
  enqueue(model: string, taskId: string, runEpoch: number, grant: () => void): number
  enqueue(
    model: string,
    taskId: string,
    runEpochOrGrant: number | (() => void),
    suppliedGrant?: () => void,
  ): number {
    let runEpoch: number
    let grant: () => void
    if (typeof runEpochOrGrant === "number") {
      if (suppliedGrant === undefined) throw new Error("grant callback is required")
      runEpoch = runEpochOrGrant
      grant = suppliedGrant
    } else {
      runEpoch = this.#nextLegacyEpoch()
      grant = runEpochOrGrant
    }
    const laneKey = this.getKey(model)
    return this.#queues.enqueue({ model, laneKey, taskId, runEpoch, grant })
  }

  queuePosition(model: string, taskId: string): number | undefined {
    return this.#queues.position(this.getKey(model), taskId)
  }

  remove(model: string, taskId: string): boolean {
    return this.#queues.take(this.getKey(model), taskId) !== undefined
  }

  withdraw(model: string, taskId: string, runEpoch: number): QueuedTaskAdmission | undefined {
    return this.#queues.take(this.getKey(model), taskId, runEpoch)
  }

  requeue(admission: QueuedTaskAdmission, grant: () => void): number {
    return this.#queues.enqueue({ ...admission, grant })
  }

  admission(taskId: string, runEpoch: number): (QueuedTaskAdmission & { readonly phase: "pre_grant" | "post_grant" | "parked" }) | undefined {
    const key = leaseKeyOf(taskId, runEpoch)
    const lease = this.#leases.get(key)
    if (lease !== undefined) return { ...lease, phase: "post_grant" }
    for (const lane of this.#parked.values()) {
      const entry = lane.get(key)
      if (entry !== undefined) return { ...entry.lease, phase: "parked" }
    }
    const queued = this.#queues.admission(taskId, runEpoch)
    return queued === undefined ? undefined : { ...queued, phase: "pre_grant" }
  }

  leaseState(taskId: string, runEpoch: number): "held" | "parked" | undefined {
    const key = leaseKeyOf(taskId, runEpoch)
    if (this.#leases.has(key)) return "held"
    for (const lane of this.#parked.values()) if (lane.has(key)) return "parked"
    return undefined
  }

  park(taskId: string, runEpoch: number): ParkedLease | undefined {
    const key = leaseKeyOf(taskId, runEpoch)
    const lease = this.#leases.get(key)
    if (lease === undefined) return undefined
    this.#parked.store(lease)
    this.#dropLease(lease)
    this.#dispatch()
    return lease
  }

  unpark(lease: ParkedLease | undefined, signal?: AbortSignal, options: { readonly overflow?: boolean } = {}): Promise<void> {
    if (lease === undefined) return Promise.resolve()
    const entry = this.#parked.get(lease.laneKey)?.get(leaseKeyOf(lease.taskId, lease.runEpoch))
    // A stale token cannot resurrect a released task or resume a later parking of the same epoch.
    if (entry?.lease !== lease) return Promise.resolve()
    const abort = (): void => this.releaseLease(lease.taskId, lease.runEpoch)
    if (signal?.aborted) {
      abort()
      return Promise.resolve()
    }
    signal?.addEventListener("abort", abort, { once: true })
    entry.resumable = true
    if (options.overflow === true) this.#resume(entry)
    this.#dispatch()
    return entry.resumed.finally(() => signal?.removeEventListener("abort", abort))
  }

  suspendUnpark(lease: ParkedLease): void { this.#parked.suspend(lease) }

  releaseLease(taskId: string, runEpoch: number): void {
    const key = leaseKeyOf(taskId, runEpoch)
    const lease = this.#leases.get(key)
    if (lease !== undefined) this.#dropLease(lease)
    for (const lane of this.#parked.values()) {
      const entry = lane.get(key)
      if (entry !== undefined) this.#parked.remove(entry)
    }
    this.#dispatch()
  }

  // Re-key a held lease to the task's next run epoch without freeing its slot: a re-dispatch keeps
  // the lane occupancy its abandoned run held, so no queued waiter can take the slot in between.
  transferLease(taskId: string, fromEpoch: number, toEpoch: number): boolean {
    const lease = this.#leases.get(leaseKeyOf(taskId, fromEpoch))
    if (lease === undefined || this.leaseState(taskId, toEpoch) !== undefined) return false
    this.#leases.delete(leaseKeyOf(taskId, fromEpoch))
    this.#leases.set(leaseKeyOf(taskId, toEpoch), { ...lease, runEpoch: toEpoch })
    return true
  }

  // Every lease a task holds or has parked, at any epoch: a task that can never run again (cancelled)
  // owns no lane slot, whichever run took it (omo#9403).
  releaseTask(taskId: string): void {
    const owned = [...this.#leases.values()].filter((lease) => lease.taskId === taskId)
    for (const lease of owned) this.#dropLease(lease)
    for (const lane of [...this.#parked.values()]) {
      for (const entry of [...lane.values()]) if (entry.lease.taskId === taskId) this.#parked.remove(entry)
    }
    this.#dispatch()
  }

  #resume(entry: ParkedEntry): void {
    this.#recordLease(entry.lease.model, entry.lease)
    this.#parked.remove(entry)
  }

  release(model: string): void {
    const laneKey = this.getKey(model)
    const lease = this.#leases.values().find((candidate) => candidate.laneKey === laneKey)
      ?? this.#parked.get(laneKey)?.values().next().value?.lease
    if (lease !== undefined) this.releaseLease(lease.taskId, lease.runEpoch)
  }

  getCount(model: string): number {
    return this.#counts.get(this.getKey(model)) ?? 0
  }

  getRetainedKeyCounts(): { readonly lanes: number; readonly queues: number; readonly leases: number } {
    return { lanes: this.#counts.size, queues: this.#queues.size, leases: this.#leases.size }
  }

  // Workpool pushes schedule this only after returning their durable item IDs.
  drain(): void { this.#dispatch() }

  #dispatch(): void {
    if (this.#dispatching) return
    this.#dispatching = true
    try { this.#drainEligible() } finally { this.#dispatching = false }
  }

  #drainEligible(): void {
    for (;;) {
      if (!this.#globalHasRoom()) return
      // Existing owners resume before queue heads, without putting dormant parents in the FIFO.
      let resumable: ParkedEntry | undefined
      for (const [laneKey, lane] of this.#parked) {
        resumable = lane.values().find((entry) => entry.resumable && this.#laneHasRoom(entry.lease.model, laneKey))
        if (resumable !== undefined) break
      }
      if (resumable !== undefined) {
        this.#resume(resumable)
        continue
      }
      let selected: Waiter | undefined
      for (const [laneKey, queue] of this.#queues) {
        const head = queue[0]
        if (head === undefined) {
          this.#queues.delete(laneKey)
          continue
        }
        if (!this.#laneHasRoom(head.model, laneKey)) continue
        if (selected === undefined || head.sequence < selected.sequence) selected = head
      }
      if (selected === undefined) return
      const queue = this.#queues.get(selected.laneKey)
      if (queue === undefined) continue
      this.#granting = selected
      let acquired: boolean
      try { acquired = this.tryAcquire(selected.model, selected.taskId, selected.runEpoch) }
      finally { this.#granting = undefined }
      // An advisory capacity observation is not a lease. Leave this waiter in place exactly
      // once when the atomic acquisition loses; a release will drain it, never a retry loop.
      if (!acquired) return
      queue.shift()
      if (queue.length === 0) this.#queues.delete(selected.laneKey)
      selected.grant()
    }
  }

  #recordLease(model: string, lease: Omit<Lease, "model" | "sequence"> & { readonly sequence?: number }): void {
    const sequence = lease.sequence ?? this.#granting?.sequence ?? this.#queues.reserveSequence()
    this.#leases.set(leaseKeyOf(lease.taskId, lease.runEpoch), { ...lease, model, sequence })
    if (this.getLimit(model) === Number.POSITIVE_INFINITY) return
    this.#counts.set(lease.laneKey, (this.#counts.get(lease.laneKey) ?? 0) + 1)
  }

  #dropLease(lease: Lease): void {
    this.#leases.delete(leaseKeyOf(lease.taskId, lease.runEpoch))
    const count = this.#counts.get(lease.laneKey) ?? 0
    if (count <= 1) this.#counts.delete(lease.laneKey)
    else this.#counts.set(lease.laneKey, count - 1)
  }

  #laneHasRoom(model: string, laneKey: string): boolean {
    return (this.#counts.get(laneKey) ?? 0) < this.getLimit(model)
  }

  #globalHasRoom(): boolean {
    const configured = this.#config.global_concurrency
    const limit = configured === undefined || configured === 0 ? Number.POSITIVE_INFINITY : configured
    return this.#leases.size < limit
  }

  #nextLegacyEpoch(): number {
    const epoch = this.#legacyEpoch
    this.#legacyEpoch -= 1
    return epoch
  }
}
