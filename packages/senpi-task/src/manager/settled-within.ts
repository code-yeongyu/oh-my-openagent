export type SettledWithin<T> =
  | { readonly settled: true; readonly value: T }
  | { readonly settled: false; readonly cause: "elapsed" | "aborted" }

/** Stops waiting after `windowMs` or on abort; `work` itself keeps running (#10042). */
export async function settledWithin<T>(work: Promise<T>, windowMs: number, signal?: AbortSignal): Promise<SettledWithin<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<SettledWithin<T>>((resolve) => {
    if (Number.isFinite(windowMs)) timer = setTimeout(() => resolve({ settled: false, cause: "elapsed" }), windowMs)
    if (signal === undefined) return
    onAbort = () => resolve({ settled: false, cause: "aborted" })
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([work.then((value) => ({ settled: true as const, value })), stopped])
  } finally {
    clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort)
  }
}
