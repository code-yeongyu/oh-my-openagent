/**
 * A recovery clock a suite drives by hand: every bound a lost transport arms waits here until the
 * suite says the bound elapsed. Nothing sleeps; `expire()` is the moment the bound runs out.
 */
export interface ManualRecoveryClock {
  schedule(ms: number, expire: () => void): () => void
  expire(): void
  pending(): number
}

export function manualRecoveryClock(): ManualRecoveryClock {
  const armed = new Set<() => void>()
  return {
    schedule: (_ms, expire) => {
      armed.add(expire)
      return () => {
        armed.delete(expire)
      }
    },
    expire: () => {
      const due = [...armed]
      armed.clear()
      for (const expire of due) expire()
    },
    pending: () => armed.size,
  }
}
