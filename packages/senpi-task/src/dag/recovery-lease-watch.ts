import { observeRecordOwners, recordOwnerAlive, type OwnerProcessView } from "../lifecycle/owner-process"
import type { HostClaim } from "../state/record-types"
import { ownerLiveness } from "./run-lease"

export type DagLeaseWatchTimerHandle = ReturnType<typeof setTimeout> | number

export type DagLeaseWatchTimers = {
  readonly set: (callback: () => void, ms: number) => DagLeaseWatchTimerHandle
  readonly clear: (handle: DagLeaseWatchTimerHandle) => void
}

export type DagLeaseWatchOptions = {
  readonly isProcessAlive?: (pid: number) => boolean
  // The start view a child owner's claim is checked against: the holder rule's own (`ownerLiveness`).
  readonly ownerProcesses?: OwnerProcessView
  readonly timers?: DagLeaseWatchTimers
  readonly intervalMs?: number
}

export type DagLeaseWatch = {
  // Polls the holder until the holder rule would no longer name it, then calls `onExit` once: a bare
  // pid (a lease) until it exits; a child's owner with its stamped `claim` until that pid exits or now
  // belongs to a process whose start contradicts the stamp. Returns the cancel.
  readonly watch: (holderPid: number, onExit: () => void, claim?: HostClaim) => () => void
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
  const { isProcessAlive, ownerProcesses } = ownerLiveness(options)
  const timers = options.timers ?? unrefTimers
  const intervalMs = options.intervalMs ?? DAG_LEASE_WATCH_INTERVAL_MS
  // Every live watch; a poll awaiting the owner's start finds its watch gone when it was cancelled.
  const watching = new Set<symbol>()
  const pending = new Map<symbol, DagLeaseWatchTimerHandle>()

  const cancel = (key: symbol): void => {
    watching.delete(key)
    const handle = pending.get(key)
    if (handle === undefined) return
    pending.delete(key)
    timers.clear(handle)
  }

  return {
    watch(holderPid, onExit, claim) {
      const key = Symbol("dag-lease-watch")
      const owner = { host_pid: holderPid, ...(claim === undefined ? {} : { host_claim: claim }) }
      const decide = (): void => {
        if (!watching.has(key)) return
        if (recordOwnerAlive(isProcessAlive, ownerProcesses, owner)) {
          pending.set(key, timers.set(poll, intervalMs))
          return
        }
        watching.delete(key)
        onExit()
      }
      const poll = (): void => {
        if (!pending.delete(key)) return
        const observing = observeRecordOwners(ownerProcesses, [owner], process.pid)
        if (observing === undefined) decide()
        else void observing.then(decide)
      }
      watching.add(key)
      pending.set(key, timers.set(poll, intervalMs))
      return () => cancel(key)
    },
    dispose() {
      for (const key of [...watching]) cancel(key)
    },
  }
}
