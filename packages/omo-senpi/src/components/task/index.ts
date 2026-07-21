import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { Message } from "@oh-my-opencode/team-core/types"
import {
  TEAM_LEAD_SENTINEL,
  WaitRegistry,
  buildLeadTeamTools,
  createTaskCancelTool,
  createTaskOutputTool,
  createTaskSendTool,
  createTaskTool,
  defaultResolveCallerSessionId,
  resolveTeamRuntimeDirs,
  teamStorageBaseDir,
  toTeamCoreConfig,
  type TeamToolsService,
  type WaitBounds,
} from "@oh-my-opencode/senpi-task"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { shouldWarnDualConfig } from "./coexistence"
import { registerTaskCommands } from "./commands"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { TASK_USAGE_HINT_FLAG, wireEventBridge } from "./event-bridge"
import { createLeadPollerLifecycle, type LeadPollerLifecycle } from "./lead-poller-lifecycle"
import { detectOpencodeConfig } from "./opencode-config"
import { TASK_COMPLETION_MESSAGE_TYPE } from "./parent-notifier"
import { renderTaskCompletion } from "./renderers"
import { createTeamMailboxReconciler, createTeamService } from "./team-service"
import { createSessionTransitionBridge } from "./session-transition-bridge"
import { wireSessionStartProcessSweep } from "./process-sweep"
import { createTaskStatusUi } from "./status-ui"
import { missingTaskCapabilities } from "./surface"

const TASK_ENABLED_FLAG = "omo-task"

export { wireEventBridge } from "./event-bridge"

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
      // Unconditional omo process hygiene (T16): fires on session_start before any
      // flag/capability gate can skip the rest of the component.
      wireSessionStartProcessSweep(pi, ctx)

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
      const teamTools = createTeamToolContext(pi, ctx, engine)
      registerTaskTools(pi, engine, teamTools.service)
      registerTeamTools(pi, teamTools, engine.settings.wait)
      registerTaskCommands(pi, engine.manager)

      const statusUi = createTaskStatusUi({ manager: engine.manager, runtime: engine.runtime })
      engine.onStoreMutation(() => statusUi.scheduleSync())
      const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })

      wireEventBridge(pi, ctx, engine, statusUi, transitions, {
        warnDualConfig: shouldWarnDualConfig({ sources: loaded.sources, hasOpencodeConfig: detectOpencodeConfig(cwd) }),
        reconcileTeamMailbox: teamTools.reconcileTeamMailbox,
        leadPollers: teamTools.leadPollers,
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
function registerTaskTools(pi: SenpiExtensionAPI, engine: TaskEngine, teamService: TeamToolsService): void {
  const resolveCallerSessionId = defaultResolveCallerSessionId
  const manager = engine.manager
  pi.registerTool({ ...createTaskTool({ manager, omoConfig: engine.omoConfig, agents: engine.agents }) })
  pi.registerTool({
    ...createTaskSendTool({ manager, resolveCallerSessionId, teamRouting: { service: teamService, from: TEAM_LEAD_SENTINEL } }),
  })
  pi.registerTool({ ...createTaskCancelTool({ manager }) })
  pi.registerTool({ ...createTaskOutputTool({ manager, stateDir: engine.stateDir, waitConfig: engine.settings.wait, resolveCallerSessionId }) })
}

function createTeamToolContext(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  engine: TaskEngine,
): TeamToolContext {
  const serviceDeps = {
    manager: engine.manager,
    runtime: engine.runtime,
    settings: engine.settings,
    omoConfig: engine.omoConfig,
    cwd: engine.runtime.cwd(),
    agentNames: new Set(Object.keys(engine.agents)),
  }
  const service = createTeamService(serviceDeps)
  const stateDir = {
    project_dir: serviceDeps.cwd,
    ...(engine.settings.state_dir !== undefined ? { task: { state_dir: engine.settings.state_dir } } : {}),
  }
  const waitRegistry = new WaitRegistry<Message>()
  const leadPollers = createLeadPollerLifecycle({
    listTeams: service.listTeams,
    runtime: engine.runtime,
    config: toTeamCoreConfig(engine.settings, teamStorageBaseDir(stateDir)),
    runtimeDir: (teamRunId) => resolveTeamRuntimeDirs(stateDir, teamRunId).runtimeDir,
    waitRegistry,
    appendTaskEvent: engine.appendTaskEvent,
    pi,
    logger: ctx.logger,
    ...(ctx.idleCoordinator !== undefined ? { coordinator: ctx.idleCoordinator } : {}),
  })
  return { service, reconcileTeamMailbox: createTeamMailboxReconciler(serviceDeps), waitRegistry, leadPollers }
}

type TeamToolContext = {
  readonly service: TeamToolsService
  readonly reconcileTeamMailbox: () => Promise<void>
  readonly waitRegistry: WaitRegistry<Message>
  readonly leadPollers: LeadPollerLifecycle
}

function registerTeamTools(pi: SenpiExtensionAPI, context: TeamToolContext, waitBounds: WaitBounds): void {
  for (const tool of buildLeadTeamTools({
    service: context.service,
    waitBounds,
    registry: context.waitRegistry,
    resolveLeadPoller: context.leadPollers.resolveLeadPoller,
    resolveTeamRunId: context.leadPollers.resolveTeamRunId,
  })) pi.registerTool({ ...tool })
}
