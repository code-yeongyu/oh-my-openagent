import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import type { TaskEngine } from "./engine"
import type { LeadPollerLifecycle } from "./lead-poller-lifecycle"
import type { LiveTaskContext } from "./runtime-context"
import { wireReloadGuard } from "./reload-guard"
import type { SessionTransitionBridge } from "./session-transition-bridge"
import type { TaskStatusUi } from "./status-ui"
import { createOncePerSessionGuard, TASK_USAGE_GUIDANCE } from "./usage-guidance"

export const TASK_USAGE_HINT_FLAG = "omo-task-usage-hint"

type EventBridgeState = {
  readonly reconcileTeamMailbox: () => Promise<void>
  readonly leadPollers: Pick<LeadPollerLifecycle, "tick" | "shutdown">
}

// Session start runs the durable recovery chain in strict order: reattach process members, reclaim
// mailbox reservations, retry failed completion notices, then opportunistically poll owned leads.
export function wireEventBridge(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  engine: TaskEngine,
  statusUi: TaskStatusUi,
  transitions: SessionTransitionBridge,
  state: EventBridgeState,
): void {
  const guidanceGuard = createOncePerSessionGuard()
  wireReloadGuard(pi, engine.manager)

  pi.on("session_start", async (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    transitions.onSessionStart(engine.runtime.sessionId())
    const reconciliation = await engine.lifecycle.reconcileOnSessionStart()
    for (const outcome of reconciliation.outcomes) {
      const record = engine.manager.get(outcome.task_id)
      // A previous process can persist the terminal transition before its queued team-liveness steer
      // flushes. Re-observe every reconciled record; the notifier filters non-team/non-error states and
      // its persisted liveness epoch suppresses records already delivered in an earlier process.
      if (record !== undefined) await engine.notifyOwnedMemberLiveness(record)
    }
    const cleanup = engine.lifecycle.cleanupExpiredRecords()
    if (cleanup.deleted.length > 0) {
      ctx.logger.info("senpi-task ttl cleanup", { deleted: cleanup.deleted.length, retained: cleanup.retained.length })
    }
    await reconcileTeamMailboxBestEffort(ctx, state)
    const sessionId = engine.runtime.sessionId()
    if (sessionId !== undefined) {
      engine.notifier.reconcileFailedNotifications({ sessionId, parentState: engine.runtime.parentState() })
    }
    await tickLeadPollersBestEffort(ctx, state)
    statusUi.scheduleSync()
  })

  pi.on("session_before_switch", (_payload, eventCtx) => {
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

  pi.on("session_shutdown", async (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    transitions.onShutdown(engine.runtime.sessionId())
    engine.runtime.clearUi()
    statusUi.dispose()
    state.leadPollers.shutdown()
    await engine.lifecycle.teardownOnSessionShutdown()
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

  pi.on("before_agent_start", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    if (ctx.config.getFlag(TASK_USAGE_HINT_FLAG) === false) return undefined
    const sessionId = engine.runtime.sessionId() ?? "unknown-session"
    if (!guidanceGuard(sessionId)) return undefined
    pi.sendMessage(
      { customType: "senpi-task.usage", content: TASK_USAGE_GUIDANCE, display: false, details: {} },
      {},
    )
    return undefined
  })
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
