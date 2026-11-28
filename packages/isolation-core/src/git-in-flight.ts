const inFlight = new Set<Promise<unknown>>()

/**
 * Tracks a git child the fixture started so the fixture's own teardown can await it: a test that is
 * abandoned (timeout, throw) while a git child runs otherwise leaves the child's rejection to be
 * reported between tests and charged to the next one (#9988).
 */
export function trackGitCall<T>(run: Promise<T>): Promise<T> {
  inFlight.add(run)
  run.then(
    () => inFlight.delete(run),
    () => inFlight.delete(run),
  )
  return run
}

export async function settleInFlightGit(): Promise<void> {
  await Promise.allSettled([...inFlight])
}
