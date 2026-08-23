// allow: SIZE_OK - recovery keeps lease claiming, node reconciliation, and resumed wave admission in one crash-safety boundary.
import * as fs from "node:fs"
import { join } from "node:path"

import { defaultSignaller } from "../lifecycle/context"
import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import {
  dagNodeReusedEvent,
  dagNodeTaskAttachedEvent,
  dagNodeTransitionedEvent,
  dagRunPausedEvent,
  dagRunResumedEvent,
} from "./events"
import { createDagJournal, type DagJournal } from "./journal"
import type { DagPersistedNode, DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { readDagNodeResult } from "./results"
import { applyDagSchedulerEvent, createDagScheduler, type DagNodeSpawnPolicy } from "./scheduler"
import type { DagFileStore } from "./store"
import type { DagNodeError, DagNodeErrorCode, DagNodeId, DagRunEvent, DagRunId } from "./types"

const LIVE_RUN_STATUSES = new Set(["pending", "running"])

type RecoverableRecord = DagRunRecordV1 & {
  readonly leaseHolderPid?: number
  readonly previousLeaseHolderPid?: number
}

export type DagRecoveryOutcome = {
  readonly runId: DagRunId
  readonly kind: "resumed" | "skipped"
  readonly record?: DagRunRecordV1
  readonly reusedOutputs?: ReadonlyMap<DagNodeId, string>
  readonly reason?: "foreign_session" | "live_lease" | "not_paused"
}

export type DagRecoveryOptions = {
  readonly store: DagFileStore
  readonly taskManager: TaskManager
  readonly hostPid?: number
  // Liveness probe for a paused run's previous lease holder. Defaults to the lifecycle port's
  // signaller so the signal-0 existence check has exactly one implementation in the package.
  readonly isProcessAlive?: (pid: number) => boolean
  readonly now?: () => number
  readonly subscriberRing?: number
  readonly nodeSpawnPolicy?: DagNodeSpawnPolicy
  readonly stopAdmission?: (runId: DagRunId) => void
  readonly reattach?: (runId: DagRunId, taskId: string) => void
}

export type DagRecovery = {
  readonly pauseRunsForShutdown: (parentSessionId: string) => readonly DagRunId[]
  readonly resumePausedRuns: (parentSessionId: string) => Promise<readonly DagRecoveryOutcome[]>
}

type RecoveryContext = Required<Pick<DagRecoveryOptions, "store" | "taskManager">> & {
  readonly hostPid: number
  readonly isProcessAlive: (pid: number) => boolean
  readonly now: () => number
  readonly subscriberRing?: number
  readonly nodeSpawnPolicy?: DagNodeSpawnPolicy
  readonly stopAdmission?: (runId: DagRunId) => void
  readonly reattach?: (runId: DagRunId, taskId: string) => void
}

type RecoveryPendingTerminalResult = {
  readonly record: TaskRecord
}

type ClaimedRun =
  | { readonly kind: "claimed"; readonly record: RecoverableRecord }
  | { readonly kind: "skipped"; readonly reason: "foreign_session" | "live_lease" | "not_paused" }

export function createDagRecovery(options: DagRecoveryOptions): DagRecovery {
  const context: RecoveryContext = {
    store: options.store,
    taskManager: options.taskManager,
    hostPid: options.hostPid ?? process.pid,
    isProcessAlive: options.isProcessAlive ?? defaultSignaller.isAlive,
    now: options.now ?? Date.now,
    ...(options.subscriberRing === undefined ? {} : { subscriberRing: options.subscriberRing }),
    ...(options.nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy: options.nodeSpawnPolicy }),
    ...(options.stopAdmission === undefined ? {} : { stopAdmission: options.stopAdmission }),
    ...(options.reattach === undefined ? {} : { reattach: options.reattach }),
  }

  return {
    pauseRunsForShutdown: (parentSessionId) => pauseRunsForShutdown(context, parentSessionId),
    resumePausedRuns: (parentSessionId) => resumePausedRuns(context, parentSessionId),
  }
}

function pauseRunsForShutdown(context: RecoveryContext, parentSessionId: string): readonly DagRunId[] {
  const paused: DagRunId[] = []
  for (const observed of listRunRecords(context.store)) {
    if (observed.parentSessionId !== parentSessionId || !LIVE_RUN_STATUSES.has(observed.status)) continue
    context.stopAdmission?.(observed.runId)
    const journal = recoveryJournal(context, observed)
    journal.append(dagRunPausedEvent({ reason: "session_shutdown" }))
    context.store.withRunLock(observed.runId, () => {
      const fresh = context.store.readCheckpoint<RecoverableRecord>(observed.runId)
      if (fresh === null || fresh.status !== "paused") return
      const previousLeaseHolderPid = fresh.leaseHolderPid ?? context.hostPid
      const { leaseHolderPid: _leaseHolderPid, ...released } = fresh
      context.store.writeCheckpoint(observed.runId, { ...released, previousLeaseHolderPid })
    })
    paused.push(observed.runId)
  }
  return paused
}

async function resumePausedRuns(
  context: RecoveryContext,
  parentSessionId: string,
): Promise<readonly DagRecoveryOutcome[]> {
  const outcomes: DagRecoveryOutcome[] = []
  for (const observed of listRunRecords(context.store)) {
    if (observed.parentSessionId !== parentSessionId) continue
    const claim = claimPausedRun(context, observed.runId, parentSessionId)
    if (claim.kind === "skipped") {
      if (claim.reason === "live_lease") outcomes.push({ runId: observed.runId, kind: "skipped", reason: claim.reason })
      continue
    }
    outcomes.push(await resumeClaimedRun(context, claim.record))
  }
  return outcomes
}

function claimPausedRun(context: RecoveryContext, runId: DagRunId, parentSessionId: string): ClaimedRun {
  return context.store.withRunLock(runId, () => {
    const fresh = context.store.readCheckpoint<RecoverableRecord>(runId)
    if (fresh === null || fresh.status !== "paused") return { kind: "skipped", reason: "not_paused" }
    if (fresh.parentSessionId !== parentSessionId) return { kind: "skipped", reason: "foreign_session" }
    const priorHolder = fresh.leaseHolderPid ?? fresh.previousLeaseHolderPid
    if (priorHolder !== undefined && context.isProcessAlive(priorHolder)) {
      return { kind: "skipped", reason: "live_lease" }
    }
    const claimed: RecoverableRecord = { ...fresh, leaseHolderPid: context.hostPid }
    context.store.writeCheckpoint(runId, claimed)
    return { kind: "claimed", record: claimed }
  })
}

async function resumeClaimedRun(context: RecoveryContext, claimed: RecoverableRecord): Promise<DagRecoveryOutcome> {
  const pendingErrors = new Map<DagNodeId, DagNodeError>()
  const pendingTerminalResults = new Map<DagNodeId, RecoveryPendingTerminalResult>()
  const journal = recoveryJournal(context, claimed, pendingErrors, pendingTerminalResults)
  const reusedOutputs = new Map<DagNodeId, string>()
  try {
    await reconcileNodes(context, journal, reusedOutputs, pendingErrors, pendingTerminalResults)
    const generation = journal.snapshot().generation + 1
    journal.append(dagRunResumedEvent({ generation }))
    const scheduler = createDagScheduler({
      store: context.store,
      taskManager: context.taskManager,
      initialRecord: journal.snapshot(),
      ...(context.subscriberRing === undefined ? {} : { subscriberRing: context.subscriberRing }),
      ...(context.nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy: context.nodeSpawnPolicy }),
      now: context.now,
    })
    const record = await scheduler.run()
    return { runId: claimed.runId, kind: "resumed", record, reusedOutputs }
  } finally {
    releaseLease(context, claimed.runId)
  }
}

async function reconcileNodes(
  context: RecoveryContext,
  journal: DagJournal<DagRunRecordV1>,
  reusedOutputs: Map<DagNodeId, string>,
  pendingErrors: Map<DagNodeId, DagNodeError>,
  pendingTerminalResults: Map<DagNodeId, RecoveryPendingTerminalResult>,
): Promise<void> {
  for (const observed of journal.snapshot().nodes) {
    if (observed.state === "completed") {
      const result = readDagNodeResult({ store: context.store, runId: journal.snapshot().runId, nodeId: observed.id })
      if (result !== null) {
        reusedOutputs.set(observed.id, result.output)
        if (observed.taskId !== undefined) {
          journal.append(dagNodeReusedEvent({
            nodeId: observed.id,
            taskId: observed.taskId,
            sourceRunId: journal.snapshot().runId,
          }))
        }
      }
      continue
    }
    if (observed.state === "failed" || observed.state === "cancelled" || observed.state === "skipped") continue
    if (observed.state !== "scheduled" && observed.state !== "running") continue

    const owned = context.taskManager.findOwnedTask(ownerKey(journal.snapshot(), observed.id))
    let task = observed.taskId === undefined ? owned : context.taskManager.get(observed.taskId) ?? owned
    if (task !== undefined && observed.taskId !== task.task_id) attachTask(journal, observed.id, task.task_id)

    if (task === undefined && observed.state === "scheduled" && observed.taskId === undefined) {
      const result = await context.taskManager.startOwned(
        startSpec(journal.snapshot(), observed.id),
        taskOwner(journal.snapshot(), observed.id),
      )
      if (result.kind === "residency_denied") {
        journal.append(dagNodeTransitionedEvent({
          nodeId: observed.id,
          from: "scheduled",
          to: "pending",
          reason: { kind: "resumed" },
        }))
        continue
      }
      task = attachStartedOrFail(journal, observed.id, result, context.now, pendingErrors)
      if (task === undefined && result.kind === "started") task = context.taskManager.get(result.task_id)
    }

    if (task === undefined) {
      const taskId = observed.taskId
      const result = readDagNodeResult({ store: context.store, runId: journal.snapshot().runId, nodeId: observed.id })
      if (result !== null) {
        reusedOutputs.set(observed.id, result.output)
        transition(journal, observed.id, "completed", pendingErrors)
        continue
      }
      const transcript = taskId === undefined ? false : hasTranscript(context.store.stateDir, taskId)
      failNode(
        journal,
        observed.id,
        "resume_task_missing",
        transcript
          ? `task ${taskId} has a transcript but no recoverable task owner record`
          : `task ${taskId ?? "unknown"} and all recovery artifacts are missing`,
        context.now,
        pendingErrors,
      )
      continue
    }

    if (task.status === "pending" || task.status === "running") {
      context.reattach?.(journal.snapshot().runId, task.task_id)
      task = await context.taskManager.waitFor(task.task_id)
    }
    foldTaskOutcome(context, journal, observed.id, task, pendingErrors, pendingTerminalResults)
  }
}

function attachStartedOrFail(
  journal: DagJournal<DagRunRecordV1>,
  nodeId: DagNodeId,
  result: Exclude<OwnedStartResult, { readonly kind: "residency_denied" }>,
  now: () => number,
  pendingErrors: Map<DagNodeId, DagNodeError>,
): TaskRecord | undefined {
  if (result.kind === "started") {
    attachTask(journal, nodeId, result.task_id)
    return undefined
  }
  const failure = startFailure(result)
  failNode(journal, nodeId, failure.code, failure.message, now, pendingErrors)
  return undefined
}

function foldTaskOutcome(
  context: RecoveryContext,
  journal: DagJournal<DagRunRecordV1>,
  nodeId: DagNodeId,
  task: TaskRecord,
  pendingErrors: Map<DagNodeId, DagNodeError>,
  pendingTerminalResults: Map<DagNodeId, RecoveryPendingTerminalResult>,
): void {
  if (task.status === "pending" || task.status === "running") {
    throw new Error(`TaskManager.waitFor returned nonterminal task ${task.task_id}`)
  }
  if (task.status === "completed") {
    pendingTerminalResults.set(nodeId, { record: task })
    transition(journal, nodeId, "completed", pendingErrors)
    return
  }
  const failure = taskFailure(task.status, task.error_message)
  failNode(journal, nodeId, failure.code, failure.message, context.now, pendingErrors)
}

function recoveryJournal(
  context: RecoveryContext,
  record: DagRunRecordV1,
  pendingErrors: ReadonlyMap<DagNodeId, DagNodeError> = new Map(),
  pendingTerminalResults: Map<DagNodeId, RecoveryPendingTerminalResult> = new Map(),
): DagJournal<DagRunRecordV1> {
  return createDagJournal({
    store: context.store,
    runId: record.runId,
    initialCheckpoint: record,
    applyEvent: (checkpoint, event) => applyRecoveryEvent(
      checkpoint,
      event,
      pendingErrors,
      { store: context.store, pendingTerminalResults, now: context.now },
    ),
    ...(context.subscriberRing === undefined ? {} : { subscriberRing: context.subscriberRing }),
    now: context.now,
  })
}

function applyRecoveryEvent(
  record: DagRunRecordV1,
  event: DagRunEvent,
  pendingErrors: ReadonlyMap<DagNodeId, DagNodeError>,
  terminalResults: {
    readonly store: DagFileStore
    readonly pendingTerminalResults: Map<DagNodeId, RecoveryPendingTerminalResult>
    readonly now: () => number
  },
): DagRunRecordV1 {
  if (event.type === "dag.run.paused") return { ...record, status: "paused", updatedAt: event.at }
  // dag.run.resumed is owned by the scheduler reducer now (it also clears the stale completedAt),
  // so recovery no longer forks that transition.
  return applyDagSchedulerEvent(record, event, pendingErrors, terminalResults)
}

function attachTask(journal: DagJournal<DagRunRecordV1>, nodeId: DagNodeId, taskId: string): void {
  const node = nodeById(journal.snapshot(), nodeId)
  journal.append(dagNodeTaskAttachedEvent({ nodeId, taskId, attempt: node.attempt + 1 }))
}

function transition(
  journal: DagJournal<DagRunRecordV1>,
  nodeId: DagNodeId,
  to: "completed" | "failed",
  pendingErrors: ReadonlyMap<DagNodeId, DagNodeError>,
): void {
  const node = nodeById(journal.snapshot(), nodeId)
  journal.append(dagNodeTransitionedEvent({
    nodeId,
    from: node.state,
    to,
    reason: to === "completed" ? { kind: "succeeded" } : { kind: "failed" },
  }))
  void pendingErrors
}

function failNode(
  journal: DagJournal<DagRunRecordV1>,
  nodeId: DagNodeId,
  code: DagNodeErrorCode,
  message: string,
  now: () => number,
  pendingErrors: Map<DagNodeId, DagNodeError>,
): void {
  pendingErrors.set(nodeId, { code, message, nodeId, at: new Date(now()).toISOString() })
  transition(journal, nodeId, "failed", pendingErrors)
  pendingErrors.delete(nodeId)
}

function releaseLease(context: RecoveryContext, runId: DagRunId): void {
  context.store.withRunLock(runId, () => {
    const fresh = context.store.readCheckpoint<RecoverableRecord>(runId)
    if (fresh === null || fresh.leaseHolderPid !== context.hostPid) return
    const { leaseHolderPid: _leaseHolderPid, previousLeaseHolderPid: _previousLeaseHolderPid, ...released } = fresh
    context.store.writeCheckpoint(runId, released)
  })
}

function listRunRecords(store: DagFileStore): readonly RecoverableRecord[] {
  return fs.readdirSync(store.paths.runs, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => store.readCheckpoint<RecoverableRecord>(entry.name.slice(0, -5) as DagRunId))
    .filter((record): record is RecoverableRecord => record !== null)
}

function startSpec(record: DagRunRecordV1, nodeId: DagNodeId): ManagerStartSpec {
  const node = nodeById(record, nodeId)
  const persisted = persistedNode(record, nodeId)
  return {
    prompt: persisted.effectivePrompt,
    ...(persisted.task_summary === undefined ? {} : { task_summary: persisted.task_summary }),
    parent_session_id: record.parentSessionId,
    root_session_id: record.rootSessionId,
    depth: 1,
    ...(node.route.kind === "category"
      ? { category: node.route.category }
      : { subagent_type: node.route.agent, ...(node.route.model === undefined ? {} : { model: node.route.model }) }),
    name: node.id,
    ...(persisted.description === undefined ? {} : { description: persisted.description }),
    run_in_background: true,
  }
}

function taskOwner(record: DagRunRecordV1, nodeId: DagNodeId): DagTaskOwner {
  // Keyed on the persisted execAttempt, NEVER the display attempt: reattach bumps the display
  // attempt with no new execution, and an attempt-keyed fingerprint would then compute a value the
  // persisted owner record does not hold - a spurious owner_conflict on an untouched resume.
  const execAttempt = nodeById(record, nodeId).execAttempt
  return {
    kind: "dag",
    runId: record.runId,
    nodeId,
    fingerprint: dagFingerprint(ownerFingerprintInput({
      definitionFingerprint: record.definitionFingerprint,
      nodeId,
      ...(execAttempt === undefined ? {} : { execAttempt }),
    })),
  }
}

function ownerKey(record: DagRunRecordV1, nodeId: DagNodeId) {
  return { kind: "dag" as const, runId: record.runId, nodeId }
}

function nodeById(record: DagRunRecordV1, nodeId: DagNodeId) {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throw new Error(`unknown DAG node "${nodeId}"`)
  return node
}

function persistedNode(record: DagRunRecordV1, nodeId: DagNodeId): DagPersistedNode {
  const node = record.definition.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throw new Error(`missing persisted definition for DAG node "${nodeId}"`)
  return node
}

function startFailure(result: Exclude<OwnedStartResult, { readonly kind: "started" | "residency_denied" }>): {
  readonly code: DagNodeErrorCode
  readonly message: string
} {
  switch (result.kind) {
    case "depth_denied": return { code: "depth_denied", message: result.reason }
    case "plan_unresolved": return { code: "plan_unresolved", message: result.error.message }
    case "start_failed": return { code: "start_failed", message: result.error_message }
    case "owner_conflict": return { code: "start_failed", message: `DAG task owner conflicts with existing task ${result.task_id}` }
  }
}

function taskFailure(status: Exclude<TaskStatus, "completed" | "pending" | "running">, message?: string): {
  readonly code: DagNodeErrorCode
  readonly message: string
} {
  switch (status) {
    case "error": return { code: "task_error", message: message ?? "task failed" }
    case "interrupted": return { code: "task_interrupted", message: message ?? "task was interrupted" }
    case "lost": return { code: "task_lost", message: message ?? "task was lost" }
    case "cancelled": return { code: "task_cancelled", message: message ?? "task was cancelled" }
  }
}

function hasTranscript(stateDir: string, taskId: string): boolean {
  if (fs.existsSync(join(stateDir, "logs", `${taskId}.jsonl`))) return true
  const childDir = join(stateDir, "children", taskId)
  try {
    return fs.readdirSync(childDir, { recursive: true }).some((entry) => String(entry).endsWith(".jsonl"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}
