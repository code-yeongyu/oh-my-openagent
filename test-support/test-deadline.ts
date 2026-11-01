export const DEFAULT_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 20_000

let startedAt = performance.now()

export function resetTestDeadline(): void {
  startedAt = performance.now()
}

/** Leave the final tenth of the test budget for a named failure and fixture teardown. */
export function remainingTestTime(timeoutMs = DEFAULT_TEST_TIMEOUT_MS): number {
  return Math.max(0, timeoutMs * 0.9 - (performance.now() - startedAt))
}

/**
 * A circuit breaker for one awaited signal, never a pacing step: it shares the test's whole remaining budget
 * (`timeoutMs` is the test's own timeout), so a slow runner is never failed by a shorter per-step guard (#11257).
 */
export async function withinTestBudget<T>(work: Promise<T>, failure: string, timeoutMs = DEFAULT_TEST_TIMEOUT_MS): Promise<T> {
  const remainingMs = remainingTestTime(timeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${failure} (remaining test budget ${Math.round(remainingMs)} ms)`)), remainingMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
