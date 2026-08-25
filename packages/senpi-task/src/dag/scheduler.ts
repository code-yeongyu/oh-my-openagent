// allow: SIZE_OK - the admission loop, event reducer, and task outcome folding stay together so the strict barrier cannot be bypassed by callers.
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { relative } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { resolveDagNodeExecutionMode, type DagExecutionModeSources } from "./execution-mode"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import {
  dagNodeTaskAttachedEvent,
  dagNodeTransitionedEvent,
  dagRunCancelledEvent,
  dagRunCompletedEvent,
  dagRunFailedEvent,
  dagRunStartedEvent,
  dagWaveCompletedEvent,
  dagWaveStartedEvent,
} from "./events"
import { createDagJournal, type DagJournal, type DagJournalListener } from "./journal"
import { applyDagRunMutation, type DagMaterializeSkills, type DagPersistedNode, type DagRunRecordV1 } from "./manager"
import { retryDagNodes, type DagRetryOptions, type DagRunReentry } from "./node-retry"
import { sendToDagNode, type DagNodeSendResult } from "./node-send"
import type { OwnedStartResult } from "./owner"
import { persistDagNodeResult, readDagNodeResult, type DagNodeResultArtifact } from "./results"
import type { DagFileStore } from "./store"
import type {
  DagNode,
  DagNodeCounts,
  DagNodeError,
  DagNodeErrorCode,
  DagNodeId,
  DagNodeState,
  DagNodeTransitionReason,
  DagRunEvent,
  DagRunId,
} from "./types"

// The per-node control verbs live beside the scheduler but keep one public entry point: callers
// import the whole run surface (run, cancel, retry, send, re-entry) from here.
export { DAG_NODE_CONTROL_ERROR_CODES, DagNodeControlError } from "./node-control-context"
export type { DagNodeControlErrorCode } from "./node-control-context"
export { reenterDagRun } from "./node-retry"
export type { DagRetryOptions, DagRunReentry } from "./node-retry"
export type { DagNodeSendResult } from "./node-send"

const TERMINAL_NODE_STATES: ReadonlySet<DagNodeState> = new Set([
  "completed",
  "failed",
  "cancelled",
  "skipped",
])

export type DagSchedulerOptions = {
  readonly store: DagFileStore
  readonly taskManager: TaskManager
  readonly initialRecord: DagRunRecordV1
  readonly executionMode?: Omit<DagExecutionModeSources, "route">
  readonly ancestry?: { readonly depth: number }
  readonly subscriberRing?: number
  readonly nodeSpawnPolicy?: DagNodeSpawnPolicy
  // Skill materialization for a retry that carries a prompt override (it re-runs the amend path).
  readonly materializeSkills?: DagMaterializeSkills
  // Lease identity for the control verbs: a run leased by a DIFFERENT live process is not ours to
  // retry. Defaults to this process and the lifecycle port's signal-0 probe.
  readonly hostPid?: number
  readonly isProcessAlive?: (pid: number) => boolean
  readonly now?: () => number
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

type AttachedTaskSettlement =
  | { readonly nodeId: DagNodeId; readonly kind: "record"; readonly record: TaskRecord }
  | { readonly nodeId: DagNodeId; readonly kind: "error"; readonly error: unknown }

type AttachedTask = {
  readonly nodeId: DagNodeId
  readonly settled: Promise<AttachedTaskSettlement>
  readonly folded: Promise<void>
  readonly resolveFolded: () => void
}

type PendingTerminalResult = {
  readonly record: TaskRecord
}

type DagNodeWithResult = DagNode & {
  readonly resultArtifact?: DagNodeResultArtifact
}

type SchedulerContext = {
  readonly taskManager: TaskManager
  readonly journal: DagJournal<DagRunRecordV1>
  readonly definitionNodes: ReadonlyMap<DagNodeId, DagPersistedNode>
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
  cancellationOperation?: Promise<void>
  admissionInProgress: boolean
  readonly admissionIdleWaiters: Set<() => void>
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
  })
  const context: SchedulerContext = {
    taskManager: options.taskManager,
    journal,
    definitionNodes: new Map(options.initialRecord.definition.nodes.map((node) => [node.id as DagNodeId, node])),
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
    admissionInProgress: false,
    admissionIdleWaiters: new Set(),
  }

  const scheduler: DagScheduler = {
    run: () => runWaves(context),
    cancel: (runId, reason) => cancelRun(context, runId, reason),
    snapshot: journal.snapshot,
    subscribe: journal.subscribe,
    whenIdle: journal.whenIdle,
    retryNode: (runId, nodeIds, retryOptions) => retryDagNodes(options, runId, nodeIds, retryOptions),
    sendToNode: (runId, nodeId, message) => sendToDagNode(
      options,
      runId,
      nodeId,
      message,
      (revivedNodeId, taskId) => context.journal.snapshot().status === "running"
        ? watchRevivedInScheduler(context, revivedNodeId, taskId)
        : undefined,
    ),
  }
  for (const observer of schedulerObservers.get(options.taskManager) ?? []) observer(scheduler)
  return scheduler
}

export function applyDagSchedulerEvent(
  record: DagRunRecordV1,
  event: DagRunEvent,
  pendingErrors: ReadonlyMap<DagNodeId, DagNodeError> = new Map(),
  terminalResults?: {
    readonly store: DagFileStore
    readonly pendingTerminalResults: Map<DagNodeId, PendingTerminalResult>
    readonly now: () => number
  },
): DagRunRecordV1 {
  switch (event.type) {
    case "dag.run.started":
      return {
        ...record,
        status: "running",
        startedAt: record.startedAt ?? event.at,
        updatedAt: event.at,
      }
    case "dag.run.completed":
      return { ...record, status: "completed", completedAt: event.at, updatedAt: event.at }
    case "dag.run.failed":
      return { ...record, status: "failed", completedAt: event.at, updatedAt: event.at }
    case "dag.run.cancelled":
      return { ...record, status: "cancelled", completedAt: event.at, updatedAt: event.at }
    case "dag.node.transitioned": {
      const terminalResult = TERMINAL_NODE_STATES.has(event.to)
        ? terminalResults?.pendingTerminalResults.get(event.nodeId)
        : undefined
      const replayedResult = terminalResult === undefined && terminalResults !== undefined && event.to === "completed"
        ? replayDagNodeResult(terminalResults.store, record.runId, event.nodeId)
        : undefined
      const persisted = terminalResult === undefined || terminalResults === undefined
        ? replayedResult === undefined ? undefined : { kind: "persisted" as const, artifact: replayedResult.artifact }
        : persistDagNodeResult({
            store: terminalResults.store,
            runId: record.runId,
            nodeId: event.nodeId,
            record: terminalResult.record,
            now: terminalResults.now,
          })
      terminalResults?.pendingTerminalResults.delete(event.nodeId)
      return {
        ...record,
        nodes: record.nodes.map((node) => {
          if (node.id !== event.nodeId) return node
          const transitioned: DagNodeWithResult = transitionedNode(
            node,
            event.to,
            event.at,
            pendingErrors.get(event.nodeId),
          )
          if (persisted?.kind !== "persisted") return transitioned
          return {
            ...transitioned,
            resultArtifact: persisted.artifact,
            ...(terminalResult?.record.run_stats === undefined && replayedResult?.runStats === undefined
              ? {}
              : { runStats: terminalResult?.record.run_stats ?? replayedResult?.runStats }),
          }
        }),
        diagnostics: persisted?.kind === "failed"
          ? [
              ...record.diagnostics,
              {
                kind: "journal_corrupt",
                ...(persisted.diagnostic.runId === undefined ? {} : { runId: persisted.diagnostic.runId }),
                path: persisted.diagnostic.path,
                message: persisted.diagnostic.message,
                at: persisted.diagnostic.at,
              },
            ]
          : record.diagnostics,
        updatedAt: event.at,
      }
    }
    case "dag.node.task-attached":
      return {
        ...record,
        nodes: record.nodes.map((node) => node.id === event.nodeId
          ? { ...node, taskId: event.taskId, attempt: event.attempt }
          : node),
        updatedAt: event.at,
      }
    // Re-entry rearms the run: completedAt is stamped on every terminal status above, so leaving it
    // in place would report a settle that no longer describes this run through projectSnapshot.
    case "dag.run.resumed": {
      const { completedAt: _completedAt, ...running } = record
      return { ...running, status: "running", generation: event.generation, updatedAt: event.at }
    }
    // A revived child runs again on its own session: no new task, no attempt bump, just the node
    // leaving its terminal state so the revive watcher can fold the new outcome.
    case "dag.node.steered":
      if (event.delivery !== "revive") return { ...record, updatedAt: event.at }
      return {
        ...record,
        nodes: record.nodes.map((node) => node.id === event.nodeId ? { ...node, taskId: event.taskId } : node),
        updatedAt: event.at,
      }
    // The retry and amend record mutations live in ONE shared reducer with the manager so a journal
    // replay through either entry point rebuilds an identical checkpoint.
    case "dag.node.retried":
    case "dag.definition.amended":
      return { ...applyDagRunMutation(record, event), updatedAt: event.at }
    default:
      return { ...record, updatedAt: event.at }
  }
}

function replayDagNodeResult(
  store: DagFileStore,
  runId: DagRunId,
  nodeId: DagNodeId,
): { readonly artifact: DagNodeResultArtifact; readonly runStats?: TaskRecord["run_stats"] } | undefined {
  const result = readDagNodeResult({ store, runId, nodeId })
  if (result === null) return undefined
  const outputPath = store.paths.result(runId, nodeId)
  const output = fs.readFileSync(outputPath, "utf8")
  const statsPath = outputPath.replace(/\.txt$/, ".stats.json")
  const stats = readOptionalArtifact(store, statsPath)
  return {
    artifact: {
      ...artifactRef(store, outputPath, output),
      ...(stats === undefined ? {} : { stats }),
    },
    ...(result.runStats === undefined ? {} : { runStats: result.runStats }),
  }
}

function readOptionalArtifact(
  store: DagFileStore,
  path: string,
): DagNodeResultArtifact["stats"] | undefined {
  try {
    return artifactRef(store, path, fs.readFileSync(path, "utf8"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

function artifactRef(store: DagFileStore, path: string, contents: string): {
  readonly relativePath: string
  readonly sha256: string
  readonly bytes: number
} {
  return {
    relativePath: relative(store.stateDir, path),
    sha256: createHash("sha256").update(contents, "utf8").digest("hex"),
    bytes: Buffer.byteLength(contents, "utf8"),
  }
}

async function cancelRun(context: SchedulerContext, runId: DagRunId, reason?: string): Promise<void> {
  const snapshot = context.journal.snapshot()
  if (snapshot.runId !== runId) throw new Error(`scheduler does not own DAG run "${runId}"`)
  if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") return
  if (context.cancellationOperation !== undefined) return context.cancellationOperation

  context.cancellationStarted = true
  context.resolveCancellationRequested()
  context.cancellationOperation = performCancellation(context, reason)
  return context.cancellationOperation
}

async function performCancellation(context: SchedulerContext, reason?: string): Promise<void> {
  try {
    await whenAdmissionIdle(context)
    const cancellationResults = await Promise.allSettled([...context.attachedTaskIds.values()].map((taskId) =>
      context.taskManager.cancelTask(taskId, reason, { abort: "skip" }),
    ))
    const cancellationFailure = cancellationResults.find((result) => result.status === "rejected")
    const cancelledNodeIds: DagNodeId[] = []
    for (const node of context.journal.snapshot().nodes) {
      if (TERMINAL_NODE_STATES.has(node.state)) continue
      transition(context, node.id, "cancelled", { kind: "cancelled" })
      cancelledNodeIds.push(node.id)
    }
    const cancelled = context.journal.snapshot()
    context.journal.append(Object.assign(
      dagRunCancelledEvent({ reason, counts: countNodes(cancelled.nodes) }),
      { cancelledNodeIds },
    ))
    context.attachedTaskIds.clear()
    if (cancellationFailure?.status === "rejected") throw cancellationFailure.reason
  } finally {
    context.resolveCancellationCompleted()
  }
}

async function cancelledSnapshot(context: SchedulerContext): Promise<DagRunRecordV1> {
  await context.cancellationCompleted
  return context.journal.snapshot()
}

function whenAdmissionIdle(context: SchedulerContext): Promise<void> {
  if (!context.admissionInProgress) return Promise.resolve()
  return new Promise<void>((resolve) => context.admissionIdleWaiters.add(resolve))
}

function resolveAdmissionIdle(context: SchedulerContext): void {
  for (const resolve of context.admissionIdleWaiters) resolve()
  context.admissionIdleWaiters.clear()
}

async function runWaves(context: SchedulerContext): Promise<DagRunRecordV1> {
  if (context.journal.snapshot().status === "pending") {
    context.journal.append(dagRunStartedEvent({ generation: context.journal.snapshot().generation }))
  }

  for (;;) {
    for (const wave of context.journal.snapshot().waves) {
      if (context.cancellationStarted) return cancelledSnapshot(context)
      applyDependentSkipCascade(context)
      const runnable = wave.nodeIds.filter((nodeId) => isRunnable(context.journal.snapshot(), nodeId))
      if (runnable.length === 0) continue

      for (const nodeId of runnable) transition(context, nodeId, "scheduled", { kind: "scheduled" })
      context.journal.append(dagWaveStartedEvent({ waveIndex: wave.index, nodeIds: runnable }))
      if (!await admitAndSettleWave(context, runnable)) return cancelledSnapshot(context)
      context.journal.append(dagWaveCompletedEvent({ waveIndex: wave.index, nodeIds: runnable }))
    }

    applyDependentSkipCascade(context)
    const current = context.journal.snapshot()
    if (current.nodes.every((node) => TERMINAL_NODE_STATES.has(node.state))) break
    if (context.attachedTasks.size === 0) {
      throw new Error(`DAG run "${current.runId}" cannot terminalize while nodes are active`)
    }
    while (context.attachedTasks.size > 0) {
      if (!await settleOne(context)) return cancelledSnapshot(context)
    }
  }

  const snapshot = context.journal.snapshot()
  const failed = primaryFailure(snapshot)
  if (failed !== undefined) {
    const error = failed.error ?? nodeError(failed.id, "start_failed", "DAG node failed", context.now)
    context.journal.append(dagRunFailedEvent({ error, counts: countNodes(snapshot.nodes) }))
  } else {
    context.journal.append(dagRunCompletedEvent({ counts: countNodes(snapshot.nodes) }))
  }
  return context.journal.snapshot()
}

async function admitAndSettleWave(context: SchedulerContext, nodeIds: readonly DagNodeId[]): Promise<boolean> {
  let awaitingAdmission = [...nodeIds]
  const attached = context.attachedTasks

  while (awaitingAdmission.length > 0) {
    if (context.cancellationStarted) return false
    context.admissionInProgress = true
    let results: PromiseSettledResult<{ readonly nodeId: DagNodeId; readonly result: OwnedStartResult }>[]
    try {
      results = await Promise.allSettled(awaitingAdmission.map(async (nodeId) => ({
        nodeId,
        result: await context.taskManager.startOwned(startSpec(context, nodeId), owner(context, nodeId)),
      })))
    } finally {
      context.admissionInProgress = false
      resolveAdmissionIdle(context)
    }
    const denied: DagNodeId[] = []
    for (let index = 0; index < results.length; index += 1) {
      const settled = results[index]
      const nodeId = awaitingAdmission[index]
      if (settled === undefined || nodeId === undefined) throw new Error("DAG admission result lost its node")
      if (settled.status === "rejected") {
        if (!context.cancellationStarted) failNode(context, nodeId, "start_failed", errorMessage(settled.reason))
        continue
      }
      const { result } = settled.value
      if (context.cancellationStarted) {
        if (result.kind === "started") attachStarted(context, nodeId, result)
      } else if (result.kind === "residency_denied") {
        denied.push(nodeId)
      } else {
        attachOrFail(context, nodeId, result)
      }
    }
    if (context.cancellationStarted) return false
    awaitingAdmission = denied
    if (awaitingAdmission.length === 0) break
    if (attached.size === 0) {
      for (const nodeId of awaitingAdmission) {
        failNode(context, nodeId, "residency_denied", "resident child cap reached and no task can free a slot")
      }
      awaitingAdmission = []
      break
    }
    await settleOne(context)
  }

  while (attached.size > 0) {
    if (!await settleOne(context)) return false
  }
  return true
}

function attachOrFail(
  context: SchedulerContext,
  nodeId: DagNodeId,
  result: Exclude<OwnedStartResult, { readonly kind: "residency_denied" }>,
): void {
  if (result.kind !== "started") {
    const failure = startFailure(result)
    failNode(context, nodeId, failure.code, failure.message)
    return
  }

  attachStarted(context, nodeId, result)
}

function attachStarted(
  context: SchedulerContext,
  nodeId: DagNodeId,
  result: Extract<OwnedStartResult, { readonly kind: "started" }>,
): void {
  const node = nodeById(context.journal.snapshot(), nodeId)
  const attempt = node.attempt + 1
  context.journal.append(dagNodeTaskAttachedEvent({ nodeId, taskId: result.task_id, attempt }))
  if (result.status === "pending") {
    if (!result.reused && result.queue_position !== undefined) {
      context.journal.append({
        type: "dag.node.transitioned",
        nodeId,
        from: "scheduled",
        to: "scheduled",
        reason: { kind: "task_queued", queuePosition: result.queue_position },
      })
    }
  } else if (result.status === "running") {
    transition(context, nodeId, "running", result.reused ? { kind: "resumed" } : { kind: "started" })
  }
  context.attachedTaskIds.set(nodeId, result.task_id)
  attachTaskSettlement(context, nodeId, result.task_id)
}

function attachTaskSettlement(context: SchedulerContext, nodeId: DagNodeId, taskId: string): AttachedTask {
  const folded = deferredSignal()
  const task: AttachedTask = {
    nodeId,
    settled: context.taskManager.waitFor(taskId).then(
      (record): AttachedTaskSettlement => ({ nodeId, kind: "record", record }),
      (error: unknown): AttachedTaskSettlement => ({ nodeId, kind: "error", error }),
    ),
    folded: folded.promise,
    resolveFolded: folded.resolve,
  }
  context.attachedTasks.set(nodeId, task)
  context.resolveSettlementChanged()
  return task
}

async function watchRevivedInScheduler(
  context: SchedulerContext,
  nodeId: DagNodeId,
  taskId: string,
): Promise<void> {
  context.attachedTaskIds.set(nodeId, taskId)
  const task = attachTaskSettlement(context, nodeId, taskId)
  await task.folded
}

async function settleOne(context: SchedulerContext): Promise<boolean> {
  const settled = await Promise.race([
    ...[...context.attachedTasks.values()].map((entry) => entry.settled),
    context.settlementChanged().then(() => null),
    context.cancellationRequested.then(() => undefined),
  ])
  if (settled === null) return true
  if (settled === undefined || context.cancellationStarted) return false
  const task = context.attachedTasks.get(settled.nodeId)
  context.attachedTasks.delete(settled.nodeId)
  context.attachedTaskIds.delete(settled.nodeId)
  try {
    if (settled.kind === "error") {
      failNode(context, settled.nodeId, "task_error", errorMessage(settled.error))
    } else {
      foldTaskOutcome(context, settled.nodeId, settled.record)
    }
  } finally {
    task?.resolveFolded()
  }
  return true
}

function foldTaskOutcome(context: SchedulerContext, nodeId: DagNodeId, task: TaskRecord): void {
  if (task.status === "pending" || task.status === "running") {
    throw new Error(`TaskManager.waitFor returned nonterminal task ${task.task_id}`)
  }
  context.pendingTerminalResults.set(nodeId, { record: task })
  if (task.status === "completed") {
    transition(context, nodeId, "completed", { kind: "succeeded" })
    return
  }
  const failure = taskFailure(task.status, task.error_message)
  failNode(context, nodeId, failure.code, failure.message)
}

function applyDependentSkipCascade(context: SchedulerContext): void {
  let changed = true
  while (changed) {
    changed = false
    const snapshot = context.journal.snapshot()
    for (const node of snapshot.nodes) {
      if (node.state !== "pending" && node.state !== "blocked") continue
      const dependencies = node.dependsOn.map((nodeId) => nodeById(snapshot, nodeId))
      if (dependencies.some((dependency) => TERMINAL_NODE_STATES.has(dependency.state) && dependency.state !== "completed")) {
        transition(context, node.id, "skipped", { kind: "skipped" })
        changed = true
      }
    }
  }
}

function isRunnable(record: DagRunRecordV1, nodeId: DagNodeId): boolean {
  const node = nodeById(record, nodeId)
  return (node.state === "pending" || node.state === "blocked") &&
    node.dependsOn.every((dependencyId) => nodeById(record, dependencyId).state === "completed")
}

function transition(
  context: SchedulerContext,
  nodeId: DagNodeId,
  to: DagNodeState,
  reason: DagNodeTransitionReason,
): void {
  const from = nodeById(context.journal.snapshot(), nodeId).state
  context.journal.append(dagNodeTransitionedEvent({ nodeId, from, to, reason }))
}

function failNode(context: SchedulerContext, nodeId: DagNodeId, code: DagNodeErrorCode, message: string): void {
  context.pendingErrors.set(nodeId, nodeError(nodeId, code, message, context.now))
  transition(context, nodeId, "failed", { kind: "failed" })
  context.pendingErrors.delete(nodeId)
}

function startSpec(context: SchedulerContext, nodeId: DagNodeId): ManagerStartSpec {
  const record = context.journal.snapshot()
  const node = nodeById(record, nodeId)
  const persisted = context.definitionNodes.get(nodeId)
  if (persisted === undefined) throw new Error(`missing persisted definition for DAG node "${nodeId}"`)
  const spec: ManagerStartSpec = {
    prompt: persisted.effectivePrompt,
    ...(persisted.task_summary === undefined ? {} : { task_summary: persisted.task_summary }),
    parent_session_id: record.parentSessionId,
    root_session_id: record.rootSessionId,
    depth: (context.ancestry?.depth ?? 0) + 1,
    ...(context.executionMode === undefined
      ? {}
      : {
          execution_mode: resolveDagNodeExecutionMode({
            route: node.route,
            agents: context.executionMode.agents,
            config: context.executionMode.config,
          }),
        }),
    ...(node.route.kind === "category"
      ? { category: node.route.category }
      : { subagent_type: node.route.agent, ...(node.route.model === undefined ? {} : { model: node.route.model }) }),
    name: node.id,
    ...(persisted.description === undefined ? {} : { description: persisted.description }),
    run_in_background: true,
  }
  if (node.route.kind !== "category" && context.nodeSpawnPolicy !== undefined) {
    const verdict = context.nodeSpawnPolicy({
      nodeId,
      subagentType: node.route.agent,
      prompt: spec.prompt,
      parentSessionId: record.parentSessionId,
    })
    if (verdict.kind === "deny") {
      throw new Error(`DAG node "${nodeId}" denied by spawn policy: ${verdict.message}`)
    }
    if (verdict.kind === "force") return { ...spec, prompt: verdict.prompt }
  }
  return spec
}

function owner(context: SchedulerContext, nodeId: DagNodeId) {
  const record = context.journal.snapshot()
  const execAttempt = nodeById(record, nodeId).execAttempt
  return {
    kind: "dag" as const,
    runId: record.runId,
    nodeId,
    // execAttempt (NOT the display attempt) scopes the owner identity: a retried or
    // amend-invalidated node claims a new one, while an untouched node keeps the legacy value.
    fingerprint: dagFingerprint(ownerFingerprintInput({
      definitionFingerprint: record.definitionFingerprint,
      nodeId,
      ...(execAttempt === undefined ? {} : { execAttempt }),
    })),
  }
}

function startFailure(result: Exclude<OwnedStartResult, { readonly kind: "started" | "residency_denied" }>): {
  readonly code: DagNodeErrorCode
  readonly message: string
} {
  switch (result.kind) {
    case "depth_denied":
      return { code: "depth_denied", message: result.reason }
    case "plan_unresolved":
      return { code: "plan_unresolved", message: result.error.message }
    case "start_failed":
      return { code: "start_failed", message: result.error_message }
    case "owner_conflict":
      return { code: "start_failed", message: `DAG task owner conflicts with existing task ${result.task_id}` }
  }
}

function taskFailure(status: Exclude<TaskStatus, "completed" | "pending" | "running">, message?: string): {
  readonly code: DagNodeErrorCode
  readonly message: string
} {
  switch (status) {
    case "error":
      return { code: "task_error", message: message ?? "task failed" }
    case "interrupted":
      return { code: "task_interrupted", message: message ?? "task was interrupted" }
    case "lost":
      return { code: "task_lost", message: message ?? "task was lost" }
    case "cancelled":
      return { code: "task_cancelled", message: message ?? "task was cancelled" }
  }
}

function transitionedNode(node: DagNode, state: DagNodeState, at: string, error?: DagNodeError): DagNode {
  // Leaving a terminal state for a new execution (a revived child) drops the previous outcome:
  // error, completion time, and result metadata all describe the attempt that just ended, and the
  // durable artifact stays readable on disk until the new attempt overwrites it.
  const base = state === "running" && TERMINAL_NODE_STATES.has(node.state)
    ? clearedTerminalOutcome(node)
    : node
  return {
    ...base,
    state,
    ...(state === "running" && node.startedAt === undefined ? { startedAt: at } : {}),
    ...(TERMINAL_NODE_STATES.has(state) ? { completedAt: at } : {}),
    ...(error === undefined ? {} : { error }),
  }
}

function clearedTerminalOutcome(node: DagNode): DagNode {
  const {
    error: _error,
    completedAt: _completedAt,
    runStats: _runStats,
    resultArtifact: _resultArtifact,
    ...cleared
  } = node as DagNodeWithResult
  return cleared
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function nodeError(nodeId: DagNodeId, code: DagNodeErrorCode, message: string, now: () => number): DagNodeError {
  return { code, message, nodeId, at: new Date(now()).toISOString() }
}

function primaryFailure(record: DagRunRecordV1): DagNode | undefined {
  for (const wave of record.waves) {
    for (const nodeId of wave.nodeIds) {
      const node = nodeById(record, nodeId)
      if (node.state === "failed") return node
    }
  }
  return undefined
}

function nodeById(record: DagRunRecordV1, nodeId: DagNodeId): DagNode {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throw new Error(`unknown DAG node "${nodeId}"`)
  return node
}

function repeatableSignal(): { readonly wait: () => Promise<void>; readonly resolve: () => void } {
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

function deferredSignal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
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
