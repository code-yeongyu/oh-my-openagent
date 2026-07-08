import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  buildLeadTeamTools,
  createTaskCancelTool,
  createTaskInterruptTool,
  createTaskListTool,
  createTaskOutputTool,
  createTaskSendTool,
  createTaskTool,
  createTaskWaitTool,
  defaultResolveCallerSessionId,
} from "@oh-my-opencode/senpi-task"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { shouldWarnDualConfig, DUAL_CONFIG_WARNING } from "./coexistence"
import { registerTaskCommands } from "./commands"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { detectOpencodeConfig } from "./opencode-config"
import { TASK_COMPLETION_MESSAGE_TYPE } from "./parent-notifier"
import { renderTaskCompletion } from "./renderers"
import { TEAM_MESSAGE_MESSAGE_TYPE, createTeamMessageNotifier } from "./team-message-notifier"
import { renderTeamMessage } from "./team-renderers"
import { createTeamMailboxReconciler, createTeamService } from "./team-service"
import type { LiveTaskContext } from "./runtime-context"
import { createSessionTransitionBridge, type SessionTransitionBridge } from "./session-transition-bridge"
import { createTaskStatusUi, type TaskStatusUi } from "./status-ui"
import { missingTaskCapabilities } from "./surface"
import { createOncePerSessionGuard, TASK_USAGE_GUIDANCE } from "./usage-guidance"

const TASK_ENABLED_FLAG = "omo-task"
const TASK_USAGE_HINT_FLAG = "omo-task-usage-hint"

export interface TaskComponentOptions {
  // Project root the task engine anchors its state dir + omo.json load to. Defaults to the senpi
  // launch cwd; injectable so tests never write task state into the repo working tree.
  readonly resolveCwd?: () => string
}

export function createTaskComponent(options: TaskComponentOptions = {}): OmoSenpiComponent {
  const resolveCwd = options.resolveCwd ?? (() => process.cwd())
  return {
    name: "task",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      registerTaskFlags(pi)
      if (pi.getFlag(TASK_ENABLED_FLAG) === false) {
        ctx.logger.info("omo-senpi task component disabled by flag")
        return
      }

      const missing = missingTaskCapabilities(pi)
      if (missing.length > 0) {
        ctx.logger.warn("omo-senpi task component skipped: missing ExtensionAPI capabilities", { missing })
        return
      }

      const cwd = resolveCwd()
      const loaded = loadOmoConfig({ cwd })
      if (loaded.diagnostics.length > 0) {
        ctx.logger.warn("omo-senpi task component using default config after omo.json load issues", {
          diagnostics: loaded.diagnostics.map((diagnostic) => diagnostic.message),
        })
      }

      const engine = composeTaskEngine({
        pi,
        omoConfig: loaded.config,
        cwd,
        sharedParentTools: () => ctx.getCapturedTools?.() ?? [],
        ...(ctx.idleCoordinator !== undefined && { coordinator: ctx.idleCoordinator }),
      })

      pi.registerMessageRenderer?.(TASK_COMPLETION_MESSAGE_TYPE, renderTaskCompletion)
      pi.registerMessageRenderer?.(TEAM_MESSAGE_MESSAGE_TYPE, renderTeamMessage)
      registerTaskTools(pi, engine)
      const reconcileTeamMailbox = registerTeamTools(pi, ctx, engine)
      registerTaskCommands(pi, engine.manager)

      const statusUi = createTaskStatusUi({ manager: engine.manager, runtime: engine.runtime })
      engine.onStoreMutation(() => statusUi.scheduleSync())
      const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })

      wireEventBridge(pi, ctx, engine, statusUi, transitions, {
        warnDualConfig: shouldWarnDualConfig({ sources: loaded.sources, hasOpencodeConfig: detectOpencodeConfig(cwd) }),
        reconcileTeamMailbox,
      })
    },
  }
}

function registerTaskFlags(pi: SenpiExtensionAPI): void {
  pi.registerFlag(TASK_ENABLED_FLAG, {
    type: "boolean",
    default: true,
    description: "Enable the omo-senpi task engine (use --no-omo-task to disable).",
  })
  pi.registerFlag(TASK_USAGE_HINT_FLAG, {
    type: "boolean",
    default: true,
    description: "Inject once-per-session omo-senpi task usage guidance.",
  })
}

// senpi-task tool factories return fully-typed ToolDefinitions whose typed renderCall breaks a plain
// structural assignment to the registerTool(Record) seam; spreading each into a fresh object literal
// lands it through the record-shaped registration boundary without a cast (no behavioural change).
function registerTaskTools(pi: SenpiExtensionAPI, engine: TaskEngine): void {
  const resolveCallerSessionId = defaultResolveCallerSessionId
  const manager = engine.manager
  pi.registerTool({ ...createTaskTool({ manager, omoConfig: engine.omoConfig, agents: engine.agents }) })
  pi.registerTool({ ...createTaskSendTool({ manager, resolveCallerSessionId }) })
  pi.registerTool({ ...createTaskWaitTool({ manager, waitConfig: engine.settings.wait, resolveCallerSessionId }) })
  pi.registerTool({ ...createTaskInterruptTool({ manager }) })
  pi.registerTool({ ...createTaskCancelTool({ manager }) })
  pi.registerTool({ ...createTaskListTool({ manager, resolveCallerSessionId }) })
  pi.registerTool({ ...createTaskOutputTool({ manager, stateDir: engine.stateDir, resolveCallerSessionId }) })
}

// The 12 lead-only team tools, bound to the live task engine + the idle-coordinator-backed lead
// notifier so a team lead-message wake shares the completion push's one-wake-per-idle-edge. Registered
// only on the lead (current) session; the manager's shared-tool filter strips the whole team_* family
// from member children, and only the pre-scoped member team_send_message is re-added (see team-service).
function registerTeamTools(pi: SenpiExtensionAPI, ctx: ComponentContext, engine: TaskEngine): () => Promise<void> {
  const leadNotifier = createTeamMessageNotifier(pi, ctx.idleCoordinator, () => engine.runtime.parentState().kind === "streaming")
  const serviceDeps = {
    manager: engine.manager,
    runtime: engine.runtime,
    settings: engine.settings,
    omoConfig: engine.omoConfig,
    cwd: engine.runtime.cwd(),
    agentNames: new Set(Object.keys(engine.agents)),
    leadNotifier,
  }
  const service = createTeamService(serviceDeps)
  for (const tool of buildLeadTeamTools({ service })) pi.registerTool({ ...tool })
  return createTeamMailboxReconciler(serviceDeps)
}

interface EventBridgeState {
  readonly warnDualConfig: boolean
  // Restores crash-dangling delivery reservations to unread on first session_start (W3-V F1a).
  readonly reconcileTeamMailbox: () => Promise<void>
}

// The task event handlers (pi-task event-bridge parity): session_start reconciles once per process
// (F6), restores runtime context, and flushes any completion buffered while the session was away;
// session_before_switch/before_compact mark the parent transition so completions buffer instead of
// injecting mid-transition (todo 18 inherited obligation); session_compact resumes the same session
// and flushes its buffer; session_shutdown tears residents down; model_select refreshes the inherited
// model registry; before_agent_start injects once-per-session usage guidance. Every handler refreshes
// the captured UI so the footer/widget follow the live session.
export function wireEventBridge(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  engine: TaskEngine,
  statusUi: TaskStatusUi,
  transitions: SessionTransitionBridge,
  state: EventBridgeState,
): void {
  let firstSessionStart = true
  let warnedDualConfig = false
  const guidanceGuard = createOncePerSessionGuard()

  pi.on("session_start", async (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    transitions.onSessionStart(engine.runtime.sessionId())
    if (firstSessionStart) {
      firstSessionStart = false
      await engine.lifecycle.reconcileOnSessionStart()
      await reconcileTeamMailboxBestEffort(ctx, state)
    }
    if (state.warnDualConfig && !warnedDualConfig) {
      warnedDualConfig = true
      notifyOrLog(engine, ctx, DUAL_CONFIG_WARNING)
    }
    statusUi.scheduleSync()
  })

  pi.on("session_before_switch", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    transitions.onBeforeSwitch(engine.runtime.sessionId())
    // Fail-closed on switch: drop the captured ui so a background store mutation in the switch window
    // cannot drive syncNow through the previous session's handle until the next session_start re-captures.
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
    await engine.lifecycle.teardownOnSessionShutdown()
  })

  pi.on("model_select", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    statusUi.scheduleSync()
  })

  // Idle-edge drain: when the parent's turn ends, everything collected in the batch window is
  // delivered NOW as one combined steer, before senpi's print mode can decide the session is over
  // (the 200ms collect timer alone would race a -p exit and lose the wake - live-driver proven).
  // Deferred one microtask so a ulw-loop continuation enqueued by its own agent_end handler on the
  // same edge joins the same injection instead of racing it.
  pi.on("agent_end", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    const coordinator = ctx.idleCoordinator
    if (coordinator === undefined) return undefined
    queueMicrotask(() => {
      coordinator.flushOnIdle()
    })
    return undefined
  })

  pi.on("before_agent_start", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    if (ctx.config.getFlag(TASK_USAGE_HINT_FLAG) === false) return undefined
    const sessionId = sessionIdOf(eventCtx)
    if (!guidanceGuard(sessionId)) return undefined
    pi.sendMessage(
      { customType: "senpi-task.usage", content: TASK_USAGE_GUIDANCE, display: false, details: {} },
      {},
    )
    return undefined
  })
}

// The reconciler is already best-effort per team internally; this top-level guard keeps a reclaim
// failure from ever aborting the first session_start handler.
async function reconcileTeamMailboxBestEffort(ctx: ComponentContext, state: EventBridgeState): Promise<void> {
  try {
    await state.reconcileTeamMailbox()
  } catch (error) {
    ctx.logger.warn("omo-senpi task session-start team mailbox reclaim failed", {
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
  return typeof value === "object" && value !== null ? (value as LiveTaskContext) : {}
}

function sessionIdOf(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const sessionManager = Reflect.get(value, "sessionManager")
    if (typeof sessionManager === "object" && sessionManager !== null) {
      const getSessionId = Reflect.get(sessionManager, "getSessionId")
      if (typeof getSessionId === "function") {
        const id = (getSessionId as () => unknown).call(sessionManager)
        if (typeof id === "string") return id
      }
    }
  }
  return "unknown-session"
}
