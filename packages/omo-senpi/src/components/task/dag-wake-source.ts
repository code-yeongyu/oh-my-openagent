import type { SenpiExtensionAPI } from "../../extension/types"

// senpi's monitor-state event: goal continuation reads it to decide whether a wake source is still
// live and auto-continuation must wait. Liveness only, it never carries or triggers work.
export const DAG_WAKE_SOURCE_STATE_EVENT = "wake_source_state"
export const DAG_WAKE_SOURCE = "omo-dag"

// Structural mirrors of the dag domain contract (senpi-task/src/dag/types.ts), declared locally so
// this emitter stays a read-only consumer of whatever DagManager instance the extension wires in.
export interface DagWakeSourceRunSummary {
  readonly runId: string
  readonly status: string
}

export interface DagWakeSourceRunSnapshot {
  readonly runId: string
  readonly name: string
  readonly status: string
  readonly createdAt: string
  readonly startedAt?: string
}

export interface DagWakeSourceManager {
  list(parentSessionId: string, options?: { readonly limit?: number }): readonly DagWakeSourceRunSummary[]
  snapshot(runId: string, parentSessionId: string): DagWakeSourceRunSnapshot
}

export interface DagWakeSourceDeps {
  readonly pi: SenpiExtensionAPI
  readonly manager: DagWakeSourceManager
  readonly sessionId: () => string | undefined
}

export interface DagWakeSourceChannel {
  readonly id: string
  readonly description: string
  readonly startedAtMs: number
}

export interface DagWakeSource {
  // A run entering the live set: republish so continuation starts waiting on it.
  onRunStart(runId: string): void
  // A run leaving the live set: republish so continuation stops waiting on it, clearing at zero.
  onRunTerminal(runId: string): void
  // Teardown: always clears, so no dag run outlives the session as a phantom wake source.
  emitShutdown(): void
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

export function createDagWakeSource(deps: DagWakeSourceDeps): DagWakeSource {
  function liveChannels(): readonly DagWakeSourceChannel[] {
    const sessionId = deps.sessionId()
    // Fail-closed: without a session id there is nothing to scope, so nothing is live.
    if (sessionId === undefined) return []
    const channels: DagWakeSourceChannel[] = []
    for (const summary of deps.manager.list(sessionId)) {
      if (TERMINAL_RUN_STATUSES.has(summary.status)) continue
      // A run pruned between list and snapshot is stale, not fatal: drop it and keep publishing.
      const snapshot = readSnapshot(summary.runId, sessionId)
      if (snapshot === undefined) continue
      channels.push({
        id: snapshot.runId,
        description: snapshot.name,
        startedAtMs: Date.parse(snapshot.startedAt ?? snapshot.createdAt),
      })
    }
    return channels
  }

  function readSnapshot(runId: string, sessionId: string): DagWakeSourceRunSnapshot | undefined {
    try {
      return deps.manager.snapshot(runId, sessionId)
    } catch {
      return undefined
    }
  }

  function publish(channels: readonly DagWakeSourceChannel[]): void {
    deps.pi.events?.emit(DAG_WAKE_SOURCE_STATE_EVENT, {
      source: DAG_WAKE_SOURCE,
      activeCount: channels.length,
      channels,
    })
  }

  return {
    onRunStart: () => publish(liveChannels()),
    onRunTerminal: () => publish(liveChannels()),
    emitShutdown: () => publish([]),
  }
}
