import type { SessionShutdownEvent } from "@code-yeongyu/senpi"
import { readSessionRole } from "@oh-my-opencode/senpi-task"
import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import type { TaskEngine } from "./engine"
import { ownHostedTaskId } from "./own-task-identity"
import type { LeadPollerLifecycle } from "./lead-poller-lifecycle"
import type { ResumptionChannelEmitter } from "./resumption-channel-emitter"
import type { LiveTaskContext } from "./runtime-context"
import { wireReloadGuard, type ReloadGuardDagSource } from "./reload-guard"
import type { SessionTransitionBridge } from "./session-transition-bridge"
import type { TaskStatusUi } from "./status-ui"
import { wireTaskRpcBridge, type TaskRpcBridgeDeps } from "./task-rpc-bridge"
import { wireDagVerificationContext } from "./dag-verification-context"
import { createOncePerSessionGuard, TASK_USAGE_GUIDANCE } from "./usage-guidance"
import { isRunHoldChange, type EngineRunPauseBridge } from "./run-pause-bridge"

export const TASK_USAGE_HINT_FLAG = "omo-task-usage-hint"

type EventBridgeState = {
  readonly runPause?: Pick<EngineRunPauseBridge, "restore" | "reconciled" | "changed">
  readonly reconcileTeamMailbox: () => Promise<void>
  readonly leadPollers: Pick<LeadPollerLifecycle, "tick" | "shutdown">
  readonly resumptionChannels: Pick<ResumptionChannelEmitter, "emitSessionStart" | "emitShutdown">
  // Live DAG runs veto a reload alongside running children: a reload pauses them mid-flight.
  readonly dagReloadSource?: ReloadGuardDagSource
}

// Test-only seams; production wiring omits this and every dependency falls back to its real default.
type EventBridgeDeps = {
  readonly taskRpc?: TaskRpcBridgeDeps
}

// Admission restores local pause/transition state and attaches RPC without waiting on a host.
// Durable recovery keeps its ordering in the background; switching or shutdown retires its tail.

// Below senpi's per-handler session_shutdown budget, leaving room for the suspension that follows.
const SHUTDOWN_LAUNCH_SETTLE_MS = 5_000
/** What the task event bridge hands to the components that must run after its reconcile. */
export interface EventBridge {
  /** Settles when the latest session start's task reconcile finished; false when a newer start superseded it. */
  readonly afterSessionStartReconcile: () => Promise<boolean>
  /** Settles when the latest session start's whole recovery chain (reconcile, liveness, mailbox, cleanup) ended. */
  readonly sessionStartRecovered: () => Promise<void>
}

export function wireEventBridge(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  engine: TaskEngine,
  statusUi: TaskStatusUi,
  transitions: SessionTransitionBridge,
  state: EventBridgeState,
  deps: EventBridgeDeps = {},
): EventBridge {
  const guidanceGuard = createOncePerSessionGuard()
  let startup: AbortController | undefined
  // DAG recovery and workpool reconciliation run after the session-start task reconcile
  // (dag/recovery.ts: "a revivable child already carries a handle here"). Admission does not wait
  // for it; those consumers wait on this ONE gate. It settles false when a newer start superseded it.
  let reconciledGate: Promise<boolean> = Promise.resolve(true)
  let recovered: Promise<void> = Promise.resolve()
  const runPause = state.runPause ?? engine.runPause?.bridge
  wireDagVerificationContext(pi, engine.runtime)
  const taskRpc = wireTaskRpcBridge(pi, engine, deps.taskRpc)
  const unsubscribeTaskSnapshots = engine.onStoreMutation(() => taskRpc.sync())
  wireReloadGuard(pi, engine.manager, state.dagReloadSource)
  if (runPause !== undefined) {
    pi.on("session_hold_changed", (payload, eventCtx) => {
      engine.runtime.captureFrom(asLiveContext(eventCtx))
      const sessionId = engine.runtime.sessionId()
      if (sessionId !== undefined && isRunHoldChange(payload)) return runPause.changed(sessionId, payload)
      return undefined
    })
  }

  pi.on("session_start", async (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    const sessionId = engine.runtime.sessionId()
    // A child session that has not reported its own id yet has nothing to reconcile: its records
    // belong to the parent. The role comes from the session (shared daemon), else from the env.
    if (readSessionRole(pi) !== undefined && sessionId === undefined) {
      // Nothing to reconcile here, but an earlier start's reconcile must not keep running alongside it.
      startup?.abort()
      startup = undefined
      reconciledGate = Promise.resolve(true)
      return
    }
    startup?.abort()
    const controller = new AbortController()
    startup = controller
    const active = () => !controller.signal.aborted
    const reconciled = Promise.withResolvers<boolean>()
    reconciledGate = reconciled.promise
    try {
      if (sessionId !== undefined) await runPause?.restore(sessionId)
      if (!active()) {
        reconciled.resolve(false)
        return
      }
      transitions.onSessionStart(sessionId)
    } catch (error) {
      // A failed restore or transition still settles the gate, so DAG and workpool attach are never
      // stranded behind it; they proceed as they would without the reconcile (#11335 delta review).
      reconciled.resolve(active())
      throw error
    }
    recovered = recoverSession(sessionId, controller.signal, () => reconciled.resolve(active())).catch((error: unknown) => {
      ctx.logger.warn("omo-senpi task session recovery failed", { error: String(error) })
      // A failed reconcile must not strand DAG recovery or the workpools: they proceed as before.
      reconciled.resolve(active())
    })
    void reconciled.promise.then((current) => {
      if (current && sessionId !== undefined) engine.manager.workpools?.attach({ sessionId })
    })
    statusUi.scheduleSync()
    taskRpc.attach()
  })

  async function recoverSession(
    sessionId: string | undefined,
    signal: AbortSignal,
    onReconciled: () => void,
  ): Promise<void> {
    const active = () => !signal.aborted
    const reconciliation = await engine.lifecycle.reconcileOnSessionStart(sessionId, signal)
    if (!active()) return onReconciled()
    if (sessionId !== undefined) await runPause?.reconciled(sessionId)
    onReconciled()
    if (!active()) return
    const livenessRecords = new Map<string, ReturnType<typeof engine.manager.get>>()
    for (const outcome of reconciliation.outcomes) {
      const record = engine.manager.get(outcome.task_id)
      // A previous process can persist the terminal transition before its queued team-liveness steer
      // flushes. Re-observe every reconciled record; the notifier filters non-team/non-error states and
      // its persisted liveness epoch suppresses records already delivered in an earlier process.
      if (record !== undefined) livenessRecords.set(record.task_id, record)
    }
    if (sessionId !== undefined) {
      for (const { record } of engine.manager.list({ scope: "parent-session", session_id: sessionId })) {
        livenessRecords.set(record.task_id, record)
      }
    }
    for (const record of livenessRecords.values()) {
      if (record !== undefined) await engine.notifyOwnedMemberLiveness(record)
      if (!active()) return
    }
    await state.resumptionChannels.emitSessionStart()
    if (!active()) return
    await reconcileTeamMailboxBestEffort(ctx, state)
    if (!active()) return
    if (sessionId !== undefined) {
      engine.notifier.reconcileUnnotifiedNotifications({ sessionId, parentState: engine.runtime.parentState() })
    }
    const cleanup = await engine.lifecycle.cleanupExpiredRecords()
    if (!active()) return
    if (cleanup.deleted.length > 0) {
      ctx.logger.info("senpi-task ttl cleanup", { deleted: cleanup.deleted.length, retained: cleanup.retained.length })
    }
    await tickLeadPollersBestEffort(ctx, state)
    if (!active()) return
    statusUi.scheduleSync()
    taskRpc.sync()
  }

  // A retained session outlives its clients: the first reattach fires session_resumed without
  // another session_start, so the bridge clears the dedupe fingerprint and pushes the full snapshot
  // for the new client, keeping child subscriptions and their live progress intact (#10016).
  pi.on("session_resumed", () => {
    taskRpc.resend()
  })

  pi.on("session_before_switch", (_payload, eventCtx) => {
    startup?.abort()
    taskRpc.detach()
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    transitions.onBeforeSwitch(engine.runtime.sessionId())
    engine.runtime.clearUi()
  })

  pi.on("session_before_compact", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    transitions.onBeforeCompact(engine.runtime.sessionId())
  })

  pi.on("session_compact", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    transitions.onCompact(engine.runtime.sessionId())
    statusUi.scheduleSync()
  })

  pi.on("session_shutdown", async (payload, eventCtx) => {
    startup?.abort()
    const liveContext = asLiveContext(eventCtx)
    unsubscribeTaskSnapshots()
    taskRpc.dispose()
    engine.runtime.captureFrom(liveContext)
    transitions.onShutdown(engine.runtime.sessionId())
    engine.runtime.clearUi()
    statusUi.dispose()
    state.leadPollers.shutdown()
    await state.resumptionChannels.emitShutdown()
    // A first launch still being admitted gets a bounded chance to land, so suspension parks it like
    // any resident child; one still unadmitted is parked to relaunch on resume and never outlives the session (#10042).
    await engine.manager.settleLaunchesForShutdown?.(SHUTDOWN_LAUNCH_SETTLE_MS)
    const shutdownEvent = payload as SessionShutdownEvent
    const parentSessionId = engine.runtime.sessionId()
    const reason = shutdownEvent.reason
    engine.lifecycle.dispose?.()
    if (typeof reason !== "string") {
      ctx.logger.warn(
        "omo-senpi task session_shutdown skipped: malformed reason",
        { parentSessionId, reason },
      )
      return
    }
    // The context can lose its session id during teardown. Only this engine's live handles
    // establish fallback ownership; scanning every record would suspend sibling host sessions.
    const parentSessionIds = parentSessionId === undefined
      ? new Set(engine.manager.residentTaskIds().flatMap((taskId) => {
        const record = engine.manager.get(taskId)
        return record === undefined ? [] : [record.parent_session_id]
      }))
      : new Set([parentSessionId])
    for (const sessionId of parentSessionIds) {
      const continuing = reason === "new" || reason === "quit"
        ? engine.manager.list({ scope: "parent-session", session_id: sessionId })
          .filter(({ record }) => record.killed !== true && (
            (record.status === "running" && record.runner_kind === "host-session") ||
            (record.status === "pending" && record.execution_mode === "process" &&
              engine.settings.process_runner !== "child-process" && engine.settings.resume_children !== false)
          ))
        : []
      const ownTaskId = ownHostedTaskId(pi, engine.stateDir)
      const summary = await engine.lifecycle.suspendOnSessionShutdown(
        ownTaskId === undefined ? { parentSessionId: sessionId, reason } : { parentSessionId: sessionId, reason, ownTaskId },
      )
      const notify = (notice: string, level: "info" | "warning"): void => {
        if (liveContext.mode === "print" || liveContext.mode === "json") process.stderr.write(`${notice}\n`)
        else liveContext.ui?.notify(notice, level)
      }
      // A stopped owner's session can never be resumed, so nothing kept running there to collect.
      if (summary.stopped_owner === undefined) {
        const count = continuing.filter(({ record }) =>
          !summary.failures.some((failure) => failure.task_id === record.task_id)
          && engine.manager.get(record.task_id)?.status !== "cancelled").length
        if (count > 0) notify(`${count} background task(s) keep running under session ${sessionId}; resume it (omo --resume ${sessionId}) to collect their results`, "info")
        continue
      }
      // Only a child that ever started can still be running; a pending one that failed to tear down never ran.
      const unstopped = summary.failures.filter((failure) => {
        const record = engine.manager.get(failure.task_id)
        return record?.started_at !== undefined && (record.status === "running" || record.status === "cancelled")
      }).length
      if (unstopped > 0) notify(`${unstopped} child task(s) of stopped task ${summary.stopped_owner} could not be stopped and may still be running on the task host`, "warning")
    }
  })

  pi.on("model_select", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    statusUi.scheduleSync()
  })

  pi.on("agent_end", async (_payload, eventCtx) => {
    const liveContext = asLiveContext(eventCtx)
    engine.runtime.captureFrom(liveContext)
    const coordinator = ctx.idleCoordinator
    if (coordinator !== undefined) queueMicrotask(() => coordinator.flushOnIdle())
    await engine.memberLiveness.acknowledgePersisted(
      () => liveContext.sessionManager?.getSessionFile?.() ?? engine.runtime.sessionFile(),
    )
  })

  pi.on("before_agent_start", (payload, eventCtx) => {
    if (isPreview(payload)) return undefined
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    if (ctx.config.getFlag(TASK_USAGE_HINT_FLAG) === false) return undefined
    const sessionId = engine.runtime.sessionId() ?? "unknown-session"
    if (!guidanceGuard(sessionId)) return undefined
    pi.sendMessage(
      { customType: "senpi-task.usage", content: TASK_USAGE_GUIDANCE, display: false, details: {} },
      {},
    )
    return undefined
  }, { previewSafe: true })
  return { afterSessionStartReconcile: () => reconciledGate, sessionStartRecovered: () => recovered }
}

async function reconcileTeamMailboxBestEffort(ctx: ComponentContext, state: EventBridgeState): Promise<void> {
  try {
    await state.reconcileTeamMailbox()
  } catch (error) {
    ctx.logger.warn("omo-senpi task session-start team mailbox reclaim failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function tickLeadPollersBestEffort(ctx: ComponentContext, state: EventBridgeState): Promise<void> {
  try {
    await state.leadPollers.tick()
  } catch (error) {
    ctx.logger.warn("omo-senpi task session-start lead poll failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function asLiveContext(value: unknown): LiveTaskContext {
  return isLiveContext(value) ? value : {}
}

function isLiveContext(value: unknown): value is LiveTaskContext {
  return typeof value === "object" && value !== null
}

function isPreview(value: unknown): boolean {
  return typeof value === "object" && value !== null && "preview" in value && value.preview === true
}
