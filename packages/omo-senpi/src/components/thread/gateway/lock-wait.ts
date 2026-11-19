/**
 * The one failure a store operation gives up with when another process keeps the write lock past
 * `GATEWAY_LOCK_WAIT_MAX_MS`. It crosses the worker boundary as `code`, so the caller that must
 * not give up for good (the inbox drain) recognises it and re-arms one retry after `busy_timeout`
 * instead of holding the worker queue.
 */
export const LOCK_WAIT_EXCEEDED_CODE = "gateway_lock_wait_exceeded"

export function lockWaitExceeded(op: string, waitedMs: number, limitMs: number): Error & { readonly code: string } {
  return Object.assign(
    new Error(
      `gateway store lock wait exceeded: ${op} waited ${waitedMs} ms for the write lock (limit ${limitMs} ms); another process holds it`,
    ),
    { code: LOCK_WAIT_EXCEEDED_CODE },
  )
}

export function isLockWaitExceeded(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly code?: unknown }).code === LOCK_WAIT_EXCEEDED_CODE
  )
}
