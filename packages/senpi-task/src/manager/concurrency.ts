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
  readonly laneKey: string
  readonly taskId: string
  readonly runEpoch: number
}

const DEFAULT_LIMIT = 5

// Synchronous lease allocator. Model/provider precedence is intentionally unchanged; global
// capacity is independent, so even an unbounded lane consumes one global permit.
export class TaskConcurrency {
  readonly #config: TaskConcurrencyConfig
  readonly #counts = new Map<string, number>()
  readonly #queues = new Map<string, Waiter[]>()
  readonly #leases = new Map<string, Lease>()
  #enqueueSequence = 0
  #legacyEpoch = -1

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
    const leaseKey = leaseKeyOf(taskId, runEpoch)
    if (this.#leases.has(leaseKey)) return false
    if (this.#queues.has(laneKey)) return false
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

  releaseLease(taskId: string, runEpoch: number): void {
    const lease = this.#leases.get(leaseKeyOf(taskId, runEpoch))
    if (lease === undefined) return
    this.#dropLease(lease)
    this.#dispatch()
  }

  release(model: string): void {
    const laneKey = this.getKey(model)
    const lease = this.#leases.values().find((candidate) => candidate.laneKey === laneKey)
    if (lease === undefined) return
    this.#dropLease(lease)
    this.#dispatch()
  }

  getCount(model: string): number {
    return this.#counts.get(this.getKey(model)) ?? 0
  }

  getRetainedKeyCounts(): { readonly lanes: number; readonly queues: number; readonly leases: number } {
    return { lanes: this.#counts.size, queues: this.#queues.size, leases: this.#leases.size }
  }

  #dispatch(): void {
    for (;;) {
      if (!this.#globalHasRoom()) return
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
      queue.shift()
      if (queue.length === 0) this.#queues.delete(selected.laneKey)
      this.#recordLease(selected.model, selected)
      selected.grant()
    }
  }

  #recordLease(model: string, lease: Lease): void {
    this.#leases.set(leaseKeyOf(lease.taskId, lease.runEpoch), lease)
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
