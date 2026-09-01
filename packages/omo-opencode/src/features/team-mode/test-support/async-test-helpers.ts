import type { BackgroundTask, LaunchInput } from "../../background-agent/types"

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
  readonly releaseAndWaitForCompletion: <T>(promise: Promise<T>) => Promise<T>
  readonly snapshot: () => LaunchConcurrencySnapshot
  readonly waitForFirstBatch: () => Promise<LaunchConcurrencySnapshot>
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

// The waits below resolve on the real launch callbacks (firstBatchStarted / releaseLaunches),
// so they are awaited directly with no wall-clock timer guarding them. A fixed intra-helper
// deadline used to race those events and lost to slow Windows CI scheduling, which flaked the
// concurrency tests; a genuine launch deadlock is now caught by the per-test timeout instead.
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
    async releaseAndWaitForCompletion<T>(promise: Promise<T>): Promise<T> {
      release()
      return await promise
    },
    snapshot,
    async waitForFirstBatch(): Promise<LaunchConcurrencySnapshot> {
      await firstBatchStarted.promise
      return snapshot()
    },
  }
}
