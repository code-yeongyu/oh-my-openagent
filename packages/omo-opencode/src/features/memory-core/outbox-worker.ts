import type { OutboxEntry } from "./types"

export interface OutboxDispatcher {
  dispatch(entry: OutboxEntry): Promise<void>
}

export interface OutboxWorkerConfig {
  pollIntervalMs: number
  maxRetries: number
  backoffMultiplier: number
  batchSize: number
  circuitBreakerThreshold: number
  circuitBreakerResetMs: number
}

export const DEFAULT_OUTBOX_WORKER_CONFIG: OutboxWorkerConfig = {
  pollIntervalMs: 5000,
  maxRetries: 3,
  backoffMultiplier: 2,
  batchSize: 10,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
}

type CircuitBreakerState = "closed" | "open" | "half-open"

export interface OutboxWorkerState {
  isRunning: boolean
  consecutiveFailures: number
  circuitBreaker: CircuitBreakerState
  circuitOpenedAt?: number
  totalProcessed: number
  totalFailed: number
  lastPollAt?: number
}

export interface OutboxWorkerDeps {
  fetchPending(limit: number): Promise<OutboxEntry[]>
  claimEntry(outbox_id: string): Promise<boolean>
  markSynced(outbox_id: string): Promise<void>
  markFailed(outbox_id: string, error: string, shouldRetry: boolean): Promise<void>
  incrementRetry(outbox_id: string): Promise<number>
  dispatch: OutboxDispatcher
}

export class OutboxWorker {
  private readonly config: OutboxWorkerConfig
  private state: OutboxWorkerState
  private pollTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly deps: OutboxWorkerDeps,
    config: Partial<OutboxWorkerConfig> = {},
  ) {
    this.config = { ...DEFAULT_OUTBOX_WORKER_CONFIG, ...config }
    this.state = {
      isRunning: false,
      consecutiveFailures: 0,
      circuitBreaker: "closed",
      totalProcessed: 0,
      totalFailed: 0,
    }
  }

  start(): void {
    if (this.state.isRunning) return
    this.state.isRunning = true
    this.schedulePoll()
  }

  stop(): void {
    this.state.isRunning = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  getState(): Readonly<OutboxWorkerState> {
    return { ...this.state }
  }

  private schedulePoll(): void {
    if (!this.state.isRunning) return
    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll()
      } catch {
        this.recordFailure()
      }
      if (this.state.isRunning) this.schedulePoll()
    }, this.config.pollIntervalMs)
  }

  async poll(): Promise<void> {
    this.state.lastPollAt = Date.now()

    if (this.state.circuitBreaker === "open") {
      const elapsed = Date.now() - (this.state.circuitOpenedAt ?? 0)
      if (elapsed < this.config.circuitBreakerResetMs) return
      this.state.circuitBreaker = "half-open"
    }

    let entries: OutboxEntry[]
    try {
      entries = await this.deps.fetchPending(this.config.batchSize)
    } catch {
      this.recordFailure()
      return
    }

    for (const entry of entries) {
      await this.processEntry(entry)
    }

    if (entries.length === 0 || this.state.circuitBreaker === "half-open") {
      this.state.consecutiveFailures = 0
      this.state.circuitBreaker = "closed"
    }
  }

  private async processEntry(entry: OutboxEntry): Promise<void> {
    const claimed = await this.tryClaim(entry.outbox_id)
    if (!claimed) return

    try {
      await this.deps.dispatch.dispatch(entry)
      await this.deps.markSynced(entry.outbox_id)
      this.state.totalProcessed++
      this.state.consecutiveFailures = 0
    } catch (err) {
      await this.handleDispatchFailure(entry, err)
    }
  }

  private async tryClaim(outbox_id: string): Promise<boolean> {
    try {
      return await this.deps.claimEntry(outbox_id)
    } catch {
      return false
    }
  }

  private async handleDispatchFailure(entry: OutboxEntry, err: unknown): Promise<void> {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const retryCount = await this.safeIncrementRetry(entry)
    const shouldRetry = retryCount < this.config.maxRetries
    await this.safeMarkFailed(entry.outbox_id, errorMsg, shouldRetry)
    this.state.totalFailed++
    this.recordFailure()
  }

  private async safeIncrementRetry(entry: OutboxEntry): Promise<number> {
    try {
      return await this.deps.incrementRetry(entry.outbox_id)
    } catch {
      return entry.retry_count + 1
    }
  }

  private async safeMarkFailed(
    outbox_id: string,
    error: string,
    shouldRetry: boolean,
  ): Promise<void> {
    try {
      await this.deps.markFailed(outbox_id, error, shouldRetry)
    } catch {
      this.state.consecutiveFailures++
    }
  }

  private recordFailure(): void {
    this.state.consecutiveFailures++
    if (
      this.state.consecutiveFailures >= this.config.circuitBreakerThreshold &&
      this.state.circuitBreaker === "closed"
    ) {
      this.state.circuitBreaker = "open"
      this.state.circuitOpenedAt = Date.now()
    }
  }
}
