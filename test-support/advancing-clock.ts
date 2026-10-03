/**
 * Shared test helper: a deterministic advancing clock used by the
 * delegate-task poller tests to drive pollSyncSession's injected `now`/`wait`
 * seams without touching the real clock (and without mutating global
 * Date.now, which races across files).
 */
export type TestClock = {
  readonly now: () => number
  readonly wait: (milliseconds: number) => Promise<void>
}

/**
 * Runs `run` with a clock that advances `stepMs` on every `now()` call and a
 * no-op `wait`, so a poll loop's time-based decisions (stall window, inactivity
 * timeout) execute deterministically.
 */
export async function withAdvancingClock(
  stepMs: number,
  run: (clock: TestClock) => Promise<void>,
): Promise<void> {
  let currentTime = 0
  const now = () => {
    const current = currentTime
    currentTime += stepMs
    return current
  }
  await run({ now, wait: async () => {} })
}
