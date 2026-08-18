import type { CapturedUi } from "./runtime-context"
import { runRows, type DagStatusRunSnapshot } from "./dag-status-row-format"

export type {
  DagStatusNode,
  DagStatusRoute,
  DagStatusRunSnapshot,
  DagStatusWave,
} from "./dag-status-row-format"

// Own widget key: the DAG rows render BESIDE the existing "omo-task" widget, never over it.
export const DAG_STATUS_UI_KEY = "omo-dag"
const DEFAULT_DEBOUNCE_MS = 250
const LIVE_REFRESH_MS = 1_000

type TimerHandle = ReturnType<typeof setTimeout> | number

export interface DagStatusRunSummary {
  readonly runId: string
  readonly status: string
}

// The unsequenced live telemetry feed (DagActivityEvent): latest-wins per node, never accumulated.
export interface DagStatusActivityEvent {
  readonly runId: string
  readonly nodeId: string
  readonly taskId: string
  readonly activity: string
  readonly turns: number
}

// The read seam the widget needs from DagManager: session-scoped run list plus per-run snapshot.
export interface DagStatusUiManager {
  list(parentSessionId: string, options?: { readonly limit?: number }): readonly DagStatusRunSummary[]
  snapshot(runId: string, parentSessionId: string): DagStatusRunSnapshot
}

export interface DagStatusUiRuntime {
  ui(): CapturedUi | undefined
  sessionId(): string | undefined
  mode(): string | undefined
}

// Injectable timer seam so debounce and live refresh are deterministic under test.
export interface DagStatusUiTimers {
  set(callback: () => void, ms: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface DagStatusUiDeps {
  readonly manager: DagStatusUiManager
  readonly runtime: DagStatusUiRuntime
  readonly debounceMs?: number
  readonly timers?: DagStatusUiTimers
}

export interface DagStatusUi {
  // Debounced render, driven by dag events; collapses a burst into one paint.
  scheduleSync(): void
  // Immediate render.
  syncNow(): void
  // Live activity feed intake: latest-wins per node, ignored for runs this session cannot see.
  onActivity(event: DagStatusActivityEvent): void
  // Cancel pending timers so shutdown leaves no render scheduled past teardown.
  dispose(): void
}

const globalTimers: DagStatusUiTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle),
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

export function createDagStatusUi(deps: DagStatusUiDeps): DagStatusUi {
  const timers = deps.timers ?? globalTimers
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  // runId -> nodeId -> latest activity text. Latest-wins: an entry is replaced, never appended to.
  const liveActivity = new Map<string, Map<string, string>>()
  let pending: TimerHandle | undefined
  let liveRefresh: TimerHandle | undefined

  function render(): void {
    const ui = deps.runtime.ui()
    // TUI only: setWidget is a no-op in app-server mode, so skip the work entirely there.
    if (ui === undefined || deps.runtime.mode() !== "tui") {
      clearLiveRefresh()
      return
    }
    const runs = liveRuns()
    const rows = runs.flatMap((run) => runRows(run, liveActivity.get(run.runId)))
    pruneActivity(runs)
    if (rows.length === 0) {
      clearLiveRefresh()
      ui.setWidget(DAG_STATUS_UI_KEY, undefined)
      return
    }
    ui.setWidget(DAG_STATUS_UI_KEY, rows, { placement: "belowEditor" })
    if (runs.some((run) => !TERMINAL_RUN_STATUSES.has(run.status))) scheduleLiveRefresh()
    else clearLiveRefresh()
  }

  function liveRuns(): readonly DagStatusRunSnapshot[] {
    const sessionId = deps.runtime.sessionId()
    // Fail-closed: without a session id there is nothing to scope, so no run is queried.
    if (sessionId === undefined) return []
    const snapshots: DagStatusRunSnapshot[] = []
    for (const summary of deps.manager.list(sessionId)) {
      if (TERMINAL_RUN_STATUSES.has(summary.status)) continue
      // A run pruned between list and snapshot is stale, not fatal: drop it and keep painting.
      const snapshot = readSnapshot(summary.runId, sessionId)
      if (snapshot === undefined) continue
      snapshots.push(snapshot)
    }
    return snapshots
  }

  function readSnapshot(runId: string, sessionId: string): DagStatusRunSnapshot | undefined {
    try {
      return deps.manager.snapshot(runId, sessionId)
    } catch {
      return undefined
    }
  }

  function pruneActivity(runs: readonly DagStatusRunSnapshot[]): void {
    const liveIds = new Set(runs.map((run) => run.runId))
    for (const runId of [...liveActivity.keys()]) {
      if (!liveIds.has(runId)) liveActivity.delete(runId)
    }
  }

  function scheduleSync(): void {
    // A live run already repaints at 1Hz; reuse that timer rather than stacking a second one.
    if (liveRefresh !== undefined) return
    if (pending !== undefined) timers.clear(pending)
    pending = timers.set(() => {
      pending = undefined
      render()
    }, debounceMs)
  }

  function scheduleLiveRefresh(): void {
    if (liveRefresh !== undefined) return
    const handle = timers.set(() => {
      if (liveRefresh !== handle) return
      liveRefresh = undefined
      render()
    }, LIVE_REFRESH_MS)
    liveRefresh = handle
  }

  function clearLiveRefresh(): void {
    if (liveRefresh === undefined) return
    timers.clear(liveRefresh)
    liveRefresh = undefined
  }

  return {
    scheduleSync,
    syncNow: render,
    onActivity(event) {
      const perRun = liveActivity.get(event.runId) ?? new Map<string, string>()
      perRun.set(event.nodeId, event.activity)
      liveActivity.set(event.runId, perRun)
      scheduleSync()
    },
    dispose() {
      if (pending !== undefined) {
        timers.clear(pending)
        pending = undefined
      }
      clearLiveRefresh()
      liveActivity.clear()
    },
  }
}
