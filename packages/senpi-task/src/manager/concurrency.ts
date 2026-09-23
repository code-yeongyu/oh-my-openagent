export type TaskConcurrencyConfig = {
  readonly default_concurrency?: number
  readonly provider_concurrency?: Readonly<Record<string, number>>
  readonly model_concurrency?: Readonly<Record<string, number>>
  readonly global_concurrency?: number
}

type Waiter = {
  readonly model: string
  readonly laneKey: string
  readonly taskId: string
  readonly runEpoch: number
  readonly sequence: number
  readonly grant: () => void
}

type Lease = {
  readonly model: string
  readonly laneKey: string
  readonly taskId: string
  readonly runEpoch: number
}

export type ParkedLease = Lease

type ParkedEntry = {
  readonly lease: ParkedLease
  readonly resumed: Promise<void>
  readonly resolve: () => void
  resumable: boolean
}

const DEFAULT_LIMIT = 5

// Synchronous lease allocator. Model/provider precedence is intentionally unchanged; global
// capacity is independent, so even an unbounded lane consumes one global permit.
export class TaskConcurrency {
  readonly #config: TaskConcurrencyConfig
  readonly #counts = new Map<string, number>()
  readonly #queues = new Map<string, Waiter[]>()
  readonly #leases = new Map<string, Lease>()
  readonly #parked = new Map<string, Map<string, ParkedEntry>>()
  #enqueueSequence = 0
  #legacyEpoch = -1
  #granting: Waiter | undefined
  #dispatching = false

  constructor(config: TaskConcurrencyConfig = {}) {
    this.#config = config
  }

  getLimit(model: string): number {
    const modelLimit = ownNumber(this.#config.model_concurrency, model)
    if (modelLimit !== undefined) return modelLimit === 0 ? Number.POSITIVE_INFINITY : modelLimit
    const providerLimit = ownNumber(this.#config.provider_concurrency, providerOf(model))
    if (providerLimit !== undefined) return providerLimit === 0 ? Number.POSITIVE_INFINITY : providerLimit
    const defaultLimit = this.#config.default_concurrency
    if (defaultLimit !== undefined) return defaultLimit === 0 ? Number.POSITIVE_INFINITY : defaultLimit
    return DEFAULT_LIMIT
  }

  getKey(model: string): string {
    if (ownNumber(this.#config.model_concurrency, model) !== undefined) return model
    const provider = providerOf(model)
    if (ownNumber(this.#config.provider_concurrency, provider) !== undefined) return provider
    return model
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
    const queue = this.#queues.get(laneKey) ?? []
    queue.push({ model, laneKey, taskId, runEpoch, sequence: this.#enqueueSequence, grant })
    this.#enqueueSequence += 1
    this.#queues.set(laneKey, queue)
    return queue.length
  }

  queuePosition(model: string, taskId: string): number | undefined {
    const queue = this.#queues.get(this.getKey(model))
    if (queue === undefined) return undefined
    const index = queue.findIndex((waiter) => waiter.taskId === taskId)
    return index === -1 ? undefined : index + 1
  }

  remove(model: string, taskId: string): boolean {
    const laneKey = this.getKey(model)
    const queue = this.#queues.get(laneKey)
    if (queue === undefined) return false
    const index = queue.findIndex((waiter) => waiter.taskId === taskId)
    if (index === -1) return false
    queue.splice(index, 1)
    if (queue.length === 0) this.#queues.delete(laneKey)
    return true
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
    const { promise, resolve } = Promise.withResolvers<void>()
    const lane = this.#parked.get(lease.laneKey) ?? new Map<string, ParkedEntry>()
    lane.set(key, { lease, resumed: promise, resolve, resumable: false })
    this.#parked.set(lease.laneKey, lane)
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

  releaseLease(taskId: string, runEpoch: number): void {
    const key = leaseKeyOf(taskId, runEpoch)
    const lease = this.#leases.get(key)
    if (lease !== undefined) this.#dropLease(lease)
    for (const lane of this.#parked.values()) {
      const entry = lane.get(key)
      if (entry !== undefined) this.#dropParked(entry)
    }
    this.#dispatch()
  }

  #dropParked(entry: ParkedEntry): void {
    const lane = this.#parked.get(entry.lease.laneKey)
    lane?.delete(leaseKeyOf(entry.lease.taskId, entry.lease.runEpoch))
    if (lane?.size === 0) this.#parked.delete(entry.lease.laneKey)
    entry.resolve()
  }

  #resume(entry: ParkedEntry): void {
    this.#recordLease(entry.lease.model, entry.lease)
    this.#dropParked(entry)
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

  #recordLease(model: string, lease: Omit<Lease, "model">): void {
    this.#leases.set(leaseKeyOf(lease.taskId, lease.runEpoch), { ...lease, model })
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

function leaseKeyOf(taskId: string, runEpoch: number): string {
  return `${taskId.length}:${taskId}:${runEpoch}`
}

function providerOf(model: string): string {
  return model.split("/")[0] ?? model
}

function ownNumber(record: Readonly<Record<string, number>> | undefined, key: string): number | undefined {
  if (record === undefined || !Object.hasOwn(record, key)) return undefined
  return record[key]
}
