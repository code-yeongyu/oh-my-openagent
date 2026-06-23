export interface AsyncEventResult {
  event_id: string
  status: "PENDING" | "DONE" | "FAILED"
  memory_id?: string
  error?: string
}

export interface AsyncHandlerConfig {
  pollIntervalMs: number
  maxPollAttempts: number
  skipPollForBestEffort: boolean
}

export const DEFAULT_ASYNC_CONFIG: AsyncHandlerConfig = {
  pollIntervalMs: 500,
  maxPollAttempts: 20,
  skipPollForBestEffort: true,
}

export class AsyncHandlerTimeoutError extends Error {
  constructor(event_id: string, attempts: number) {
    super(`Async event ${event_id} did not complete after ${attempts} poll attempts`)
    this.name = "AsyncHandlerTimeoutError"
  }
}

export interface AsyncHandlerDeps {
  getEvent(event_id: string): Promise<AsyncEventResult>
}

export class Mem0AsyncEventHandler {
  private readonly config: AsyncHandlerConfig

  constructor(
    private readonly deps: AsyncHandlerDeps,
    config: Partial<AsyncHandlerConfig> = {},
  ) {
    this.config = { ...DEFAULT_ASYNC_CONFIG, ...config }
  }

  async waitForCompletion(event_id: string, needsMemoryId = false): Promise<string | undefined> {
    if (this.config.skipPollForBestEffort && !needsMemoryId) {
      return event_id
    }

    let attempts = 0

    while (attempts < this.config.maxPollAttempts) {
      attempts++
      const result = await this.deps.getEvent(event_id)

      if (result.status === "DONE") {
        return result.memory_id ?? event_id
      }

      if (result.status === "FAILED") {
        throw new Error(`Async Mem0 event ${event_id} failed: ${result.error}`)
      }

      await new Promise<void>(resolve => setTimeout(resolve, this.config.pollIntervalMs))
    }

    throw new AsyncHandlerTimeoutError(event_id, attempts)
  }
}
