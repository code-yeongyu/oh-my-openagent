import { DAG_VERIFICATION_DIRECTIVE, type ParentState } from "@oh-my-opencode/senpi-task"

import type { IdleInjection } from "../../extension/idle-injection-coordinator"

export const DAG_WAKE_MESSAGE_TYPE = "omo-senpi.dag-run"

export interface DagWakeNodeCounts {
  readonly total: number
  readonly pending: number
  readonly blocked: number
  readonly scheduled: number
  readonly running: number
  readonly completed: number
  readonly failed: number
  readonly cancelled: number
  readonly skipped: number
}

export interface DagWakeFailure {
  readonly code: string
  readonly message: string
  readonly nodeId?: string
}

export interface DagWakeRunEvent {
  readonly runId: string
  readonly seq: number
  readonly type: string
  readonly counts?: DagWakeNodeCounts
  readonly error?: DagWakeFailure
  readonly reason?: string
}

export interface DagWakeRun {
  readonly runId: string
  readonly name: string
  readonly parentSessionId: string
}

export interface DagWakeCoordinator {
  enqueue(injection: IdleInjection): void
  scheduleFlush(): void
  flushSoon(): void
}

export interface DagWakeDeps {
  readonly coordinator: DagWakeCoordinator
  readonly parentState: () => ParentState
}

export interface DagWake {
  onRunEvent(run: DagWakeRun, event: DagWakeRunEvent): void
  onSessionStart(parentSessionId: string | undefined): void
  bufferedCount(parentSessionId: string): number
}

const TERMINAL_EVENT_STATUSES = {
  "dag.run.completed": "completed",
  "dag.run.failed": "failed",
  "dag.run.cancelled": "cancelled",
} as const

type DagWakeStatus = (typeof TERMINAL_EVENT_STATUSES)[keyof typeof TERMINAL_EVENT_STATUSES]

// A pause is NOT terminal but it IS user-visible: recovery's pauseRunsForShutdown suspends every
// in-flight run when the session shuts down (reload included), so the main session must be told its
// DAG stopped mid-flight instead of silently discovering it later.
const PAUSED_EVENT_TYPE = "dag.run.paused"

export function createDagWake(deps: DagWakeDeps): DagWake {
  const buffered = new Map<string, Map<string, IdleInjection>>()

  function deliver(injection: IdleInjection, parentState: ParentState): void {
    deps.coordinator.enqueue(injection)
    if (parentState.kind === "idle") deps.coordinator.flushSoon()
    else deps.coordinator.scheduleFlush()
  }

  function buffer(parentSessionId: string, injection: IdleInjection): void {
    const entries = buffered.get(parentSessionId) ?? new Map<string, IdleInjection>()
    entries.set(injection.key, injection)
    buffered.set(parentSessionId, entries)
  }

  return {
    onRunEvent(run, event) {
      const injection = buildRunInjection(run, event)
      if (injection === undefined) return
      const parentState = deps.parentState()
      if (parentState.kind === "compacting"
        || parentState.kind === "session_switching"
        || parentState.kind === "session_shutdown") {
        buffer(run.parentSessionId, injection)
        return
      }
      deliver(injection, parentState)
    },
    onSessionStart(parentSessionId) {
      if (parentSessionId === undefined) return
      const entries = buffered.get(parentSessionId)
      if (entries === undefined || entries.size === 0) return
      buffered.delete(parentSessionId)
      for (const injection of entries.values()) deps.coordinator.enqueue(injection)
      deps.coordinator.flushSoon()
    },
    bufferedCount(parentSessionId) {
      return buffered.get(parentSessionId)?.size ?? 0
    },
  }
}

function terminalStatus(type: string): DagWakeStatus | undefined {
  return TERMINAL_EVENT_STATUSES[type as keyof typeof TERMINAL_EVENT_STATUSES]
}

function buildRunInjection(run: DagWakeRun, event: DagWakeRunEvent): IdleInjection | undefined {
  if (event.type === PAUSED_EVENT_TYPE) return buildPausedInjection(run, event.reason)
  const status = terminalStatus(event.type)
  if (status === undefined || event.counts === undefined) return undefined
  return buildInjection(run, status, event.counts, event.error)
}

function buildPausedInjection(run: DagWakeRun, reason: string | undefined): IdleInjection {
  const cause = reason === undefined ? "" : ` (${reason})`
  return {
    key: `dag-run:${run.runId}`,
    source: "dag-run",
    customType: DAG_WAKE_MESSAGE_TYPE,
    content: `DAG "${run.name}" paused${cause}: it will resume when the session restarts.`,
    display: false,
    details: {
      runId: run.runId,
      name: run.name,
      status: "paused",
      ...(reason === undefined ? {} : { reason }),
    },
  }
}

function buildInjection(
  run: DagWakeRun,
  status: DagWakeStatus,
  counts: DagWakeNodeCounts,
  firstFailure: DagWakeFailure | undefined,
): IdleInjection {
  return {
    key: `dag-run:${run.runId}`,
    source: "dag-run",
    customType: DAG_WAKE_MESSAGE_TYPE,
    // Terminal runs are the point where the parent decides the DAG is done, so the run summary
    // carries the same prove-it-yourself directive the per-node completions do. A pause is not a
    // completion claim and stays directive-free.
    content: `${buildSummary(run.name, status, counts, firstFailure)}

${DAG_VERIFICATION_DIRECTIVE}`,
    display: false,
    details: {
      runId: run.runId,
      name: run.name,
      status,
      counts,
      ...(firstFailure === undefined ? {} : { firstFailure }),
    },
  }
}

function buildSummary(
  name: string,
  status: DagWakeStatus,
  counts: DagWakeNodeCounts,
  firstFailure: DagWakeFailure | undefined,
): string {
  const summary = `DAG "${name}" ${status}: ${counts.completed} completed, ${counts.failed} failed, ${counts.cancelled} cancelled, ${counts.skipped} skipped (${counts.total} total)`
  if (firstFailure === undefined) return summary
  const node = firstFailure.nodeId === undefined ? "" : ` at ${firstFailure.nodeId}`
  return `${summary}. First failure${node} [${firstFailure.code}]: ${firstFailure.message}`
}

