/** Waits `ms`, or rejects with the signal's reason once it aborts (the call's timeout, abort, or end). */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const onAbort = () => {
    clearTimeout(timer)
    reject(signal.reason)
  }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort)
    resolve()
  }, ms)
  signal.addEventListener("abort", onAbort, { once: true })
  return promise
}
