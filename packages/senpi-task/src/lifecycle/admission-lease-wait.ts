import type { AcquireAdmissionLeaseResult } from "./admission-lease"

const waiters = new Map<string, Set<() => void>>()

// Local release wakes acquisition synchronously, before the releaser enters runner I/O. The
// existing bounded retry remains for foreign processes and crashed/stale holders only.
export function waitForAdmissionLease(
  path: string,
  retryMs: number,
  attempt: () => AcquireAdmissionLeaseResult | undefined,
): Promise<AcquireAdmissionLeaseResult> {
  return new Promise((resolve, reject) => {
    const listeners = waiters.get(path) ?? new Set<() => void>()
    waiters.set(path, listeners)
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      listeners.delete(retry)
      if (listeners.size === 0) waiters.delete(path)
    }
    const retry = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      try {
        const result = attempt()
        if (result === undefined) {
          timer = setTimeout(retry, retryMs)
          return
        }
        cleanup()
        resolve(result)
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    listeners.add(retry)
    retry()
  })
}

export function wakeAdmissionLeaseWaiters(path: string): void {
  for (const retry of [...(waiters.get(path) ?? [])]) retry()
}
