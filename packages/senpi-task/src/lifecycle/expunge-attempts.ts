// The TTL expunge attempts of THIS process that still have work in flight: a sweep while it runs, and each
// close it left pending. A tombstone this process wrote whose attempt is no longer here was abandoned (the
// sweep threw, or its deferred completion failed) and the next sweep may take it over.
const inFlight = new Map<string, number>()

/** Count one more piece of in-flight work for an attempt; the returned release is idempotent. */
export function holdAttempt(token: string): () => void {
  inFlight.set(token, (inFlight.get(token) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (inFlight.get(token) ?? 1) - 1
    if (left <= 0) inFlight.delete(token)
    else inFlight.set(token, left)
  }
}

export function attemptInFlight(token: string): boolean {
  return inFlight.has(token)
}
