import type { TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import type { DagJournal } from "./journal"
import type { DagPersistedNode } from "./manager"
import type { DagNodeResultArtifact } from "./results"
import type { InfrastructureRetries } from "./infrastructure-retry"
import type { DagExecutionModeSources } from "./execution-mode"
import type { DagNodeSpawnPolicy } from "./scheduler"
import { dagNodeTransitionedEvent } from "./events"
import type { DagNode, DagNodeId, DagNodeState, DagNodeError, DagNodeErrorCode, DagNodeTransitionReason, DagNodeCounts } from "./types"
import type { DagRunRecordV1 } from "./manager"

export const TERMINAL_NODE_STATES: ReadonlySet<DagNodeState> = new Set([
  "completed",
  "failed",
  "cancelled",
  "skipped",
])


export type AttachedTaskSettlement =
  | { readonly nodeId: DagNodeId; readonly kind: "record"; readonly record: TaskRecord }
  | { readonly nodeId: DagNodeId; readonly kind: "error"; readonly error: unknown }

export type AttachedTask = {
  readonly nodeId: DagNodeId
  readonly settled: Promise<AttachedTaskSettlement>
  readonly folded: Promise<void>
  readonly resolveFolded: () => void
}

export type PendingTerminalResult = {
  readonly record: TaskRecord
}

export type DagNodeWithResult = DagNode & {
  readonly resultArtifact?: DagNodeResultArtifact
}

export type SchedulerContext = {
  readonly infrastructureRetries: InfrastructureRetries
  readonly taskManager: TaskManager
  readonly journal: DagJournal<DagRunRecordV1>
  readonly definitionNodes: ReadonlyMap<string, DagPersistedNode>
  readonly executionMode?: Omit<DagExecutionModeSources, "route">
  readonly ancestry?: { readonly depth: number }
  readonly nodeSpawnPolicy?: DagNodeSpawnPolicy
  readonly now: () => number
  readonly pendingErrors: Map<DagNodeId, DagNodeError>
  readonly pendingTerminalResults: Map<DagNodeId, PendingTerminalResult>
  readonly attachedTaskIds: Map<DagNodeId, string>
  readonly attachedTasks: Map<DagNodeId, AttachedTask>
  readonly settlementChanged: () => Promise<void>
  readonly resolveSettlementChanged: () => void
  readonly cancellationRequested: Promise<void>
  readonly resolveCancellationRequested: () => void
  readonly cancellationCompleted: Promise<void>
  readonly resolveCancellationCompleted: () => void
  cancellationStarted: boolean
  suspended: boolean
  // #7412: set by the foreign-commit subscription so a wake that fired while no settle race was
  // armed is not lost - settleOne consumes it level-triggered.
  foreignSettlement: boolean
  cancellationOperation?: Promise<void>
  admissionInProgress: boolean
  readonly admissionIdleWaiters: Set<() => void>
  // Residency-denied nodes waiting for a free slot, in first-denied order: a slot freed by a
  // settlement is offered to the OLDEST denied admission before any newly ready node.
  pendingAdmission: DagNodeId[]
  // Nodes whose first residency denial has already been journaled as residency_queued: the wait
  // can re-deny a node many times, the explanation is written once (#8396).
  readonly residencyQueued: Set<DagNodeId>
  // Wave events are informational groupings over frontier admission, never barriers: admission
  // remembers which wave indexes this instance reported so each index completes at most once.
  readonly emittedWaveAdmissions: Set<number>
  readonly emittedWaveCompletions: Set<number>
  // Per-node child subscriptions armed for queued spawns (start returned status "pending"):
  // waitFor resolves only at terminal, so this watch is the only signal that folds the task
  // engine's later queue promotion into a scheduled -> running node transition.
  readonly promotionWatches: Map<DagNodeId, () => void>
}

export function nodeById(record: DagRunRecordV1, nodeId: DagNodeId): DagNode {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throw new Error(`unknown DAG node "${nodeId}"`)
  return node
}

export function transition(
  context: SchedulerContext,
  nodeId: DagNodeId,
  to: DagNodeState,
  reason: DagNodeTransitionReason,
): void {
  const from = nodeById(context.journal.snapshot(), nodeId).state
  context.journal.append(dagNodeTransitionedEvent({ nodeId, from, to, reason }))
}

export function failNode(context: SchedulerContext, nodeId: DagNodeId, code: DagNodeErrorCode, message: string): void {
  context.pendingErrors.set(nodeId, nodeError(nodeId, code, message, context.now))
  transition(context, nodeId, "failed", { kind: "failed" })
  context.pendingErrors.delete(nodeId)
}

export function nodeError(nodeId: DagNodeId, code: DagNodeErrorCode, message: string, now: () => number): DagNodeError {
  return { code, message, nodeId, at: new Date(now()).toISOString() }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function deferredSignal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export function repeatableSignal(): { readonly wait: () => Promise<void>; readonly resolve: () => void } {
  let signal = deferredSignal()
  return {
    wait: () => signal.promise,
    resolve: () => {
      const current = signal
      signal = deferredSignal()
      current.resolve()
    },
  }
}

export function countNodes(nodes: readonly DagNode[]): DagNodeCounts {
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
