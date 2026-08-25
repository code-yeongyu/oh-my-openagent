import type { DagBridgeRunSnapshot } from "./dag-snapshot-payload"

type TimerHandle = ReturnType<typeof setTimeout> | number

// Structural read-seam over the journaled DagRunEvent. The bridge forwards the payload verbatim and
// only reads the envelope fields it needs to order and dedupe, so the 14-member payload union stays
// owned by the engine package.
export interface DagBridgeRunEvent {
  readonly schemaVersion: 1
  readonly runId: string
  readonly seq: number
  readonly at: string
  readonly lane: string
  readonly type: string
}

export interface DagBridgeActivityEvent {
  readonly schemaVersion: 1
  readonly runId: string
  readonly nodeId: string
  readonly taskId: string
  readonly at: string
  readonly activity: string
  readonly currentTool?: string
  readonly lastAssistantLine?: string
  readonly turns: number
  readonly toolCalls?: number
}

// One owned run: `subscribe` is the journal fan-out, which the journal invokes only after the WAL
// append and the checkpoint replace both succeed. The bridge adds no pre-durability emission path.
export interface DagBridgeRun {
  readonly runId: string
  readonly status: string
  readonly subscribe: (listener: (event: DagBridgeRunEvent) => void) => () => void
}

// Injectable timer seam so heartbeat and activity coalescing are deterministic under test; defaults
// to global timers, mirroring `status-ui.ts`.
export interface DagBridgeTimers {
  set(callback: () => void, ms: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface DagRpcBridgeDeps {
  // Runs this session owns right now, re-read on every attach and every heartbeat tick.
  readonly liveRuns: () => readonly DagBridgeRun[]
  // Full run snapshots for the omo.dag.updated channel, re-read on every debounced flush.
  readonly runSnapshots?: () => readonly DagBridgeRunSnapshot[]
  // Routing discriminator every omo.dag.updated payload carries.
  readonly parentSessionId?: () => string | undefined
  readonly heartbeatMs?: number
  readonly activityCoalesceMs?: number
  readonly snapshotDebounceMs?: number
  readonly timers?: DagBridgeTimers
  readonly now?: () => number
}

export interface DagRpcBridge {
  // session_start: subscribe every owned run and arm the heartbeat when one is nonterminal.
  attach(): void
  // Re-read the owned runs: picks up a run started mid-session and rearms the heartbeat for it.
  sync(): void
  // session_before_switch: drop every subscription and timer so nothing leaks into the next session.
  detach(): void
  publishActivity(event: DagBridgeActivityEvent): void
  // Every dag store mutation calls this; the snapshot flush is debounced and fingerprint-deduped.
  notifyStoreMutation(): void
  dispose(): void
}
