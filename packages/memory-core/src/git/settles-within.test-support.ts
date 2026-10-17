export type Settlement<T> = { readonly kind: "settled"; readonly value: T } | { readonly kind: "still-waiting" }

// A circuit breaker, not a synchronization primitive: it reports a promise that never settled
// instead of letting the test hang, and clears its timer either way.
export async function settlesWithin<T>(promise: Promise<T>, boundMs: number): Promise<Settlement<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const breaker = new Promise<Settlement<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "still-waiting" }), boundMs)
  })
  try {
    return await Promise.race([promise.then((value): Settlement<T> => ({ kind: "settled", value })), breaker])
  } finally {
    clearTimeout(timer)
  }
}
