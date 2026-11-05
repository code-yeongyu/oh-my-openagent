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
 * Awaits `event` for at most the current test's remaining budget, then rejects naming `what`.
 * Use it instead of racing an event against a fixed stopwatch: a fixed 2-10 s bound fires on a stalled
 * runner although the event still arrives (#10814), while the test's own timeout is still far away.
 */
export async function awaitWithinTestBudget<T>(event: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      event,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`waited out the test budget for ${what}`)), remainingTestTime())
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** An abort signal for an awaited event that fires when the current test's remaining budget runs out. */
export function testBudgetSignal(): AbortSignal {
  return AbortSignal.timeout(remainingTestTime())
}
