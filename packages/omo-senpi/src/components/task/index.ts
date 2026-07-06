import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import {
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
import { composeTaskEngine, type TaskEngine } from "./engine"
import { detectOpencodeConfig } from "./opencode-config"
import { TASK_COMPLETION_MESSAGE_TYPE } from "./parent-notifier"
import { renderTaskCompletion } from "./renderers"
import type { LiveTaskContext } from "./runtime-context"
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
      registerTaskTools(pi, engine)
      wireEventBridge(pi, ctx, engine, {
        warnDualConfig: shouldWarnDualConfig({ sources: loaded.sources, hasOpencodeConfig: detectOpencodeConfig(cwd) }),
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

interface EventBridgeState {
  readonly warnDualConfig: boolean
}

// The 4 task event handlers (pi-task event-bridge parity): session_start reconciles once per process
// (F6) and restores runtime context; session_shutdown tears residents down; model_select refreshes
// the inherited model registry; before_agent_start injects once-per-session usage guidance.
function wireEventBridge(pi: SenpiExtensionAPI, ctx: ComponentContext, engine: TaskEngine, state: EventBridgeState): void {
  let firstSessionStart = true
  let warnedDualConfig = false
  const guidanceGuard = createOncePerSessionGuard()

  pi.on("session_start", async (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    if (firstSessionStart) {
      firstSessionStart = false
      await engine.lifecycle.reconcileOnSessionStart()
    }
    if (state.warnDualConfig && !warnedDualConfig) {
      warnedDualConfig = true
      notifyOrLog(engine, ctx, DUAL_CONFIG_WARNING)
    }
  })

  pi.on("session_shutdown", async (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
    engine.runtime.clearUi()
    await engine.lifecycle.teardownOnSessionShutdown()
  })

  pi.on("model_select", (_payload, eventCtx) => {
    engine.runtime.captureFrom(asLiveContext(eventCtx))
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
