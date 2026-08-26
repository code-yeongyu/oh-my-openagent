// allow: SIZE_OK - this is the DAG composition root: one manager/store graph must be shared by the
// tool, scheduler, RPC, TUI, wake, and lifecycle adapters or live runs split into isolated islands.
import {
  createChildProgress,
  type ManagedChildEvent,
  type TaskManager,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"
import {
  createDagFileStore,
  createDagManager,
  createDagRecovery,
  createDagWaitSurface,
  type DagDefinition,
  type DagFileStore,
  type DagNodeSpawnPolicy,
  type DagManager,
  type DagNodeId,
  type DagRunEvent,
  type DagRunId,
  type DagRunRecordV1,
  type DagRunSnapshot,
  type DagScheduler,
  type OwnedStartResult,
} from "@oh-my-opencode/senpi-task/dag"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import { createDagRpcBridge, type DagBridgeTimers } from "./dag-rpc-bridge"
import { registerDagRpcHandlers } from "./dag-rpc-handlers"
import { createDagStatusUi, type DagStatusUiTimers } from "./dag-status-ui"
import { createDagWake } from "./dag-wake"
import { createDagWakeSource } from "./dag-wake-source"
import type { TaskEngine } from "./engine"
import {
  createDagScheduler,
  observeDagSchedulers,
  reenterDagRun,
  type DagNodeSendResult,
  type DagRunReentry,
} from "../../../../senpi-task/src/dag/scheduler"
import { createDagSkillMaterializer } from "../../../../senpi-task/src/dag/skills"

const EVENT_PAGE_SIZE = 1000
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"])
const SCHEDULABLE_RUN_STATUSES = new Set(["pending", "running"])
type DagRuntimeManager = Omit<DagManager, "attach"> & {
  readonly attach: ReturnType<typeof createDagWaitSurface>["attach"]
}

export interface DagRuntime {
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
  readonly taskRecord: (taskId: string) => TaskRecord | undefined
  attach(): Promise<void>
  sync(): void
  detach(): void
  pauseForShutdown(): void
  dispose(): void
}

export interface DagRuntimeDeps {
  readonly pi: SenpiExtensionAPI
  readonly engine: TaskEngine
  readonly logger: ComponentLogger
  readonly nodeSpawnPolicy?: DagNodeSpawnPolicy
  readonly coordinator?: IdleInjectionCoordinator
  readonly bridgeTimers?: DagBridgeTimers
  readonly statusUiTimers?: DagStatusUiTimers
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
  const runListeners = new Map<DagRunId, Set<(event: DagRunEvent) => void>>()
  const deliveredSeq = new Map<DagRunId, number>()
  const schedulers = new Map<DagRunId, { readonly scheduler: DagScheduler; running?: Promise<DagRunRecordV1> }>()
  const stoppedAdmissions = new Set<DagRunId>()
  const recoveryTaskSubscriptions = new Map<string, () => void>()
  const activityTaskSubscriptions = new Map<string, () => void>()
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
    ...(dagSettings === undefined ? {} : { settings: dagSettings }),
  })
  const taskManager = admissionTaskManager(
    deps.engine.manager,
    (runId) => stoppedAdmissions.has(runId),
  )
  // Every scheduler this runtime builds - first run, re-entry after retry, re-entry after amend -
  // shares one option set so a resumed run keeps the same execution mode, spawn policy, and skill
  // materialization the original admission had.
  const schedulerOptions = {
    store,
    taskManager,
    materializeSkills,
    executionMode: { agents: deps.engine.agents, config: deps.engine.omoConfig },
    ...(deps.nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy: deps.nodeSpawnPolicy }),
    ...(dagSettings?.subscriber_ring === undefined ? {} : { subscriberRing: dagSettings.subscriber_ring }),
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

  const publishSchedulerEvent = (event: DagRunEvent): void => {
    if ((deliveredSeq.get(event.runId) ?? 0) >= event.seq) return
    deliveredSeq.set(event.runId, event.seq)
    deliverDurableEvent(durableEventListener, event)
    for (const listener of runListeners.get(event.runId) ?? []) deliverDurableEvent(listener, event)
  }
  const stopObservingSchedulers = observeDagSchedulers(taskManager, (scheduler) => {
    scheduler.subscribe(publishSchedulerEvent)
  })

  const controller = (runId: DagRunId, parentSessionId: string): { readonly scheduler: DagScheduler; running?: Promise<DagRunRecordV1> } => {
    const existing = schedulers.get(runId)
    if (existing !== undefined) return existing
    const initialRecord = coreManager.record(runId, parentSessionId)
    const scheduler = createDagScheduler({ ...schedulerOptions, initialRecord })
    const created: { readonly scheduler: DagScheduler; running?: Promise<DagRunRecordV1> } = { scheduler }
    schedulers.set(runId, created)
    return created
  }

  const ensureScheduled = (runId: DagRunId, parentSessionId: string): void => {
    const initialRecord = coreManager.record(runId, parentSessionId)
    if (!SCHEDULABLE_RUN_STATUSES.has(initialRecord.status)) return
    const owned = controller(runId, parentSessionId)
    if (owned.running !== undefined) return
    const running = owned.scheduler.run()
      .then(async (record) => {
        await owned.scheduler.whenIdle()
        return record
      })
      .finally(() => schedulers.delete(runId))
    owned.running = running
    void running.catch((error: unknown) => {
      deps.logger.error("omo-senpi dag scheduler failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const cancel = async (runId: DagRunId, reason?: string): Promise<void> => {
    const sessionId = deps.engine.runtime.sessionId() ?? ""
    const record = coreManager.record(runId, sessionId)
    if (TERMINAL_RUN_STATUSES.has(record.status)) return
    await controller(runId, sessionId).scheduler.cancel(runId, reason)
  }

  /**
   * The single re-entry seam for the control verbs. The settled scheduler deleted itself from
   * `schedulers` on settle, so the fresh instance the verb built must be re-registered here or the
   * next cancel/wait would silently build a THIRD scheduler over a live run. The admission latch is
   * cleared for the same reason it must be cleared at all: only recovery's shutdown pause ever sets
   * it, it lives in this closure so it outlives every scheduler, and nothing else ever deletes it -
   * a retry after a pause+resume in the SAME process would otherwise hang forever on the
   * never-resolving admission promise instead of starting a child.
   */
  const adoptReentry = (runId: DagRunId, reentry: DagRunReentry): void => {
    const owned: { readonly scheduler: DagScheduler; running?: Promise<DagRunRecordV1> } = { scheduler: reentry.scheduler }
    schedulers.set(runId, owned)
    const running = reentry.run
      .then(async (record) => {
        await reentry.scheduler.whenIdle()
        return record
      })
      .finally(() => {
        if (schedulers.get(runId) === owned) schedulers.delete(runId)
      })
    owned.running = running
    void running.catch((error: unknown) => {
      deps.logger.error("omo-senpi dag scheduler failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const clearAdmissionLatch = (runId: DagRunId): void => {
    stoppedAdmissions.delete(runId)
  }

  const retry = async (
    runId: DagRunId,
    nodeIds?: readonly string[],
    options?: { readonly prompt?: string },
  ): Promise<DagRunSnapshot> => {
    const sessionId = deps.engine.runtime.sessionId() ?? ""
    coreManager.record(runId, sessionId)
    clearAdmissionLatch(runId)
    const scheduler = controller(runId, sessionId).scheduler
    // Node ids arrive as untrusted tool JSON; the engine's branded id is a compile-time tag over the
    // same string, and the engine itself rejects an id no node carries.
    const targets = nodeIds as readonly DagNodeId[] | undefined
    const reentry = options?.prompt === undefined
      ? scheduler.retryNode(runId, targets)
      : scheduler.retryNode(runId, targets, { prompt: options.prompt })
    adoptReentry(runId, reentry)
    return coreManager.snapshot(runId, sessionId)
  }

  const send = async (runId: DagRunId, nodeId: string, message: string): Promise<DagNodeSendResult> => {
    const sessionId = deps.engine.runtime.sessionId() ?? ""
    coreManager.record(runId, sessionId)
    return await controller(runId, sessionId).scheduler.sendToNode(runId, nodeId as DagNodeId, message)
  }

  const amend = async (runId: DagRunId, definition: DagDefinition): Promise<DagRunSnapshot> => {
    const sessionId = deps.engine.runtime.sessionId() ?? ""
    const amended = await coreManager.amend({ runId, definition, parentSessionId: sessionId })
    clearAdmissionLatch(runId)
    schedulers.delete(runId)
    adoptReentry(runId, reenterDagRun({ ...schedulerOptions, initialRecord: amended }))
    return coreManager.snapshot(runId, sessionId)
  }

  const waitSurface = createDagWaitSurface({ store, subscribe, cancel })
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
      ensureScheduled(result.snapshot.runId, params.parentSessionId)
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
    liveRuns: () => runsForActiveSession(manager, deps.engine).map((summary) => ({
      runId: summary.runId,
      status: summary.status,
      subscribe: (listener) => subscribe(summary.runId, listener),
    })),
    runSnapshots: () => snapshotsForActiveSession(manager, deps.engine),
    parentSessionId: () => deps.engine.runtime.sessionId(),
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
          if (node.taskId !== undefined && node.state !== "completed" && node.state !== "failed" &&
            node.state !== "cancelled" && node.state !== "skipped") {
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
      )
      activityTaskSubscriptions.set(taskId, deps.engine.manager.subscribeChild(taskId, (event: ManagedChildEvent) => {
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
      }))
    }
  }
  const wakeSource = createDagWakeSource({ pi: deps.pi, manager: queryManager, sessionId: () => deps.engine.runtime.sessionId() })
  const wake = deps.coordinator === undefined
    ? undefined
    : createDagWake({ coordinator: deps.coordinator, parentState: () => deps.engine.runtime.parentState() })
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
      notifyPaused(event)
      return
    }
    if (event.type !== "dag.run.completed" && event.type !== "dag.run.failed" && event.type !== "dag.run.cancelled") return
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
    ...(deps.nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy: deps.nodeSpawnPolicy }),
    ...(dagSettings?.subscriber_ring === undefined ? {} : { subscriberRing: dagSettings.subscriber_ring }),
    stopAdmission: (runId) => stoppedAdmissions.add(runId),
    reattach: (runId, taskId) => {
      const key = `${runId}\0${taskId}`
      if (recoveryTaskSubscriptions.has(key)) return
      recoveryTaskSubscriptions.set(key, deps.engine.manager.subscribeChild(taskId, () => mutationListener()))
    },
  })

  durableEventListener = onEvent
  mutationListener = () => {
    bridge.sync()
    bridge.notifyStoreMutation()
    syncActivitySubscriptions()
    statusUi.scheduleSync()
  }

  const runtime: DagRuntime = {
    manager,
    wait,
    cancel,
    retry,
    send,
    amend,
    taskRecord: (taskId) => deps.engine.manager.get(taskId),
    async attach() {
      activeSessionId = deps.engine.runtime.sessionId()
      durableEventListener = onEvent
      wake?.onSessionStart(activeSessionId)
      const sessionId = activeSessionId
      if (sessionId !== undefined) {
        try {
          await recovery.resumePausedRuns(sessionId)
        } finally {
          clearSubscriptions(recoveryTaskSubscriptions)
        }
        for (const run of manager.list(sessionId)) ensureScheduled(run.runId, sessionId)
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
    detach() {
      durableEventListener = () => undefined
      const detachedListeners = new Map([...runListeners].map(([runId, listeners]) => [runId, new Set(listeners)]))
      const stopping = [...schedulers].map(([runId, owned]) =>
        owned.scheduler.cancel(runId, "runtime detached"),
      )
      void Promise.allSettled(stopping).then(() => removeListeners(runListeners, detachedListeners))
      clearSubscriptions(recoveryTaskSubscriptions)
      clearSubscriptions(activityTaskSubscriptions)
      bridge.detach()
      activeSessionId = undefined
      statusUi.dispose()
    },
    pauseForShutdown() {
      const sessionId = activeSessionId ?? deps.engine.runtime.sessionId()
      if (sessionId !== undefined) recovery.pauseRunsForShutdown(sessionId)
    },
    dispose() {
      stopObservingSchedulers()
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

function admissionTaskManager(
  manager: TaskManager,
  admissionStopped: (runId: DagRunId) => boolean,
): TaskManager {
  return new Proxy(manager, {
    get(target, property) {
      if (property === "startOwned") {
        return (spec: Parameters<TaskManager["startOwned"]>[0], owner: Parameters<TaskManager["startOwned"]>[1]) => {
          if (admissionStopped(owner.runId)) return stoppedAdmission()
          return target.startOwned({ ...spec, run_in_background: false }, owner)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

function stoppedAdmission(): Promise<OwnedStartResult> {
  return new Promise<OwnedStartResult>(() => undefined)
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
