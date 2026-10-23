/**
 * The retry pause; its timer is unref'd so a pending retry never keeps the host process alive, and
 * it removes its abort listener when it ends normally, so a long outage does not pile listeners up on
 * the sender's long-lived signal.
 */
export function abortableSleep(ms: number, abort: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      abort.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    timer.unref?.()
    abort.addEventListener("abort", onAbort, { once: true })
  })
}

export function delay(ms: number): { readonly elapsed: Promise<void>; readonly cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  return { elapsed, cancel: () => clearTimeout(timer) }
}
