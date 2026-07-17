export type TaskConcurrencyConfig = {
  readonly default_concurrency?: number
  readonly provider_concurrency?: Readonly<Record<string, number>>
  readonly model_concurrency?: Readonly<Record<string, number>>
}

type Waiter = {
  readonly taskId: string
  grant: () => void
  settled: boolean
}

const DEFAULT_LIMIT = 5

// Port of omo's background-agent ConcurrencyManager (FIFO keying + defaults), adapted to a
// synchronous callback grant so the manager can decide running-vs-pending at start() time.
// Key precedence: explicit model override > provider override > model string. A 0 limit means
// unbounded (kept for parity though the omo.json schema forbids it).
export class TaskConcurrency {
  readonly #config: TaskConcurrencyConfig
  readonly #counts = new Map<string, number>()
  readonly #queues = new Map<string, Waiter[]>()

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
    const limit = this.getLimit(model)
    if (limit === Number.POSITIVE_INFINITY) return true
    return (this.#counts.get(this.getKey(model)) ?? 0) < limit
  }

  acquire(model: string, _taskId: string): void {
    const key = this.getKey(model)
    if (this.getLimit(model) === Number.POSITIVE_INFINITY) return
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1)
  }

  enqueue(model: string, taskId: string, grant: () => void): number {
    const key = this.getKey(model)
    const queue = this.#queues.get(key) ?? []
    queue.push({ taskId, grant, settled: false })
    this.#queues.set(key, queue)
    return queue.length
  }

  queuePosition(model: string, taskId: string): number | undefined {
    const queue = this.#queues.get(this.getKey(model))
    if (queue === undefined) return undefined
    const index = queue.findIndex((waiter) => waiter.taskId === taskId && !waiter.settled)
    return index === -1 ? undefined : index + 1
  }

  // Dequeue a queued (unsettled) waiter by task id. SPLICES it out of the array rather than
  // merely marking it settled: queuePosition and release() walk the raw array, so a
  // settled-but-present entry would inflate every later waiter's position. A queued task
  // never acquired a slot, so #counts stays untouched. Returns false when no unsettled
  // waiter for (model, taskId) exists. Compatible with release() because release() already
  // skips settled entries while shifting the head.
  remove(model: string, taskId: string): boolean {
    const queue = this.#queues.get(this.getKey(model))
    if (queue === undefined) return false
    const index = queue.findIndex((waiter) => waiter.taskId === taskId && !waiter.settled)
    if (index === -1) return false
    queue.splice(index, 1)
    return true
  }

  release(model: string): void {
    const key = this.getKey(model)
    const queue = this.#queues.get(key)
    while (queue && queue.length > 0) {
      const next = queue.shift()
      if (next === undefined) continue
      if (!next.settled) {
        next.settled = true
        next.grant()
        return
      }
    }
    const current = this.#counts.get(key) ?? 0
    if (current > 0) this.#counts.set(key, current - 1)
  }

  getCount(model: string): number {
    return this.#counts.get(this.getKey(model)) ?? 0
  }
}

function providerOf(model: string): string {
  return model.split("/")[0] ?? model
}

function ownNumber(record: Readonly<Record<string, number>> | undefined, key: string): number | undefined {
  if (record === undefined || !Object.hasOwn(record, key)) return undefined
  return record[key]
}
