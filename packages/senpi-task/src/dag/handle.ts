// allow: SIZE_OK - the wait/attach contract keeps ownership checks, terminal projection, and waiter bookkeeping on one surface so no caller can observe a half-applied terminal state.
import type { TaskRunStats } from "../state/types"
import { subscribeDagJournal, type DagJournalListener } from "./journal"
import type { DagRunRecordV1 } from "./manager"
import type { DagFileStore } from "./store"
import type {
  DagNode,
  DagNodeCounts,
  DagNodeError,
  DagNodeId,
  DagRunId,
  DagRunSnapshot,
  DagRunStatus,
} from "./types"

const TERMINAL_RUN_STATUSES = new Set<DagRunStatus>(["completed", "failed", "cancelled"])
const CANCEL_REASON_PAGE_LIMIT = 64
const DEFAULT_CANCEL_REASON = "cancelled"

export const DAG_WAIT_ERROR_CODES = ["run_not_found", "run_not_owned", "invalid_arguments"] as const

export type DagWaitErrorCode = (typeof DAG_WAIT_ERROR_CODES)[number]

/**
 * The ONLY rejection this surface produces, and only from a pre-dispatch check. A task outcome -
 * failed, cancelled, or otherwise - always resolves; callers read the outcome off DagRunResult.
 */
export class DagWaitError extends Error {
  readonly code: DagWaitErrorCode
  readonly runId?: DagRunId

  constructor(input: { readonly code: DagWaitErrorCode; readonly message: string; readonly runId?: DagRunId }) {
    super(input.message)
    this.name = "DagWaitError"
    this.code = input.code
    if (input.runId !== undefined) this.runId = input.runId
  }
}

export type DagTerminalNodeResult =
  | {
      readonly state: "completed"
      readonly taskId: string
      readonly output: string
      readonly runStats?: TaskRunStats
    }
  | { readonly state: "failed"; readonly taskId?: string; readonly error: DagNodeError }
  | { readonly state: "cancelled"; readonly taskId?: string; readonly reason: string }
  | { readonly state: "skipped"; readonly dependencyIds: readonly DagNodeId[] }

export type DagRunResult = {
  readonly runId: DagRunId
  readonly status: DagRunStatus
  readonly snapshot: DagRunSnapshot
  readonly nodes: Readonly<Record<string, DagTerminalNodeResult>>
}

export type DagRunHandle = {
  readonly runId: DagRunId
  readonly snapshot: () => DagRunSnapshot
  readonly done: () => Promise<DagRunResult>
  readonly cancel: (reason?: string) => Promise<void>
}

export type DagWaitSurfaceOptions = {
  readonly store: DagFileStore
  /** Journal subscription seam: the scheduler owns the live journal, this surface only listens. */
  readonly subscribe: (runId: DagRunId, listener: DagJournalListener) => () => void
  readonly cancel?: (runId: DagRunId, reason?: string) => void | Promise<void>
  /** Node output source; defaults to the durable per-node result artifact written by the scheduler. */
  readonly readOutput?: (runId: DagRunId, nodeId: DagNodeId) => string | null
}

export type DagWaitSurface = {
  readonly wait: (runId: DagRunId, parentSessionId: string) => Promise<DagRunResult>
  readonly attach: (runId: DagRunId, parentSessionId: string) => DagRunHandle
  /** Test-only observability proving a settled run retains no waiter bookkeeping. */
  readonly waiterCount: (runId: DagRunId) => number
}

type RunWaiters = {
  readonly resolvers: Set<(result: DagRunResult) => void>
  readonly unsubscribers: Set<() => void>
}

export function createDagWaitSurface(options: DagWaitSurfaceOptions): DagWaitSurface {
  const store = options.store
  const readOutput = options.readOutput ?? ((runId, nodeId) => store.readResult(runId, nodeId))
  const waiters = new Map<DagRunId, RunWaiters>()

  function ownedRecord(runId: DagRunId, parentSessionId: string): DagRunRecordV1 {
    if (typeof runId !== "string" || runId.length === 0) {
      throw new DagWaitError({ code: "invalid_arguments", message: "runId must be a non-empty string" })
    }
    if (typeof parentSessionId !== "string" || parentSessionId.length === 0) {
      throw new DagWaitError({ code: "invalid_arguments", message: "parentSessionId must be a non-empty string", runId })
    }
    const record = store.readCheckpoint<DagRunRecordV1>(runId)
    if (record === null) {
      throw new DagWaitError({ code: "run_not_found", message: `unknown dag run "${runId}"`, runId })
    }
    // A run whose owning session is gone stays owned by it: a new session gets a rejection here
    // rather than a subscription that would never settle.
    if (record.parentSessionId !== parentSessionId) {
      throw new DagWaitError({ code: "run_not_owned", message: `dag run "${runId}" belongs to another session`, runId })
    }
    return record
  }

  function settleWaiters(runId: DagRunId, result: DagRunResult): void {
    const entry = waiters.get(runId)
    if (entry === undefined) return
    waiters.delete(runId)
    for (const unsubscribe of entry.unsubscribers) unsubscribe()
    for (const resolve of entry.resolvers) resolve(result)
  }

  function addSubscription(runId: DagRunId, entry: RunWaiters, unsubscribe: () => void): void {
    if (waiters.get(runId) === entry) entry.unsubscribers.add(unsubscribe)
    else unsubscribe()
  }

  function register(runId: DagRunId, resolve: (result: DagRunResult) => void): void {
    const existing = waiters.get(runId)
    if (existing !== undefined) {
      existing.resolvers.add(resolve)
      return
    }
    const entry: RunWaiters = { resolvers: new Set([resolve]), unsubscribers: new Set() }
    waiters.set(runId, entry)
    const onJournalEvent = (): void => {
      const current = store.readCheckpoint<DagRunRecordV1>(runId)
      if (current === null || !TERMINAL_RUN_STATUSES.has(current.status)) return
      settleWaiters(runId, projectResult(current, store, readOutput))
    }
    // The durable journal channel covers scheduler instances that are distinct from the adapter's
    // live event subscription. Abandoning a wait promise drops neither subscription nor the run.
    addSubscription(runId, entry, subscribeDagJournal(store, runId, onJournalEvent))
    addSubscription(runId, entry, options.subscribe(runId, onJournalEvent))
    // The run may have gone terminal between the ownership read and the subscription.
    const now = store.readCheckpoint<DagRunRecordV1>(runId)
    if (now !== null && TERMINAL_RUN_STATUSES.has(now.status)) {
      settleWaiters(runId, projectResult(now, store, readOutput))
    }
  }

  const surface: DagWaitSurface = {
    // async so every pre-dispatch rejection reaches the caller as a rejected promise.
    wait: async (runId, parentSessionId) => {
      const record = ownedRecord(runId, parentSessionId)
      if (TERMINAL_RUN_STATUSES.has(record.status)) return projectResult(record, store, readOutput)
      return new Promise<DagRunResult>((resolve) => {
        register(runId, resolve)
      })
    },
    attach(runId, parentSessionId) {
      ownedRecord(runId, parentSessionId)
      return {
        runId,
        snapshot: () => projectSnapshot(ownedRecord(runId, parentSessionId)),
        done: () => surface.wait(runId, parentSessionId),
        cancel: async (reason) => {
          ownedRecord(runId, parentSessionId)
          await options.cancel?.(runId, reason)
        },
      }
    },
    waiterCount: (runId) => waiters.get(runId)?.resolvers.size ?? 0,
  }
  return surface
}

function projectResult(
  record: DagRunRecordV1,
  store: DagFileStore,
  readOutput: (runId: DagRunId, nodeId: DagNodeId) => string | null,
): DagRunResult {
  const cancelReason = record.status === "cancelled" ? readCancelReason(store, record.runId) : DEFAULT_CANCEL_REASON
  const nodes: Record<string, DagTerminalNodeResult> = {}
  for (const node of record.nodes) {
    const terminal = projectNode(node, record.runId, cancelReason, readOutput)
    if (terminal !== null) nodes[node.id] = terminal
  }
  return { runId: record.runId, status: record.status, snapshot: projectSnapshot(record), nodes }
}

// Nonterminal nodes are omitted rather than invented: a terminal run has no nonterminal node, so an
// entry here would be a scheduler bug the caller must be able to see in the snapshot.
function projectNode(
  node: DagNode,
  runId: DagRunId,
  cancelReason: string,
  readOutput: (runId: DagRunId, nodeId: DagNodeId) => string | null,
): DagTerminalNodeResult | null {
  switch (node.state) {
    case "completed":
      // A completed node always carries the task it ran as; the empty fallback only exists so a
      // corrupt journal degrades to an inspectable result instead of a type lie.
      return {
        state: "completed",
        taskId: node.taskId ?? "",
        output: readOutput(runId, node.id) ?? "",
        ...(node.runStats === undefined ? {} : { runStats: node.runStats }),
      }
    case "failed":
      return {
        state: "failed",
        ...(node.taskId === undefined ? {} : { taskId: node.taskId }),
        error: node.error ?? {
          code: "task_error",
          message: `node "${node.id}" failed without a recorded error`,
          nodeId: node.id,
          at: node.completedAt ?? node.createdAt,
        },
      }
    case "cancelled":
      return {
        state: "cancelled",
        ...(node.taskId === undefined ? {} : { taskId: node.taskId }),
        reason: cancelReason,
      }
    case "skipped":
      return { state: "skipped", dependencyIds: node.dependsOn }
    default:
      return null
  }
}

function readCancelReason(store: DagFileStore, runId: DagRunId): string {
  let reason = DEFAULT_CANCEL_REASON
  let sinceSeq = 0
  for (;;) {
    const page = store.readEvents(runId, sinceSeq, { limit: CANCEL_REASON_PAGE_LIMIT, types: ["dag.run.cancelled"] })
    for (const event of page.events) {
      if (event.type === "dag.run.cancelled" && event.reason !== undefined) reason = event.reason
    }
    if (!page.hasMore) return reason
    sinceSeq = page.nextSinceSeq
  }
}

function projectSnapshot(record: DagRunRecordV1): DagRunSnapshot {
  return {
    schemaVersion: 1,
    runId: record.runId,
    runKey: record.runKey,
    name: record.name,
    parentSessionId: record.parentSessionId,
    rootSessionId: record.rootSessionId,
    status: record.status,
    generation: record.generation,
    createdAt: record.createdAt,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt }),
    definitionFingerprint: record.definitionFingerprint,
    lastSeq: record.checkpointSeq,
    nodes: record.nodes,
    edges: record.edges,
    waves: record.waves,
    criticalPath: record.criticalPath,
    bottlenecks: record.bottlenecks,
    diagnostics: record.diagnostics,
    counts: countNodes(record.nodes),
  }
}

function countNodes(nodes: readonly DagNode[]): DagNodeCounts {
  const counts = {
    total: nodes.length,
    pending: 0,
    blocked: 0,
    scheduled: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  }
  for (const node of nodes) counts[node.state] += 1
  return counts
}
