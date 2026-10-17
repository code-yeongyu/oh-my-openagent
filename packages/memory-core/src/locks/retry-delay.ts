/** Upper bound on one pause between lock polls, however long the wait has run. */
export const LOCK_RETRY_MAX_DELAY_MS = 250

/**
 * The pause before poll `attempt` (0-based): exponential from `baseMs`, capped at
 * {@link LOCK_RETRY_MAX_DELAY_MS}, with jitter over the upper half of that ceiling so contenders that
 * started together spread out instead of polling in lockstep.
 */
export function lockRetryDelayMs(attempt: number, baseMs: number, random: () => number = Math.random): number {
  const ceiling = Math.min(LOCK_RETRY_MAX_DELAY_MS, baseMs * 2 ** Math.min(attempt, 30))
  return Math.max(1, Math.round(ceiling / 2 + (random() * ceiling) / 2))
}

/** Resolves after `milliseconds`, or rejects with the signal's reason the moment it aborts. */
export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds)
    const onAbort = () => finish(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    signal?.addEventListener("abort", onAbort, { once: true })
    function finish(error?: unknown) {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      error === undefined ? resolve() : reject(error)
    }
  })
}
