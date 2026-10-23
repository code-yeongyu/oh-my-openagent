import type { TaskManager } from "../manager/types"
import type { DagExecutionModeSources } from "./execution-mode"
import { createDagJournal, subscribeDagJournal, type DagJournalListener } from "./journal"
import { skipDuplicateTerminalTransition, type DagMaterializeSkills, type DagRunRecordV1 } from "./manager"
import { retryDagNodes, type DagRetryOptions, type DagRunReentry } from "./node-retry"
import { sendToDagNode, type DagNodeSendResult } from "./node-send"
import type { DagFileStore } from "./store"
import type { DagNodeError, DagNodeId, DagRunId } from "./types"
import { deferredSignal, repeatableSignal, TERMINAL_NODE_STATES, type PendingTerminalResult, type SchedulerContext } from "./scheduler-context"
import { applyDagSchedulerEvent } from "./scheduler-projection"
import { cancelRun, whenAdmissionIdle } from "./scheduler-cancellation"
import { runFrontier } from "./scheduler-frontier"
import { attachTaskSettlement, watchRevivedInScheduler, disposePromotionWatch } from "./scheduler-task-attachment"
import { createInfrastructureRetries, type RetrySchedule } from "./infrastructure-retry"
export { applyDagSchedulerEvent } from "./scheduler-projection"
export { DAG_NODE_CONTROL_ERROR_CODES, DagNodeControlError } from "./node-control-context"
export type { DagNodeControlErrorCode } from "./node-control-context"
export { reenterDagRun } from "./node-retry"
export type { DagRetryOptions, DagRunReentry } from "./node-retry"
export type { DagNodeSendResult } from "./node-send"

export type DagSchedulerOptions = {
  readonly store: DagFileStore
  readonly taskManager: TaskManager
  readonly initialRecord: DagRunRecordV1
  readonly executionMode?: Omit<DagExecutionModeSources, "route">
  readonly ancestry?: { readonly depth: number }
  readonly subscriberRing?: number
  readonly nodeSpawnPolicy?: DagNodeSpawnPolicy
  /**
   * Children that are ALREADY running under a durable owner when this scheduler is built - a
   * session restart reattaches them instead of waiting for them. Each entry is folded into the
   * live settle loop exactly like an admitted node, so recovery never has to block on a
   * long-running child before the run leaves `paused`.
   */
  readonly preAttachedTasks?: ReadonlyMap<DagNodeId, string>
  // Skill materialization for a retry that carries a prompt override (it re-runs the amend path).
  readonly materializeSkills?: DagMaterializeSkills
  // Lease identity for the control verbs: a run leased by a DIFFERENT live process is not ours to
  // retry. Defaults to this process and the lifecycle port's signal-0 probe.
  readonly hostPid?: number
  readonly isProcessAlive?: (pid: number) => boolean
  readonly now?: () => number
  readonly scheduleRetry?: RetrySchedule
}

// Harness-injected gate for agent-routed nodes, evaluated once per admission before startOwned:
// the dag path must honor the same spawn restrictions (plan gate, prompt contracts) as direct
// task spawns instead of bypassing them through the scheduler.
export type DagNodeSpawnPolicyVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly message: string }
  | { readonly kind: "force"; readonly prompt: string }

export type DagNodeSpawnPolicy = (node: {
  readonly nodeId: DagNodeId
  readonly subagentType: string
  readonly prompt: string
  readonly parentSessionId: string
}) => DagNodeSpawnPolicyVerdict

export type DagScheduler = {
  readonly run: () => Promise<DagRunRecordV1>
  readonly cancel: (runId: DagRunId, reason?: string) => Promise<void>
  /** Retires this controller without cancelling children; await before releasing its lease. */
  readonly suspend: () => Promise<void>
  readonly snapshot: () => DagRunRecordV1
  readonly subscribe: (listener: DagJournalListener) => () => void
  readonly whenIdle: () => Promise<void>
  /**
   * Returns failed, cancelled, or skipped nodes to a fresh attempt and re-enters the run through a
   * NEW scheduler. Safe to call on a settled instance: it reads the durable record, not this
   * instance's spent state machine.
   */
  readonly retryNode: (
    runId: DagRunId,
    nodeIds?: readonly DagNodeId[],
    options?: DagRetryOptions,
  ) => DagRunReentry
  /** Steers a running child, revives a finished resident one, or refuses with node_not_continuable. */
  readonly sendToNode: (runId: DagRunId, nodeId: DagNodeId, message: string) => Promise<DagNodeSendResult>
}

type DagSchedulerObserver = (scheduler: DagScheduler) => void

const schedulerObservers = new WeakMap<TaskManager, Set<DagSchedulerObserver>>()

export function observeDagSchedulers(taskManager: TaskManager, observer: DagSchedulerObserver): () => void {
  const observers = schedulerObservers.get(taskManager) ?? new Set<DagSchedulerObserver>()
  observers.add(observer)
  schedulerObservers.set(taskManager, observers)
  return () => {
    observers.delete(observer)
    if (observers.size === 0) schedulerObservers.delete(taskManager)
  }
}

export function createDagScheduler(options: DagSchedulerOptions): DagScheduler {
  const now = options.now ?? Date.now
  const pendingErrors = new Map<DagNodeId, DagNodeError>()
  const pendingTerminalResults = new Map<DagNodeId, PendingTerminalResult>()
  const cancellationRequested = deferredSignal()
  const cancellationCompleted = deferredSignal()
  const settlementChanged = repeatableSignal()
  const journal = createDagJournal<DagRunRecordV1>({
    store: options.store,
    runId: options.initialRecord.runId,
    initialCheckpoint: options.initialRecord,
    applyEvent: (record, event) => applyDagSchedulerEvent(
      record,
      event,
      pendingErrors,
      { store: options.store, pendingTerminalResults, now },
    ),
    ...(options.subscriberRing === undefined ? {} : { subscriberRing: options.subscriberRing }),
    now,
    skipDuplicate: skipDuplicateTerminalTransition,
  })
  const context: SchedulerContext = {
    infrastructureRetries: createInfrastructureRetries(options, journal, settlementChanged.resolve),
    taskManager: options.taskManager,
    journal,
    definitionNodes: new Map(options.initialRecord.definition.nodes.map((node) => [node.id, node])),
    ...(options.executionMode === undefined ? {} : { executionMode: options.executionMode }),
    ...(options.ancestry === undefined ? {} : { ancestry: options.ancestry }),
    ...(options.nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy: options.nodeSpawnPolicy }),
    now,
    pendingErrors,
    pendingTerminalResults,
    attachedTaskIds: new Map(),
    attachedTasks: new Map(),
    settlementChanged: settlementChanged.wait,
    resolveSettlementChanged: settlementChanged.resolve,
    cancellationRequested: cancellationRequested.promise,
    resolveCancellationRequested: cancellationRequested.resolve,
    cancellationCompleted: cancellationCompleted.promise,
    resolveCancellationCompleted: cancellationCompleted.resolve,
    cancellationStarted: false,
    suspended: false,
    foreignSettlement: false,
    admissionInProgress: false,
    admissionIdleWaiters: new Set(),
    pendingAdmission: [],
    residencyQueued: new Set<DagNodeId>(),
    emittedWaveAdmissions: new Set<number>(),
    emittedWaveCompletions: new Set<number>(),
    promotionWatches: new Map<DagNodeId, () => void>(),
  }
  // #7412 defect 1: control verbs (send/revive watchers, retry) commit through their OWN journal
  // instance, and a journal cache refreshes only on its own appends. Without this subscription a
  // foreign-journaled completion neither refreshes the live scheduler's snapshot nor wakes its
  // admission loop - a journaled-completion-but-starved-dependent stall. Foreign commits refresh
  // the cache; terminal node transitions additionally wake the settle loop. The subscription
  // retires once the run record is terminal.
  const unsubscribeCommits = subscribeDagJournal(options.store, options.initialRecord.runId, (event) => {
    if (event.seq > journal.snapshot().checkpointSeq) {
      journal.refresh()
      if (event.type === "dag.node.transitioned" && TERMINAL_NODE_STATES.has(event.to)) {
        context.foreignSettlement = true
        context.resolveSettlementChanged()
      }
    }
    const status = journal.snapshot().status
    if (status === "completed" || status === "failed" || status === "cancelled") unsubscribeCommits()
  })
  for (const [nodeId, taskId] of options.preAttachedTasks ?? []) {
    context.attachedTaskIds.set(nodeId, taskId)
    attachTaskSettlement(context, nodeId, taskId)
  }

  let running: Promise<DagRunRecordV1> | undefined
  const scheduler: DagScheduler = {
    run: () => running ??= runFrontier(context),
    cancel: (runId, reason) => cancelRun(context, runId, reason),
    suspend: async () => {
      context.suspended = true
      context.infrastructureRetries.cancelPendingTimers()
      context.resolveCancellationRequested()
      unsubscribeCommits()
      for (const nodeId of [...context.promotionWatches.keys()]) disposePromotionWatch(context, nodeId)
      await whenAdmissionIdle(context)
      if (context.cancellationOperation !== undefined) await context.cancellationOperation
      await journal.whenIdle()
      for (const task of context.attachedTasks.values()) task.resolveFolded()
      context.attachedTasks.clear()
      context.attachedTaskIds.clear()
    },
    snapshot: journal.snapshot,
    subscribe: journal.subscribe,
    whenIdle: journal.whenIdle,
    retryNode: (runId, nodeIds, retryOptions) => retryDagNodes(options, runId, nodeIds, retryOptions),
    sendToNode: (runId, nodeId, message) => sendToDagNode(
      options,
      runId,
      nodeId,
      message,
      // Refresh, not snapshot: a control-journal commit may still be a microtask away from the
      // subscription callback, and routing a revive off a stale status was half of dag_923ad20e.
      (revivedNodeId, taskId) => context.journal.refresh().status === "running"
        ? watchRevivedInScheduler(context, revivedNodeId, taskId)
        : undefined,
    ),
  }
  for (const observer of schedulerObservers.get(options.taskManager) ?? []) observer(scheduler)
  return scheduler
}
