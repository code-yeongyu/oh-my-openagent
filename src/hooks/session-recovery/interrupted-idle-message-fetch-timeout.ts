export const DEFAULT_INTERRUPTED_IDLE_MESSAGES_FETCH_TIMEOUT_MS = 5_000

let interruptedIdleMessagesFetchTimeoutMsForTesting: number | undefined

export function _setInterruptedIdleMessagesFetchTimeoutMsForTesting(value: number | undefined): void {
  interruptedIdleMessagesFetchTimeoutMsForTesting = value
}

export function getInterruptedIdleMessagesFetchTimeoutMs(): number {
  return interruptedIdleMessagesFetchTimeoutMsForTesting ?? DEFAULT_INTERRUPTED_IDLE_MESSAGES_FETCH_TIMEOUT_MS
}

export class InterruptedIdleMessagesFetchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`[session-recovery] session.messages timed out after ${timeoutMs}ms while checking interrupted idle tools`)
    this.name = "InterruptedIdleMessagesFetchTimeoutError"
  }
}

export function withInterruptedIdleMessagesFetchTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return operation
  }

  let timeoutID: ReturnType<typeof globalThis.setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutID = globalThis.setTimeout(
      () => reject(new InterruptedIdleMessagesFetchTimeoutError(timeoutMs)),
      timeoutMs,
    )
  })

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeoutID !== undefined) {
      globalThis.clearTimeout(timeoutID)
    }
  })
}
