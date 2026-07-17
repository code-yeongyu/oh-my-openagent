import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { DUAL_CONFIG_WARNING } from "./coexistence"
import type { TaskEngine } from "./engine"
import type { LeadPollerLifecycle } from "./lead-poller-lifecycle"
import type { LiveTaskContext } from "./runtime-context"
import type { SessionTransitionBridge } from "./session-transition-bridge"
import type { TaskStatusUi } from "./status-ui"
import { createOncePerSessionGuard, TASK_USAGE_GUIDANCE } from "./usage-guidance"

export const TASK_USAGE_HINT_FLAG = "omo-task-usage-hint"

type EventBridgeState = {
  readonly warnDualConfig: boolean
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
  let warnedDualConfig = false
  const guidanceGuard = createOncePerSessionGuard()

  pi.on("session_start", async (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    transitions.onSessionStart(engine.runtime.sessionId())
    await engine.lifecycle.reconcileOnSessionStart()
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
    if (state.warnDualConfig && !warnedDualConfig) {
      warnedDualConfig = true
      notifyOrLog(engine, ctx, DUAL_CONFIG_WARNING)
    }
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

  pi.on("agent_end", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    const coordinator = ctx.idleCoordinator
    if (coordinator === undefined) return undefined
    queueMicrotask(() => coordinator.flushOnIdle())
    return undefined
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

function notifyOrLog(engine: TaskEngine, ctx: ComponentContext, message: string): void {
  const ui = engine.runtime.ui()
  if (ui !== undefined) {
    ui.notify(message, "warning")
    return
  }
  ctx.logger.warn(message)
}

function asLiveContext(value: unknown): LiveTaskContext {
  return isLiveContext(value) ? value : {}
}

function isLiveContext(value: unknown): value is LiveTaskContext {
  return typeof value === "object" && value !== null
}
