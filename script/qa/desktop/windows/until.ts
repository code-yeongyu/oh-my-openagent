// Bounded waits for the Windows desktop QA driver: every wait ends on the awaited signal or on the
// hang guard, never on a fixed sleep.
export const HANG_GUARD_MS = 30_000

export async function hangGuard<T>(promise: Promise<T>, onTimeout: () => T, ms = HANG_GUARD_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms)
  })
  try {
    return await Promise.race([promise, expired])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Re-runs `probe` until `settled` holds or the hang guard expires, and returns the last probe. Each
 * probe is a real round trip (an engine RPC or an observer process) that paces the loop, so no sleep
 * sits between probes.
 */
export async function probeUntil<T>(probe: () => Promise<T>, settled: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + HANG_GUARD_MS
  let value = await probe()
  while (!settled(value) && Date.now() < deadline) value = await probe()
  return value
}
