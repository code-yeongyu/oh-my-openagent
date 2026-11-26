// allow: SIZE_OK - this is the DAG composition root: one manager/store graph must be shared by the
// tool, scheduler, RPC, TUI, wake, and lifecycle adapters or live runs split into isolated islands.
import {
  awaitingInputDetails,
  createChildProgress,
  type ManagedChildEvent,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"
import {
  createDagFileStore,
  createDagOwnerResumeFence,
  createDagManager,
  createDagRecovery,
  createDagWaitSurface,
  DAG_UNATTACHED_NODES_PAUSE_REASON,
  type DagDefinition,
  type DagFileStore,
  type DagLeaseWatchOptions,
  type DagNodeSpawnPolicy,
  type DagManager,
  type DagRunEvent,
  type DagRunId,
  type DagRunRecordV1,
  type DagRunSnapshot,
} from "@oh-my-opencode/senpi-task/dag"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import { admissionTaskManager } from "./dag-admission-task-manager"
import { resolveDagForkSource } from "./dag-fork-source"
import { scheduleDagRetentionSweep, type DagRetentionSweepOptions } from "./dag-retention-sweep"
import { createDagRpcBridge, type DagBridgeTimers } from "./dag-rpc-bridge"
import { registerDagRpcHandlers } from "./dag-rpc-handlers"
import { createDagStatusUi, type DagStatusUiTimers } from "./dag-status-ui"
import { createDagWake } from "./dag-wake"
import { createDagWakeSource } from "./dag-wake-source"
import type { TaskEngine } from "./engine"
import { observeDagSchedulers, type DagNodeSendResult } from "../../../../senpi-task/src/dag/scheduler"
import { createDagSkillMaterializer } from "../../../../senpi-task/src/dag/skills"
import { endedChildClosure, type PausedNodeHoldPort } from "./dag-paused-cancel"
import { createDagRuntimeControls } from "./dag-runtime-controls"
import { createDagSchedulerRegistry, type OwnedScheduler } from "./dag-scheduler-registry"
import { createDagRecoverySweeps } from "./dag-recovery-sweeps"
import { createDagRunCancel } from "./dag-run-cancel"
import { createShutdownPause } from "./dag-runtime-shutdown"
import { registerDagPauseSource } from "./dag-runtime-pause-wiring"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import type { PausedChildRecoveryPort } from "../../../../senpi-task/src/dag/paused-child-recovery"
import type { DagGuidanceDelivery } from "./dag-run-pause-source"
import { defaultSignaller } from "../../../../senpi-task/src/lifecycle/context"

const EVENT_PAGE_SIZE = 1000
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"])
type DagRuntimeManager = Omit<DagManager, "attach"> & {
  readonly attach: ReturnType<typeof createDagWaitSurface>["attach"]
}

export interface DagRuntime {
  readonly cancelNode: (runId: DagRunId, nodeId: string) => Promise<void>
  readonly manager: DagRuntimeManager
  readonly wait: ReturnType<typeof createDagWaitSurface>["wait"]
  readonly cancel: (runId: DagRunId, reason?: string) => Promise<void>
  /** Returns settled nodes to a fresh attempt and resumes the run under a NEW scheduler. */
  readonly retry: (
    runId: DagRunId,
    nodeIds?: readonly string[],
    options?: { readonly prompt?: string },
  ) => Promise<DagRunSnapshot>
  /** Steers a running node's child, revives a finished resident one, or refuses. */
  readonly send: (runId: DagRunId, nodeId: string, message: string) => Promise<DagNodeSendResult>
  /** Applies an edited definition to the SAME run and resumes it under a NEW scheduler. */
  readonly amend: (runId: DagRunId, definition: DagDefinition) => Promise<DagRunSnapshot>
  readonly guide: ReturnType<typeof createDagRuntimeControls>["guide"]
  readonly taskRecord: (taskId: string) => TaskRecord | undefined
  attach(event?: unknown): Promise<void>
  sync(): void
  detach(): void
  /** Restates the current `omo.dag.updated` snapshot for a client that reattached. */
  resend(): void
  /** Retires live schedulers without cancelling them, then persists the pause. Await before teardown. */
  pauseForShutdown(): Promise<void>
  dispose(): void
}

export interface DagRuntimeDeps {
  readonly pausedGuidance?: DagGuidanceDelivery
  readonly pausedChildren?: PausedChildRecoveryPort
  readonly pausedNodeHoldPort?: PausedNodeHoldPort
  readonly pi: SenpiExtensionAPI
  readonly engine: TaskEngine
  readonly logger: ComponentLogger
  readonly nodeSpawnPolicy?: DagNodeSpawnPolicy
  readonly coordinator?: IdleInjectionCoordinator
  readonly bridgeTimers?: DagBridgeTimers
  readonly statusUiTimers?: DagStatusUiTimers
  /** Liveness probe + timers for the paused-run lease watch; production uses signal-0 and unref'd timers. */
  readonly leaseWatch?: DagLeaseWatchOptions
  /** Scheduler for the retention sweep; production defers it off the session-start path. */
  readonly retentionSweep?: DagRetentionSweepOptions
}

export function createDagRuntime(deps: DagRuntimeDeps): DagRuntime {
  const dagSettings = deps.engine.settings.dag
  const baseStore = createDagFileStore({
    project_dir: deps.engine.runtime.cwd(),
    task: {
      ...(deps.engine.settings.state_dir === undefined ? {} : { state_dir: deps.engine.settings.state_dir }),
      ...(dagSettings === undefined ? {} : { dag: dagSettings }),
    },
  })
  scheduleDagRetentionSweep(baseStore, deps)
  const runListeners = new Map<DagRunId, Set<(event: DagRunEvent) => void>>()
  const deliveredSeq = new Map<DagRunId, number>()
  const schedulers = new Map<DagRunId, OwnedScheduler>()
  const stoppedAdmissions = new Set<DagRunId>()
  const reservations = createDagRunReservations()
  const recoveryTaskSubscriptions = new Map<string, () => void>()
  const activityTaskSubscriptions = new Map<string, () => void>()
  const isProcessAlive = deps.leaseWatch?.isProcessAlive ?? defaultSignaller.isAlive
  let mutationListener = (): void => undefined
  let durableEventListener = (_event: DagRunEvent): void => undefined
  let activeSessionId: string | undefined

  const store: DagFileStore = {
    ...baseStore,
    writeCheckpoint(runId, checkpoint) {
      baseStore.writeCheckpoint(runId, checkpoint)
      mutationListener()
      if (!schedulers.has(runId)) {
        publishDurableEvents(baseStore, runId, deliveredSeq, runListeners, durableEventListener)
      }
    },
  }
  const materializeSkills = (input: Parameters<ReturnType<typeof createDagSkillMaterializer>>[0]) =>
    createDagSkillMaterializer({ store, cwd: deps.engine.runtime.cwd(), loadSkills: deps.engine.loadSkills })(input)
  const coreManager = createDagManager({
    store,
    materializeSkills,
    ownedTasks: deps.engine.manager,
    ...(dagSettings === undefined ? {} : { settings: dagSettings }),
  })
  const taskManager = admissionTaskManager(deps.engine.manager, (runId) => stoppedAdmissions.has(runId))
  // Every scheduler this runtime builds - first run, re-entry after retry, re-entry after amend -
  // shares one option set so a resumed run keeps the same execution mode, spawn policy, and skill
  // materialization the original admission had.
  const schedulerOptions = {
    store,
    taskManager,
    materializeSkills,
    executionMode: {
      agents: deps.engine.agents,
      config: deps.engine.omoConfig,
      // Live read: a DAG node dispatched before the session resolved `auto` names no mode and the
      // manager decides, so no run is pinned to a guess.
      autoMode: () => deps.engine.host.executionModeGate.current(),
    },
    ...(deps.engine.ancestry === undefined ? {} : { ancestry: deps.engine.ancestry }),
    ...(deps.nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy: deps.nodeSpawnPolicy }),
    ...(dagSettings?.subscriber_ring === undefined ? {} : { subscriberRing: dagSettings.subscriber_ring }),
    // The same probe and (required) reservations as recovery and the registry, revive watchers included.
    isProcessAlive,
    reservations,
  }

  const subscribe = (runId: DagRunId, listener: (event: DagRunEvent) => void): (() => void) => {
    const listeners = runListeners.get(runId) ?? new Set<(event: DagRunEvent) => void>()
    listeners.add(listener)
    runListeners.set(runId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) runListeners.delete(runId)
    }
  }

  // omo#10782 item 5: a workflow run that completes tells the engine, so the session's next `done` reads
  // completion kind "run". The engine ignores it outside an open epoch. A host fault here must never reach the
  // scheduler's event fan-out.
  // The mark is taken on the scheduler subscription, ahead of the shared delivery de-duplication: a recovered run's
  // checkpoint delivers its events on the durable path first, so `deliveredSeq` already holds the completion when
  // the scheduler's copy arrives. Scheduler subscribers only see events appended after they subscribe, so an old
  // completion is never replayed into a mark (the durable path replays the whole log and must not mark).
  const markedCompletionSeq = new Map<DagRunId, number>()
  const markRunCompleted = (runId: DagRunId): void => {
    try {
      deps.pi.lifecycle?.markRunCompleted({ runId })
    } catch (error) {
      deps.logger.warn("omo-senpi dag could not tell the engine a run completed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const publishSchedulerEvent = (event: DagRunEvent): void => {
    if (event.type === "dag.run.completed" && (markedCompletionSeq.get(event.runId) ?? 0) < event.seq) {
      markedCompletionSeq.set(event.runId, event.seq)
      markRunCompleted(event.runId)
    }
    if ((deliveredSeq.get(event.runId) ?? 0) >= event.seq) return
    deliveredSeq.set(event.runId, event.seq)
    deliverDurableEvent(durableEventListener, event)
    for (const listener of runListeners.get(event.runId) ?? []) deliverDurableEvent(listener, event)
  }
  const stopObservingSchedulers = observeDagSchedulers(taskManager, (scheduler) => {
    scheduler.subscribe(publishSchedulerEvent)
  })
  const stopFencingResumes = deps.engine.registerOwnerResumeFence(
    createDagOwnerResumeFence({
      store,
      heldTriggers: { ...schedulerOptions, taskManager: deps.engine.manager },
      // A held scheduler's cancel, or a cancel of a run no scheduler here holds (in flight on its reservation).
      cancelling: (runId) =>
        schedulers.get(runId)?.scheduler.cancelling() === true || reservations.inFlight(runId) === "cancel",
    }),
  )

  const { holdsRun, ensureScheduled, adoptReentry, adoptInstalled } = createDagSchedulerRegistry({
    schedulers,
    store,
    schedulerOptions,
    logger: deps.logger,
    isProcessAlive,
    reservations,
    recover: (sessionId) => sweeps.recover({ sessionId }),
  })
  const holders = { taskManager: deps.engine.manager, hostPid: process.pid, isProcessAlive }

  const childClosure = deps.pausedNodeHoldPort ?? endedChildClosure(deps.engine.manager)
  const cancelRun = createDagRunCancel({
    store,
    schedulerOptions,
    schedulers,
    reservations,
    holders,
    holdsRun,
  })
  const cancel = async (runId: DagRunId, reason?: string): Promise<void> => {
    const sessionId = deps.engine.runtime.sessionId() ?? ""
    // Only who may cancel is checked here; whether there is anything to cancel is decided inside the
    // run's reservation (`dag-run-cancel.ts`), after any re-entry or installation in flight (#15125).
    coreManager.record(runId, sessionId)
    // A user-stopped run then lets the parent's fence for the run go.
    const record = await cancelRun(runId, sessionId, reason)
    if (record === undefined || record.status !== "paused" || record.pause?.reason !== "user_stop") return
    const runRef = { kind: "dag" as const, id: runId }
    await deps.engine.runPause?.forgetRun(record.parentSessionId, runRef)
    deps.engine.runtime.releaseRunFence(runRef)
  }

  // The admission latch is cleared on every re-entry: only recovery's shutdown pause ever sets it, it
  // lives in this closure so it outlives every scheduler, and nothing else ever deletes it - a retry
  // after a pause+resume in the SAME process would otherwise hang forever on the never-resolving
  // admission promise instead of starting a child.
  const clearAdmissionLatch = (runId: DagRunId): void => {
    stoppedAdmissions.delete(runId)
  }

  const { retry, send, amend, guide, cancelNode } = createDagRuntimeControls({
    coreManager,
    schedulerOptions,
    schedulers,
    reservations,
    holdsRun,
    closure: childClosure,
    clearAdmissionLatch,
    adoptReentry,
    sessionId: () => deps.engine.runtime.sessionId() ?? "",
  })

  const waitSurface = createDagWaitSurface({ store, subscribe, cancel, ownedTasks: taskManager })
  const wait = async (runId: DagRunId, parentSessionId: string) => {
    const result = await waitSurface.wait(runId, parentSessionId)
    const owned = schedulers.get(runId)
    if (owned !== undefined) await owned.scheduler.whenIdle()
    return result
  }
  const manager: DagRuntimeManager = {
    ...coreManager,
    async start(params) {
      const result = await coreManager.start(params)
      // A reused run left `running` by a scheduler this runtime does not hold is recovery's: the
      // claim takes it only when its lease holder is gone.
      if (!ensureScheduled(result.snapshot.runId, params.parentSessionId))
        await sweeps.recover({ sessionId: params.parentSessionId })
      return result
    },
    attach: waitSurface.attach,
  }
  const queryManager = {
    list: (sessionId: string, options?: { readonly limit?: number }) => manager.list(sessionId, options),
    snapshot: (runId: string, sessionId: string) => manager.snapshot(runId as DagRunId, sessionId),
    history: (params: Parameters<typeof manager.history>[0]) => manager.history(params),
  }
  const bridge = createDagRpcBridge(deps.pi, {
    liveRuns: () =>
      runsForActiveSession(manager, deps.engine).map((summary) => ({
        runId: summary.runId,
        status: summary.status,
        subscribe: (listener) => subscribe(summary.runId, listener),
      })),
    runSnapshots: () => snapshotsForActiveSession(manager, deps.engine),
    parentSessionId: () => deps.engine.runtime.sessionId(),
    logger: deps.logger,
    ...(dagSettings?.heartbeat_ms === undefined ? {} : { heartbeatMs: dagSettings.heartbeat_ms }),
    ...(deps.bridgeTimers === undefined ? {} : { timers: deps.bridgeTimers }),
  })
  registerDagRpcHandlers(deps.pi, { manager: queryManager, sessionId: () => activeSessionId })

  const statusUi = createDagStatusUi({
    manager: queryManager,
    runtime: deps.engine.runtime,
    logger: deps.logger,
    ...(deps.statusUiTimers === undefined ? {} : { timers: deps.statusUiTimers }),
  })

  const syncActivitySubscriptions = (): void => {
    const wanted = new Map<string, { readonly runId: DagRunId; readonly nodeId: string }>()
    if (activeSessionId !== undefined) {
      for (const summary of manager.list(activeSessionId)) {
        if (TERMINAL_RUN_STATUSES.has(summary.status)) continue
        for (const node of manager.record(summary.runId, activeSessionId).nodes) {
          if (
            node.taskId !== undefined &&
            node.state !== "completed" &&
            node.state !== "failed" &&
            node.state !== "cancelled" &&
            node.state !== "skipped"
          ) {
            wanted.set(node.taskId, { runId: summary.runId, nodeId: node.id })
          }
        }
      }
    }
    for (const [taskId, unsubscribe] of activityTaskSubscriptions) {
      if (wanted.has(taskId)) continue
      unsubscribe()
      activityTaskSubscriptions.delete(taskId)
    }
    for (const [taskId, owner] of wanted) {
      if (activityTaskSubscriptions.has(taskId)) continue
      const record = deps.engine.manager.get(taskId)
      if (record === undefined) continue
      const progress = createChildProgress(
        taskId,
        {
          name: record.name,
          taskSummary: record.task_summary,
          description: record.description,
          category: record.category,
          agentType: record.agent_type,
          resolvedModel: record.resolved_model,
          model: record.model,
        },
        Date.parse(record.created_at),
        Date.now,
        { awaitingInput: awaitingInputDetails(record) !== undefined },
      )
      activityTaskSubscriptions.set(
        taskId,
        deps.engine.manager.subscribeChild(taskId, (event: ManagedChildEvent) => {
          if (!progress.accept(event)) return
          const details = progress.details()
          const activity: Parameters<typeof bridge.publishActivity>[0] = {
            schemaVersion: 1,
            runId: owner.runId,
            nodeId: owner.nodeId,
            taskId,
            at: new Date().toISOString(),
            activity: details.progress.activity,
            ...(details.currentTool === undefined ? {} : { currentTool: details.currentTool }),
            ...(details.lastAssistantLine === undefined ? {} : { lastAssistantLine: details.lastAssistantLine }),
            turns: details.turns,
            ...(details.toolCalls === undefined ? {} : { toolCalls: details.toolCalls }),
          }
          bridge.publishActivity(activity)
          statusUi.onActivity({
            ...activity,
            activity: activity.currentTool ?? activity.lastAssistantLine ?? activity.activity,
          })
        }),
      )
    }
  }
  const wakeSource = createDagWakeSource({
    pi: deps.pi,
    manager: queryManager,
    sessionId: () => deps.engine.runtime.sessionId(),
  })
  const wake =
    deps.coordinator === undefined
      ? undefined
      : createDagWake({
          coordinator: deps.coordinator,
          parentState: () => deps.engine.runtime.parentState(),
          getReceiverModel: () => deps.engine.runtime.parentModel(),
        })
  const terminalWakeSeq = new Map<DagRunId, number>()
  const pausedWakeSeq = new Map<DagRunId, number>()

  // A pause is not terminal (the run stays live in the wake source and resumes next session), but it
  // must still reach the parent: a reload/shutdown suspends in-flight runs, and without this the
  // session is never told its DAG stopped. Dedupe keys are separate so a pause and a later terminal
  // never suppress one another.
  const notifyPaused = (event: DagRunEvent & { readonly type: "dag.run.paused" }): void => {
    if ((pausedWakeSeq.get(event.runId) ?? 0) >= event.seq) return
    pausedWakeSeq.set(event.runId, event.seq)
    const record = baseStore.readCheckpoint<DagRunRecordV1>(event.runId)
    if (record === null || record.parentSessionId !== activeSessionId) return
    wake?.onRunEvent(
      { runId: record.runId, name: record.name, parentSessionId: record.parentSessionId },
      {
        runId: event.runId,
        seq: event.seq,
        type: event.type,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      },
    )
  }

  const onEvent = (event: DagRunEvent): void => {
    if (event.type === "dag.run.started") wakeSource.onRunStart(event.runId)
    if (event.type === "dag.run.paused") {
      if (event.reason === DAG_UNATTACHED_NODES_PAUSE_REASON) {
        deps.logger.error("omo-senpi dag run parked: its scheduler holds none of the children its nodes record", {
          runId: event.runId,
        })
      }
      notifyPaused(event)
      return
    }
    if (event.type !== "dag.run.completed" && event.type !== "dag.run.failed" && event.type !== "dag.run.cancelled")
      return
    wakeSource.onRunTerminal(event.runId)
    if ((terminalWakeSeq.get(event.runId) ?? 0) >= event.seq) return
    terminalWakeSeq.set(event.runId, event.seq)
    const record = baseStore.readCheckpoint<DagRunRecordV1>(event.runId)
    if (record === null || record.parentSessionId !== activeSessionId) return
    wake?.onRunEvent(
      { runId: record.runId, name: record.name, parentSessionId: record.parentSessionId },
      {
        runId: event.runId,
        seq: event.seq,
        type: event.type,
        counts: event.counts,
        ...(event.type === "dag.run.failed" ? { error: event.error } : {}),
      },
    )
  }

  const recovery = createDagRecovery({
    store,
    taskManager,
    ...(deps.pausedChildren === undefined ? {} : { pausedChildren: deps.pausedChildren }),
    isProcessAlive,
    // A holder pid equal to our own says nothing about liveness (a process can always signal itself);
    // what fences the claim is whether THIS runtime still schedules the run. A disposed predecessor
    // runtime in the same process (saved-session reopen, #8006) keeps its own map, so it never fences.
    isRunHeldInProcess: holdsRun,
    reservations,
    ...(deps.engine.ancestry === undefined ? {} : { ancestry: deps.engine.ancestry }),
    ...(deps.nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy: deps.nodeSpawnPolicy }),
    ...(dagSettings?.subscriber_ring === undefined ? {} : { subscriberRing: dagSettings.subscriber_ring }),
    stopAdmission: (runId) => stoppedAdmissions.add(runId),
    reattach: (runId, taskId) => {
      const key = `${runId}\0${taskId}`
      if (recoveryTaskSubscriptions.has(key)) return
      recoveryTaskSubscriptions.set(
        key,
        deps.engine.manager.subscribeChild(taskId, () => mutationListener()),
      )
    },
  })

  durableEventListener = onEvent
  mutationListener = () => {
    bridge.sync()
    bridge.notifyStoreMutation()
    syncActivitySubscriptions()
    statusUi.scheduleSync()
  }

  const sweeps = createDagRecoverySweeps({
    leaseWatch: deps.leaseWatch ?? {},
    logger: deps.logger,
    install: async (scope) => {
      try {
        return await recovery.installPausedRuns(scope.sessionId, adoptInstalled, scope.forkSourceSessionId)
      } finally {
        clearSubscriptions(recoveryTaskSubscriptions)
      }
    },
    // A run recovery left to a live holder stays `running` and unheld here, which ensureScheduled refuses.
    afterSweep: (sessionId) => {
      for (const run of manager.list(sessionId)) ensureScheduled(run.runId, sessionId)
    },
    activeSessionId: () => activeSessionId,
    onRecovered: () => mutationListener(),
  })

  const unregisterPauseSource = registerDagPauseSource({
    deps,
    coreManager,
    store,
    schedulerOptions,
    schedulers,
    reservations,
    stoppedAdmissions,
    clearAdmissionLatch,
    recovery,
    adoptInstalled,
    cancelRun,
  })
  const runtime: DagRuntime = {
    cancelNode,
    manager,
    wait,
    cancel,
    retry,
    send,
    amend,
    guide,
    taskRecord: (taskId) => deps.engine.manager.get(taskId),
    async attach(event) {
      sweeps.open()
      activeSessionId = deps.engine.runtime.sessionId()
      durableEventListener = onEvent
      wake?.onSessionStart(activeSessionId)
      const sessionId = activeSessionId
      if (sessionId !== undefined) {
        const forkSource = await resolveDagForkSource({
          event,
          currentSessionId: sessionId,
          currentSessionFile: deps.engine.runtime.sessionFile(),
        })
        if (forkSource.kind === "own-only" && forkSource.diagnostic !== undefined) {
          deps.logger.warn("omo-senpi DAG fork source rejected; recovering own runs only", {
            sessionId,
            reason: forkSource.diagnostic,
          })
        }
        await sweeps.recover({
          sessionId,
          ...(forkSource.kind === "source" ? { forkSourceSessionId: forkSource.sessionId } : {}),
        })
      }
      // #7316 defect 1: the bridge attaches AFTER recovery so its first emitted snapshot reflects
      // the recovered runs. Attaching first pushed a pre-recovery paused projection, and wholesale
      // consumers (omo-desktop) read a run missing-or-paused as "the dag finished". While recovery
      // runs the bridge is silent, which consumers treat as "no change" - dark beats lying.
      bridge.attach()
      syncActivitySubscriptions()
      statusUi.syncNow()
    },
    sync() {
      bridge.sync()
      bridge.notifyStoreMutation()
      statusUi.scheduleSync()
    },
    resend() {
      bridge.resend()
    },
    detach() {
      durableEventListener = () => undefined
      const detachedListeners = new Map([...runListeners].map(([runId, listeners]) => [runId, new Set(listeners)]))
      const stopping = [...schedulers].map(([runId, owned]) => owned.scheduler.cancel(runId, "runtime detached"))
      void Promise.allSettled(stopping).then(() => removeListeners(runListeners, detachedListeners))
      sweeps.cancelWatches()
      clearSubscriptions(recoveryTaskSubscriptions)
      clearSubscriptions(activityTaskSubscriptions)
      bridge.detach()
      activeSessionId = undefined
      statusUi.dispose()
    },
    pauseForShutdown: createShutdownPause({
      sweeps,
      reservations,
      schedulers,
      recovery,
      sessionId: () => activeSessionId ?? deps.engine.runtime.sessionId(),
      sessionRuns: (sessionId) => manager.list(sessionId).map((run) => run.runId),
    }),
    dispose() {
      unregisterPauseSource?.()
      stopObservingSchedulers()
      stopFencingResumes()
      sweeps.cancelWatches()
      bridge.dispose()
      activeSessionId = undefined
      statusUi.dispose()
      wakeSource.emitShutdown()
      clearSubscriptions(recoveryTaskSubscriptions)
      clearSubscriptions(activityTaskSubscriptions)
      runListeners.clear()
    },
  }
  return runtime
}

function removeListeners(
  listeners: Map<DagRunId, Set<(event: DagRunEvent) => void>>,
  removing: ReadonlyMap<DagRunId, ReadonlySet<(event: DagRunEvent) => void>>,
): void {
  for (const [runId, stale] of removing) {
    const current = listeners.get(runId)
    if (current === undefined) continue
    for (const listener of stale) current.delete(listener)
    if (current.size === 0) listeners.delete(runId)
  }
}

function clearSubscriptions(subscriptions: Map<string, () => void>): void {
  for (const unsubscribe of subscriptions.values()) unsubscribe()
  subscriptions.clear()
}

function publishDurableEvents(
  store: DagFileStore,
  runId: DagRunId,
  delivered: Map<DagRunId, number>,
  listeners: ReadonlyMap<DagRunId, ReadonlySet<(event: DagRunEvent) => void>>,
  onEvent: (event: DagRunEvent) => void,
): void {
  let sinceSeq = delivered.get(runId) ?? 0
  for (;;) {
    const page = store.readEvents(runId, sinceSeq, { limit: EVENT_PAGE_SIZE })
    for (const event of page.events) {
      delivered.set(runId, event.seq)
      deliverDurableEvent(onEvent, event)
      for (const listener of listeners.get(runId) ?? []) deliverDurableEvent(listener, event)
    }
    if (!page.hasMore) return
    sinceSeq = page.nextSinceSeq
  }
}

function deliverDurableEvent(listener: (event: DagRunEvent) => void, event: DagRunEvent): void {
  try {
    listener(event)
  } catch (error) {
    console.error("DAG runtime subscriber failed", error)
  }
}

function runsForActiveSession(manager: DagManager, engine: TaskEngine) {
  const sessionId = engine.runtime.sessionId()
  return sessionId === undefined ? [] : manager.list(sessionId)
}

function snapshotsForActiveSession(manager: DagManager, engine: TaskEngine) {
  const sessionId = engine.runtime.sessionId()
  if (sessionId === undefined) return []
  return manager.list(sessionId).map((run) => ({
    ...manager.snapshot(run.runId, sessionId),
    updatedAt: run.updatedAt,
  }))
}
