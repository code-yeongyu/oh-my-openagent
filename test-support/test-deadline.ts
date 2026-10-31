export const DEFAULT_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 20_000

let startedAt = performance.now()

export function resetTestDeadline(): void {
  startedAt = performance.now()
}

/** Leave the final tenth of the test budget for a named failure and fixture teardown. */
export function remainingTestTime(timeoutMs = DEFAULT_TEST_TIMEOUT_MS): number {
  return Math.max(0, timeoutMs * 0.9 - (performance.now() - startedAt))
}
