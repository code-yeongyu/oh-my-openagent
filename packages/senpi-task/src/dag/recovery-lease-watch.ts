import { defaultSignaller } from "../lifecycle/context"

export type DagLeaseWatchTimerHandle = ReturnType<typeof setTimeout> | number

export type DagLeaseWatchTimers = {
  readonly set: (callback: () => void, ms: number) => DagLeaseWatchTimerHandle
  readonly clear: (handle: DagLeaseWatchTimerHandle) => void
}

export type DagLeaseWatchOptions = {
  readonly isProcessAlive?: (pid: number) => boolean
  readonly timers?: DagLeaseWatchTimers
  readonly intervalMs?: number
}

export type DagLeaseWatch = {
  // Polls `holderPid` until it stops being alive, then calls `onExit` once. Returns the cancel.
  readonly watch: (holderPid: number, onExit: () => void) => () => void
  readonly dispose: () => void
}

export const DAG_LEASE_WATCH_INTERVAL_MS = 1_000

const unrefTimers: DagLeaseWatchTimers = {
  set: (callback, ms) => {
    const handle = setTimeout(callback, ms)
    handle.unref?.()
    return handle
  },
  clear: (handle) => clearTimeout(handle),
}

export function createDagLeaseWatch(options: DagLeaseWatchOptions = {}): DagLeaseWatch {
  const isProcessAlive = options.isProcessAlive ?? defaultSignaller.isAlive
  const timers = options.timers ?? unrefTimers
  const intervalMs = options.intervalMs ?? DAG_LEASE_WATCH_INTERVAL_MS
  const pending = new Map<symbol, DagLeaseWatchTimerHandle>()

  const cancel = (key: symbol): void => {
    const handle = pending.get(key)
    if (handle === undefined) return
    pending.delete(key)
    timers.clear(handle)
  }

  return {
    watch(holderPid, onExit) {
      const key = Symbol("dag-lease-watch")
      const poll = (): void => {
        if (!pending.has(key)) return
        pending.delete(key)
        if (isProcessAlive(holderPid)) {
          pending.set(key, timers.set(poll, intervalMs))
          return
        }
        onExit()
      }
      pending.set(key, timers.set(poll, intervalMs))
      return () => cancel(key)
    },
    dispose() {
      for (const key of [...pending.keys()]) cancel(key)
    },
  }
}
