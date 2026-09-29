/**
 * The one failure a store operation gives up with when another process keeps the write lock past
 * `GATEWAY_LOCK_WAIT_MAX_MS`. It crosses the worker boundary as `code`, so the callers that must
 * not give up for good (the inbox drain, a completion write, an answer release) recognise it and
 * re-arm one retry after `busy_timeout` instead of holding the worker queue.
 */
export const LOCK_WAIT_EXCEEDED_CODE = "gateway_lock_wait_exceeded"

export function lockWaitExceeded(op: string, waitedMs: number, limitMs: number): Error & { readonly code: string } {
  return Object.assign(new Error(`gateway store lock wait exceeded: ${op} waited ${waitedMs} ms for the write lock (limit ${limitMs} ms); another process holds it`), { code: LOCK_WAIT_EXCEEDED_CODE })
}

export function isLockWaitExceeded(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === LOCK_WAIT_EXCEEDED_CODE
}

/**
 * Runs `attempt` again after `delayMs` for as long as it fails with a lock-wait error, one timer at
 * a time; any other failure ends the retries and goes to `onFailure`. Nothing waits on it.
 */
export function retryAfterLockWait(attempt: () => Promise<unknown>, delayMs: () => number, onFailure: (error: unknown) => void): void {
  const timer = setTimeout(() => {
    attempt().catch((error: unknown) => {
      if (isLockWaitExceeded(error)) retryAfterLockWait(attempt, delayMs, onFailure)
      else onFailure(error)
    })
  }, delayMs())
  timer.unref?.()
}
