import type { SenpiExtensionAPI } from "../../extension/types"
import type {
  DagBridgeActivityEvent,
  DagBridgeRun,
  DagBridgeRunEvent,
  DagBridgeTimers,
  DagRpcBridge,
  DagRpcBridgeDeps,
} from "./dag-rpc-bridge-contract"
import { dagUpdatedPayload } from "./dag-snapshot-payload"

export { DAG_MAX_RUN_SNAPSHOTS } from "./dag-snapshot-payload"
export type {
  DagBridgeActivityEvent,
  DagBridgeLogger,
  DagBridgeRun,
  DagBridgeRunEvent,
  DagBridgeTimers,
  DagRpcBridge,
  DagRpcBridgeDeps,
} from "./dag-rpc-bridge-contract"
export type {
  DagBridgeRunSnapshot,
  DagBridgeSnapshotEdge,
  DagBridgeSnapshotNode,
  DagBridgeSnapshotWave,
} from "./dag-snapshot-payload"

// The three DAG channels. The sequenced ledger and the unsequenced telemetry stay separate on the
// wire: an unsequenced payload on the ledger channel breaks viewer catch-up, which dedupes on seq.
const DAG_EVENT_CHANNEL = "omo.dag.event"
const DAG_HEARTBEAT_CHANNEL = "omo.dag.heartbeat"
const DAG_ACTIVITY_CHANNEL = "omo.dag.activity"
// The wholesale-replace channel. It coexists with the seq ledger above: consumers that keep no
// per-event state (omo-desktop-app) swap their whole run list on each payload.
const DAG_UPDATED_CHANNEL = "omo.dag.updated"

export const DAG_DEFAULT_HEARTBEAT_MS = 15000
export const DAG_ACTIVITY_COALESCE_MS = 150
export const DAG_SNAPSHOT_DEBOUNCE_MS = 50

// A run is live while it can still journal an event. Terminal runs never earn a heartbeat.
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"])

type TimerHandle = ReturnType<typeof setTimeout> | number

const globalTimers: DagBridgeTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle),
}

export function createDagRpcBridge(pi: SenpiExtensionAPI, deps: DagRpcBridgeDeps): DagRpcBridge {
  const timers = deps.timers ?? globalTimers
  const now = deps.now ?? Date.now
  const heartbeatMs = deps.heartbeatMs ?? DAG_DEFAULT_HEARTBEAT_MS
  const activityCoalesceMs = deps.activityCoalesceMs ?? DAG_ACTIVITY_COALESCE_MS
  const snapshotDebounceMs = deps.snapshotDebounceMs ?? DAG_SNAPSHOT_DEBOUNCE_MS
  const subscriptions = new Map<string, () => void>()
  const headSeq = new Map<string, number>()
  const pendingActivity = new Map<string, DagBridgeActivityEvent>()
  let heartbeat: TimerHandle | undefined
  let activityFlush: TimerHandle | undefined
  let snapshotFlush: TimerHandle | undefined
  let lastSnapshotFingerprint: string | undefined
  let attached = false
  let disposed = false
  const reportedReadFaults = new Set<string>()

  const emit = (name: string, data: unknown): void => {
    pi.rpc?.emit(name, data)
  }

  // Store reads run from timers (heartbeat, snapshot flush) where a throw has no caller left to reach:
  // it becomes an uncaughtException and ends the whole session ("OmO exiting due to uncaughtException:
  // ENOENT ... dag/runs" after a worktree cleanup removed .omo mid-run). A read fault is reported once
  // per distinct message, read as "nothing to publish", and forgotten once the store reads again.
  const readStore = <T>(read: () => T, surface: string): T | undefined => {
    try {
      const value = read()
      reportedReadFaults.clear()
      return value
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!reportedReadFaults.has(message)) {
        reportedReadFaults.add(message)
        deps.logger?.warn(`omo-dag ${surface} read failed; nothing published until the store reads again`, { error: message })
      }
      return undefined
    }
  }

  const ownedRuns = (): readonly DagBridgeRun[] => readStore(deps.liveRuns, "run list") ?? []

  const forward = (event: DagBridgeRunEvent): void => {
    if (!attached) return
    // The journal can redeliver a seq after a reopen replay; the ledger stays exactly-once per seq.
    const delivered = headSeq.get(event.runId) ?? 0
    if (event.seq <= delivered) return
    headSeq.set(event.runId, event.seq)
    emit(DAG_EVENT_CHANNEL, event)
  }

  const liveRuns = (): readonly DagBridgeRun[] =>
    ownedRuns().filter((run) => !TERMINAL_RUN_STATUSES.has(run.status))

  const stopHeartbeat = (): void => {
    if (heartbeat === undefined) return
    timers.clear(heartbeat)
    heartbeat = undefined
  }

  const beat = (): void => {
    heartbeat = undefined
    if (!attached) return
    const runs = liveRuns()
    if (runs.length === 0) return
    emit(DAG_HEARTBEAT_CHANNEL, {
      schemaVersion: 1,
      at: new Date(now()).toISOString(),
      runs: runs.map((run) => ({ runId: run.runId, headSeq: headSeq.get(run.runId) ?? 0 })),
    })
    scheduleHeartbeat()
  }

  const scheduleHeartbeat = (): void => {
    if (!attached || heartbeat !== undefined) return
    if (liveRuns().length === 0) return
    heartbeat = timers.set(beat, heartbeatMs)
  }

  const flushActivity = (): void => {
    activityFlush = undefined
    if (!attached) {
      pendingActivity.clear()
      return
    }
    const batch = [...pendingActivity.values()]
    pendingActivity.clear()
    // Unsequenced, never journaled, and never mixed into DAG_EVENT_CHANNEL.
    for (const event of batch) emit(DAG_ACTIVITY_CHANNEL, event)
  }

  const stopActivityFlush = (): void => {
    if (activityFlush === undefined) return
    timers.clear(activityFlush)
    activityFlush = undefined
  }

  const flushSnapshot = (): void => {
    snapshotFlush = undefined
    if (!attached) return
    const parentSessionId = deps.parentSessionId?.()
    if (parentSessionId === undefined || deps.runSnapshots === undefined) return
    // An unreadable store must not publish an empty run list: consumers swap their whole view on
    // this channel, so that would make every live run look finished.
    const snapshots = readStore(deps.runSnapshots, "run snapshot")
    if (snapshots === undefined) return
    const data = dagUpdatedPayload(parentSessionId, snapshots)
    const fingerprint = JSON.stringify(data)
    if (fingerprint === lastSnapshotFingerprint) return
    lastSnapshotFingerprint = fingerprint
    emit(DAG_UPDATED_CHANNEL, data)
  }

  const scheduleSnapshot = (): void => {
    if (!attached || snapshotFlush !== undefined) return
    snapshotFlush = timers.set(flushSnapshot, snapshotDebounceMs)
  }

  const stopSnapshotFlush = (): void => {
    if (snapshotFlush === undefined) return
    timers.clear(snapshotFlush)
    snapshotFlush = undefined
  }

  const detach = (): void => {
    attached = false
    for (const unsubscribe of subscriptions.values()) unsubscribe()
    subscriptions.clear()
    headSeq.clear()
    pendingActivity.clear()
    stopHeartbeat()
    stopActivityFlush()
    stopSnapshotFlush()
    // The next attach belongs to a fresh consumer, so it must receive a full snapshot again.
    lastSnapshotFingerprint = undefined
  }

  const sync = (): void => {
    if (!attached) return
    for (const run of ownedRuns()) {
      if (subscriptions.has(run.runId)) continue
      subscriptions.set(run.runId, run.subscribe(forward))
    }
    scheduleHeartbeat()
    scheduleSnapshot()
  }

  return {
    attach() {
      if (disposed) return
      detach()
      attached = true
      sync()
    },
    sync,
    detach,
    notifyStoreMutation() {
      if (!attached) return
      scheduleSnapshot()
    },
    publishActivity(event) {
      if (!attached) return
      // Latest-wins per node: a chatty node collapses to one payload per coalescing window.
      pendingActivity.set(`${event.runId}\u0000${event.nodeId}`, event)
      if (activityFlush === undefined) activityFlush = timers.set(flushActivity, activityCoalesceMs)
    },
    dispose() {
      if (disposed) return
      disposed = true
      detach()
    },
  }
}
