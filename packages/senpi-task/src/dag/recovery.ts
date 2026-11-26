// allow: SIZE_OK - recovery keeps lease claiming, node reconciliation, and resumed frontier admission in one crash-safety boundary.
import * as fs from "node:fs"
import { join } from "node:path"
import type { ResumeCredential } from "../pause/admission-barrier"
import type { DagScheduler } from "./scheduler"
import { installRecoveredDag } from "./recovery-install"
import type { PausedChildRecoveryPort } from "./paused-child-recovery"

import { defaultSignaller } from "../lifecycle/context"
import type { PendingRevivals } from "../lifecycle/revival-pending"
import { childBacking } from "./child-backing"
import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import { dagNodeReusedEvent, dagNodeRetriedEvent, dagNodeTaskAttachedEvent, dagNodeTransitionedEvent } from "./events"
import { createDagJournal, type DagJournal } from "./journal"
import { skipDuplicateTerminalTransition, type DagPersistedNode, type DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { readDagNodeResult } from "./results"
import { currentNodeTask, leaseAfterEvent, releaseDagRunLease } from "./run-lease"
import { pauseRunsForShutdown } from "./recovery-shutdown"
import { claimOrphanedRun, claimPausedRun } from "./recovery-claim"
import { createDagRunReservations, type DagRunHeldReservations, type DagRunReservations } from "./run-acquisition"
import { applyDagSchedulerEvent, type DagNodeSpawnPolicy } from "./scheduler"
import { readDagDirectory, type DagFileStore } from "./store"
import type { DagNodeError, DagNodeErrorCode, DagNodeId, DagNodeTransitionReason, DagRunEvent, DagRunId } from "./types"

// Bound repeated owner deaths before launch using the durable execution counter, not display
// attempt. Retries/amendments also consume this budget; recovery never advances it past three.
const MAX_RECOVERY_READMISSIONS = 3

export type RecoverableRecord = DagRunRecordV1 & {
  readonly leaseHolderPid?: number
  readonly previousLeaseHolderPid?: number
}

export type DagRecoveryOutcome = {
  readonly runId: DagRunId
  // "adopted" is a resume that re-homed an eligible immediate fork-source run.
  readonly kind: "resumed" | "adopted" | "skipped"
  readonly record?: DagRunRecordV1
  readonly reusedOutputs?: ReadonlyMap<DagNodeId, string>
  readonly reason?: "foreign_session" | "live_lease" | "not_paused"
  // The pid a `live_lease` skip observed alive. A host that paused the run for its own shutdown is
  // often still exiting when its successor resumes the session, so the caller watches this pid and
  // retries the claim once it is gone instead of leaving the run paused for good.
  readonly holderPid?: number
}

export type DagRecoveryOptions = {
  readonly pausedChildren?: PausedChildRecoveryPort
  // The lifecycle's answer for a child it still owes a revival (#15150); absent, such a child is orphaned.
  readonly pendingRevivals?: PendingRevivals | undefined
  readonly store: DagFileStore
  readonly taskManager: TaskManager
  readonly hostPid?: number
  // Liveness probe for a paused run's previous lease holder. Defaults to the lifecycle port's
  // signaller so the signal-0 existence check has exactly one implementation in the package.
  readonly isProcessAlive?: (pid: number) => boolean
  // Whether THIS process still runs a scheduler for the run. Consulted when the recorded holder pid
  // is our own: a signal-0 probe on ourselves is always true, so without this a same-process
  // session reopen (multi-session host) would wait for its own host to exit. (#8006)
  // It also gates the claim of a run left `running`: only a caller that can tell its own live
  // scheduler from a dead host's may take such a run over.
  readonly isRunHeldInProcess?: (runId: DagRunId) => boolean
  readonly now?: () => number
  readonly subscriberRing?: number
  readonly nodeSpawnPolicy?: DagNodeSpawnPolicy
  readonly stopAdmission?: (runId: DagRunId) => void
  readonly reattach?: (runId: DagRunId, taskId: string) => void
  // The recovering session's own task depth: resumed nodes spawn one level below it, exactly like
  // a fresh run's nodes (scheduler `ancestry`), so a child session's workflow cannot reset depth.
  readonly ancestry?: { readonly depth: number }
  // The caller's per-run reservations, shared with every other entry that mutates a run here.
  readonly reservations?: DagRunReservations
}

export type DagRecovery = {
  readonly installResumedRun: (
    runId: DagRunId,
    parentSessionId: string,
    pauseSeq: number,
    credential?: ResumeCredential,
  ) => Promise<InstalledDagRun | DagRecoveryOutcome>
  readonly pauseRunsForShutdown: (parentSessionId: string, held?: DagRunHeldReservations) => readonly DagRunId[]
  readonly resumePausedRuns: (
    parentSessionId: string,
    forkSourceSessionId?: string,
  ) => Promise<readonly DagRecoveryOutcome[]>
  // Claims and installs like `resumePausedRuns` but resolves once every claimed run is installed;
  // `adopt` owns each run's `settled` from then on.
  readonly installPausedRuns: (
    parentSessionId: string,
    adopt: (installed: InstalledDagRun) => void,
    forkSourceSessionId?: string,
  ) => Promise<readonly DagRecoveryOutcome[]>
}

export type InstalledDagRun = {
  readonly kind: "installed"
  readonly runId: DagRunId
  // Ends the claim's reservation; the adopter calls it once it holds the scheduler (#15125).
  readonly release: () => void
  readonly scheduler: DagScheduler
  readonly settled: Promise<DagRecoveryOutcome>
}

export type RecoveryContext = Required<Pick<DagRecoveryOptions, "store" | "taskManager">> & {
  readonly pausedChildren?: PausedChildRecoveryPort
  readonly pendingRevivals?: PendingRevivals
  readonly resumeCredential?: ResumeCredential
  readonly hostPid: number
  readonly isProcessAlive: (pid: number) => boolean
  readonly isRunHeldInProcess?: (runId: DagRunId) => boolean
  // A claim writes our pid as the lease before the scheduler exists, so until the caller holds that
  // scheduler every other entry of this process must see the run as taken.
  readonly reservations: DagRunReservations
  readonly now: () => number
  readonly subscriberRing?: number
  readonly nodeSpawnPolicy?: DagNodeSpawnPolicy
  readonly stopAdmission?: (runId: DagRunId) => void
  readonly reattach?: (runId: DagRunId, taskId: string) => void
  readonly ancestry?: { readonly depth: number }
}

export type RecoveryPendingTerminalResult = {
  readonly record: TaskRecord
}

export function createDagRecovery(options: DagRecoveryOptions): DagRecovery {
  const context: RecoveryContext = {
    store: options.store,
    taskManager: options.taskManager,
    hostPid: options.hostPid ?? process.pid,
    isProcessAlive: options.isProcessAlive ?? defaultSignaller.isAlive,
    ...(options.isRunHeldInProcess === undefined ? {} : { isRunHeldInProcess: options.isRunHeldInProcess }),
    reservations: options.reservations ?? createDagRunReservations(),
    now: options.now ?? Date.now,
    ...(options.subscriberRing === undefined ? {} : { subscriberRing: options.subscriberRing }),
    ...(options.pausedChildren === undefined ? {} : { pausedChildren: options.pausedChildren }),
    ...(options.pendingRevivals === undefined ? {} : { pendingRevivals: options.pendingRevivals }),
    ...(options.nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy: options.nodeSpawnPolicy }),
    ...(options.stopAdmission === undefined ? {} : { stopAdmission: options.stopAdmission }),
    ...(options.reattach === undefined ? {} : { reattach: options.reattach }),
    ...(options.ancestry === undefined ? {} : { ancestry: options.ancestry }),
  }

  return {
    installResumedRun: async (runId, parentSessionId, pauseSeq, credential) => {
      const record = context.store.readCheckpoint<RecoverableRecord>(runId)
      if (record?.pause?.pauseSeq !== pauseSeq) return { kind: "skipped", runId, reason: "not_paused" }
      const claim = claimPausedRun(context, runId, parentSessionId, { kind: "resume", pauseSeq })
      if (claim.kind === "skipped") return { ...claim, runId }
      try {
        const context_ = { ...context, ...(credential === undefined ? {} : { resumeCredential: credential }) }
        return { ...(await installResumedRun(context_, claim.record)), release: claim.release }
      } catch (error) {
        claim.release()
        throw error
      }
    },
    pauseRunsForShutdown: (parentSessionId, held) => pauseRunsForShutdown(context, parentSessionId, held),
    resumePausedRuns: (parentSessionId, forkSourceSessionId) =>
      resumePausedRuns(context, parentSessionId, forkSourceSessionId),
    installPausedRuns: (parentSessionId, adopt, forkSourceSessionId) =>
      installPausedRuns(context, parentSessionId, adopt, forkSourceSessionId),
  }
}

async function resumePausedRuns(
  context: RecoveryContext,
  parentSessionId: string,
  forkSourceSessionId?: string,
): Promise<readonly DagRecoveryOutcome[]> {
  return visitPausedRuns(context, parentSessionId, forkSourceSessionId, async (claimed, foreign) => {
    const outcome = await resumeClaimedRun(context, claimed)
    return foreign && outcome.kind === "resumed" ? { ...outcome, kind: "adopted" } : outcome
  })
}

// Session start must not wait for a recovered run to FINISH: each claimed run is handed to `adopt`
// as soon as its scheduler is installed (`dag.run.resumed` journaled) and keeps running there.
async function installPausedRuns(
  context: RecoveryContext,
  parentSessionId: string,
  adopt: (installed: InstalledDagRun) => void,
  forkSourceSessionId?: string,
): Promise<readonly DagRecoveryOutcome[]> {
  return visitPausedRuns(context, parentSessionId, forkSourceSessionId, async (claimed, foreign, release) => {
    adopt({ ...(await installResumedRun(context, claimed)), release })
    return { runId: claimed.runId, kind: foreign ? "adopted" : "resumed" }
  })
}

async function visitPausedRuns(
  context: RecoveryContext,
  parentSessionId: string,
  forkSourceSessionId: string | undefined,
  recover: (claimed: RecoverableRecord, foreign: boolean, release: () => void) => Promise<DagRecoveryOutcome>,
): Promise<readonly DagRecoveryOutcome[]> {
  const outcomes: DagRecoveryOutcome[] = []
  const forkSource = normalizeSessionId(forkSourceSessionId)
  for (const observed of listRunRecords(context.store)) {
    if (observed.pause?.reason === "user_stop") continue
    const foreign = observed.parentSessionId !== parentSessionId
    if (foreign && (forkSource === undefined || normalizeSessionId(observed.parentSessionId) !== forkSource)) continue
    const claim = foreign
      ? claimOrphanedRun(context, observed.runId, observed.parentSessionId, parentSessionId)
      : claimPausedRun(context, observed.runId, parentSessionId, { kind: "automatic" })
    if (claim.kind === "skipped") {
      if (!foreign && claim.reason === "live_lease") {
        outcomes.push({ runId: observed.runId, kind: "skipped", reason: claim.reason, holderPid: claim.holderPid })
      }
      continue
    }
    try {
      outcomes.push(await recover(claim.record, foreign, claim.release))
    } finally {
      claim.release()
    }
  }
  return outcomes
}

function normalizeSessionId(sessionId: string | undefined): string | undefined {
  const trimmed = sessionId?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

async function resumeClaimedRun(context: RecoveryContext, claimed: RecoverableRecord): Promise<DagRecoveryOutcome> {
  return (await installResumedRun(context, claimed)).settled
}

async function installResumedRun(
  context: RecoveryContext,
  claimed: RecoverableRecord,
): Promise<Omit<InstalledDagRun, "release">> {
  return installRecoveredDag(context, claimed, {
    journal: (record, errors, results) => recoveryJournal(context, record, errors, results),
    reconcile: (journal, outputs, errors, results, tasks, awaiting) =>
      reconcileNodes(context, journal, outputs, errors, results, tasks, awaiting),
    release: () => releaseDagRunLease(context.store, claimed.runId, context.hostPid),
  })
}

async function reconcileNodes(
  context: RecoveryContext,
  journal: DagJournal<DagRunRecordV1>,
  reusedOutputs: Map<DagNodeId, string>,
  pendingErrors: Map<DagNodeId, DagNodeError>,
  pendingTerminalResults: Map<DagNodeId, RecoveryPendingTerminalResult>,
  reattachedTasks: Map<DagNodeId, string>,
  awaitingRevival: Map<DagNodeId, string>,
): Promise<void> {
  // Children this pass just spawned are live by construction: admission can return them queued
  // (`pending`, no resident handle yet), and their handle appears at launch.
  const startedHere = new Set<string>()
  // A child still waiting for a concurrency slot in this host has no resident handle either, but
  // this host's queue will launch it and settle it through the same waiters.
  const queuedHere = new Set(
    context.taskManager
      .list({ scope: "all" })
      .filter((entry) => entry.record.status === "pending" && entry.queue_position !== undefined)
      .map((entry) => entry.record.task_id),
  )
  for (const observed of journal.snapshot().nodes) {
    if (observed.state === "completed") {
      const result = readDagNodeResult({ store: context.store, runId: journal.snapshot().runId, nodeId: observed.id })
      if (result !== null) {
        reusedOutputs.set(observed.id, result.output)
        if (observed.taskId !== undefined) {
          journal.append(
            dagNodeReusedEvent({
              nodeId: observed.id,
              taskId: observed.taskId,
              sourceRunId: journal.snapshot().runId,
            }),
          )
        }
      }
      continue
    }
    if (observed.state === "failed" || observed.state === "cancelled" || observed.state === "skipped") continue
    if (observed.state !== "scheduled" && observed.state !== "running" && observed.state !== "paused") continue

    let task = currentNodeTask(context.taskManager, journal.snapshot(), observed)
    if (task !== undefined && observed.taskId !== task.task_id) attachTask(journal, observed.id, task.task_id)

    if (task === undefined && observed.state === "scheduled" && observed.taskId === undefined) {
      const result = await context.taskManager.startOwned(
        {
          ...startSpec(journal.snapshot(), observed.id, context.ancestry?.depth ?? 0),
          ...(context.resumeCredential === undefined ? {} : { resumeCredential: context.resumeCredential }),
        },
        taskOwner(journal.snapshot(), observed.id),
      )
      if (result.kind === "residency_denied") {
        journal.append(
          dagNodeTransitionedEvent({
            nodeId: observed.id,
            from: "scheduled",
            to: "pending",
            reason: { kind: "resumed" },
          }),
        )
        continue
      }
      task = attachStartedOrFail(journal, observed.id, result, context.now, pendingErrors)
      if (task === undefined && result.kind === "started") {
        startedHere.add(result.task_id)
        task = context.taskManager.get(result.task_id)
      }
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

    // A child that survived the restart is handed to the scheduler as a pre-attached settlement
    // instead of being awaited here: blocking inside reconcile froze the whole run in `paused` for
    // as long as the slowest child ran, withholding `dag.run.resumed`, the reuse events of every
    // node ordered after it, and every operator lever that refuses on an active run.
    if (task.status === "pending" || task.status === "running" || task.status === "paused") {
      const backing =
        startedHere.has(task.task_id) || queuedHere.has(task.task_id) ? undefined : childBacking(context, task)
      const orphaned = backing?.kind === "orphaned" ? backing.reason : undefined
      // A child that never launched and that no queue here still holds lost no work: retire its
      // record so it can never launch beside a replacement, and re-admit the node (#12107), even
      // when its revival is pending - a fresh start costs nothing and waits for nothing.
      if (
        backing !== undefined &&
        backing.kind !== "live" &&
        task.status === "pending" &&
        task.started_at === undefined &&
        (observed.execAttempt ?? 0) < MAX_RECOVERY_READMISSIONS
      ) {
        context.taskManager.withdrawAdmissions?.([task.task_id])
        await context.taskManager.cancelTask(task.task_id, "never launched; the DAG node was re-admitted on recovery")
        journal.append(
          dagNodeRetriedEvent({
            nodeId: observed.id,
            priorTaskId: task.task_id,
            execAttempt: (observed.execAttempt ?? 0) + 1,
            promptChanged: false,
          }),
        )
        continue
      }
      if (orphaned !== undefined) {
        failNode(journal, observed.id, "resume_task_orphaned", orphaned, context.now, pendingErrors)
        continue
      }
      context.reattach?.(journal.snapshot().runId, task.task_id)
      // Neither failed nor held: the node keeps its state and its scheduler follows the revival.
      if (backing?.kind === "revival_pending") {
        awaitingRevival.set(observed.id, task.task_id)
        continue
      }
      if (observed.state !== "running") {
        transition(journal, observed.id, "running", pendingErrors)
      }
      reattachedTasks.set(observed.id, task.task_id)
      continue
    }
    // Never-started recovery requires absent task-level started_at: TaskManager commits start
    // BEFORE runner.start, while the DAG node can stay scheduled until the whole admission batch
    // settles. Thus scheduled alone cannot prove no launch. A launch stamp survives lost and
    // always falls through to task_lost. Keep the scheduled guard for legacy running nodes whose
    // records predate started_at; legacy scheduled records without it remain eligible.
    // Retry returns the node to pending with a new execAttempt-scoped owner fingerprint, so the
    // scheduler dispatches a fresh child rather than reusing the terminal lost record.
    if (
      task.status === "lost" &&
      task.started_at === undefined &&
      observed.state === "scheduled" &&
      (observed.execAttempt ?? 0) < MAX_RECOVERY_READMISSIONS
    ) {
      const node = nodeById(journal.snapshot(), observed.id)
      journal.append(
        dagNodeRetriedEvent({
          nodeId: observed.id,
          priorTaskId: task.task_id,
          execAttempt: (node.execAttempt ?? 0) + 1,
          promptChanged: false,
        }),
      )
      continue
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
  if (result.kind === "held") {
    journal.append({ type: "dag.run.paused", reason: "user_stop", pauseSeq: result.pauseSeq })
    return undefined
  }
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
  if (task.status === "pending" || task.status === "running" || task.status === "paused") {
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

export function recoveryJournal(
  context: RecoveryContext,
  record: DagRunRecordV1,
  pendingErrors: ReadonlyMap<DagNodeId, DagNodeError> = new Map(),
  pendingTerminalResults: Map<DagNodeId, RecoveryPendingTerminalResult> = new Map(),
): DagJournal<DagRunRecordV1> {
  return createDagJournal({
    store: context.store,
    runId: record.runId,
    initialCheckpoint: record,
    applyEvent: (checkpoint, event) =>
      applyRecoveryEvent(checkpoint, event, pendingErrors, {
        store: context.store,
        pendingTerminalResults,
        now: context.now,
      }),
    ...(context.subscriberRing === undefined ? {} : { subscriberRing: context.subscriberRing }),
    now: context.now,
    skipDuplicate: skipDuplicateTerminalTransition,
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
  if (event.type === "dag.run.paused")
    return leaseAfterEvent({ ...record, status: "paused", updatedAt: event.at }, event)
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
  to: "completed" | "failed" | "running",
  pendingErrors: ReadonlyMap<DagNodeId, DagNodeError>,
): void {
  const node = nodeById(journal.snapshot(), nodeId)
  journal.append(
    dagNodeTransitionedEvent({
      nodeId,
      from: node.state,
      to,
      reason: transitionReason(to),
    }),
  )
  void pendingErrors
}

function transitionReason(to: "completed" | "failed" | "running"): DagNodeTransitionReason {
  if (to === "completed") return { kind: "succeeded" }
  if (to === "failed") return { kind: "failed" }
  return { kind: "resumed" }
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

export function listRunRecords(store: DagFileStore): readonly RecoverableRecord[] {
  return readDagDirectory(store.paths.runs)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => store.readCheckpoint<RecoverableRecord>(entry.name.slice(0, -5) as DagRunId))
    .filter((record): record is RecoverableRecord => record !== null)
}

function startSpec(record: DagRunRecordV1, nodeId: DagNodeId, sessionDepth: number): ManagerStartSpec {
  const node = nodeById(record, nodeId)
  const persisted = persistedNode(record, nodeId)
  return {
    prompt: persisted.effectivePrompt,
    ...(persisted.task_summary === undefined ? {} : { task_summary: persisted.task_summary }),
    parent_session_id: record.parentSessionId,
    root_session_id: record.rootSessionId,
    depth: sessionDepth + 1,
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
    fingerprint: dagFingerprint(
      ownerFingerprintInput({
        definitionFingerprint: record.definitionFingerprint,
        nodeId,
        ...(execAttempt === undefined ? {} : { execAttempt }),
      }),
    ),
  }
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

function startFailure(result: Exclude<OwnedStartResult, { readonly kind: "started" | "residency_denied" | "held" }>): {
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

function taskFailure(
  status: Exclude<TaskStatus, "completed" | "pending" | "running" | "paused">,
  message?: string,
): {
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
