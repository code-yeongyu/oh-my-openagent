import type { BackgroundTask, LaunchInput } from "../../background-agent/types"

const DEFAULT_LAUNCH_PROBE_TIMEOUT_MS = 5_000

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
}

export type LaunchConcurrencySnapshot = {
  readonly launchCount: number
  readonly inFlight: number
  readonly maxInFlight: number
}

export type LaunchConcurrencyProbe = {
  readonly launch: (input: LaunchInput) => Promise<BackgroundTask>
  readonly release: () => void
  readonly releaseAndWaitForCompletion: <T>(promise: Promise<T>, message: string, timeoutMs?: number) => Promise<T>
  readonly snapshot: () => LaunchConcurrencySnapshot
  readonly waitForFirstBatch: (message: string, timeoutMs?: number) => Promise<LaunchConcurrencySnapshot>
}

export type LaunchConcurrencyProbeOptions = {
  readonly launchLimit: number
  readonly sessionIdPrefix: string
  readonly taskIdPrefix: string
}

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: Deferred<T>["resolve"] | undefined
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve
  })
  if (!resolveDeferred) throw new Error("deferred resolver was not initialized")
  return { promise, resolve: resolveDeferred }
}

async function withCircuitBreaker<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function createLaunchConcurrencyProbe(options: LaunchConcurrencyProbeOptions): LaunchConcurrencyProbe {
  const firstBatchStarted = createDeferred<void>()
  const releaseLaunches = createDeferred<void>()
  let inFlight = 0
  let launchCount = 0
  let maxInFlight = 0

  const snapshot = (): LaunchConcurrencySnapshot => ({ launchCount, inFlight, maxInFlight })
  const release = (): void => {
    releaseLaunches.resolve(undefined)
  }

  return {
    async launch(input: LaunchInput): Promise<BackgroundTask> {
      const launchId = launchCount + 1
      launchCount = launchId
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (launchId === options.launchLimit) firstBatchStarted.resolve(undefined)
      await releaseLaunches.promise
      inFlight -= 1
      return {
        agent: input.agent,
        description: input.description,
        id: `${options.taskIdPrefix}-${launchId}`,
        parentMessageId: input.parentMessageId,
        parentSessionId: input.parentSessionId,
        prompt: input.prompt,
        sessionId: `${options.sessionIdPrefix}-${launchId}`,
        status: "running",
      } satisfies BackgroundTask
    },
    release,
    async releaseAndWaitForCompletion<T>(promise: Promise<T>, message: string, timeoutMs = DEFAULT_LAUNCH_PROBE_TIMEOUT_MS): Promise<T> {
      release()
      return await withCircuitBreaker(promise, timeoutMs, message)
    },
    snapshot,
    async waitForFirstBatch(message: string, timeoutMs = DEFAULT_LAUNCH_PROBE_TIMEOUT_MS): Promise<LaunchConcurrencySnapshot> {
      await withCircuitBreaker(firstBatchStarted.promise, timeoutMs, message)
      return snapshot()
    },
  }
}
