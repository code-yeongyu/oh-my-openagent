// Hard ceiling on how long an SDK `session.messages` call inside the
// `background_output` tool is allowed to block. Without it, a stuck OpenCode
// RPC (observed when `session.processor` enters an "Aborted process" loop)
// would leave `formatTaskResult` / `formatFullSession` pending forever and
// the `background_output` tool call would never return. During `/init-deep`
// (and other heavy slash commands) the parent agent fires many child tasks
// and calls `background_output` for each, so even one hung fetch wedges the
// whole command.
export const DEFAULT_BACKGROUND_OUTPUT_FETCH_TIMEOUT_MS = 5_000

let backgroundOutputFetchTimeoutMsForTesting: number | undefined

export function _setBackgroundOutputFetchTimeoutMsForTesting(value: number | undefined): void {
  backgroundOutputFetchTimeoutMsForTesting = value
}

export function getBackgroundOutputFetchTimeoutMs(): number {
  return backgroundOutputFetchTimeoutMsForTesting ?? DEFAULT_BACKGROUND_OUTPUT_FETCH_TIMEOUT_MS
}

export class BackgroundOutputFetchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`[background-output] session.messages timed out after ${timeoutMs}ms`)
    this.name = "BackgroundOutputFetchTimeoutError"
  }
}

export function withSdkCallTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return operation
  }
  let timeoutID: ReturnType<typeof globalThis.setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutID = globalThis.setTimeout(
      () => reject(new BackgroundOutputFetchTimeoutError(timeoutMs)),
      timeoutMs,
    )
  })
  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeoutID !== undefined) clearTimeout(timeoutID)
  })
}
