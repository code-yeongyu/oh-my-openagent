import { loadSenpiOmoConfig } from "../config-resolution"
import {
  TEAM_LEAD_SENTINEL,
  buildLeadTeamTools,
  createLeadDeliveryJournal,
  createTaskCancelTool,
  createTaskOutputTool,
  createTaskSendTool,
  createTaskTool,
  defaultResolveCallerSessionId,
  evaluateSpawnPolicy,
  isTeamMemberProcess,
  loadPiTui,
  resolveTeamRuntimeDirs,
  teamStorageBaseDir,
  toTeamCoreConfig,
  type LeadDeliveryJournal,
  type SkillLoader,
  type TaskSendTeamRouting,
  type TeamToolsService,
} from "@oh-my-opencode/senpi-task"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { CATEGORY_UNAVAILABLE_MESSAGE_TYPE } from "./category-unavailable-warning"
import { registerTaskCommands } from "./commands"
import { registerDagCommands } from "./dag-commands"
import { createDagReloadSource } from "./dag-reload-source"
import { createDagRuntime, type DagRuntime } from "./dag-runtime"
import { createDagTool } from "./dag-tool"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { TASK_USAGE_HINT_FLAG, wireEventBridge } from "./event-bridge"
import { createLeadPollerLifecycle, type LeadPollerLifecycle } from "./lead-poller-lifecycle"
import { TEAM_MEMBER_LIVENESS_MESSAGE_TYPE } from "./member-liveness"
import { TASK_COMPLETION_MESSAGE_TYPE } from "./parent-notifier"
import { renderCategoryUnavailable, renderTaskCompletion, renderTeamMemberLiveness } from "./renderers"
import { createResumptionChannelEmitter } from "./resumption-channel-emitter"
import { createTeamMailboxReconciler, createTeamService } from "./team-service"
import { createSessionTransitionBridge } from "./session-transition-bridge"
import { createSkillInvocationTracker, type SkillInvocationTracker } from "./skill-invocation-tracker"
import { wireSessionStartProcessSweep } from "./process-sweep"
import { createTaskStatusUi } from "./status-ui"
import { missingTaskCapabilities } from "./surface"
import { createTaskSkillLoader } from "./task-skill-loader"

const TASK_ENABLED_FLAG = "omo-task"

export { wireEventBridge } from "./event-bridge"

export interface TaskComponentOptions {
  // Project root the task engine anchors its state dir + omo.json load to. Defaults to the cwd the
  // host reports for THIS session; injectable so tests never write task state into the repo tree.
  readonly loadConfig?: typeof loadSenpiOmoConfig
  readonly loadSkills?: SkillLoader
  readonly resolveCwd?: () => string
}

export function createTaskComponent(options: TaskComponentOptions = {}): OmoSenpiComponent {
  const loadConfig = options.loadConfig ?? loadSenpiOmoConfig
  return {
    name: "task",
    async register(pi: SenpiExtensionAPI, ctx: ComponentContext): Promise<void> {
      if (isTeamMemberProcess()) return

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

      // The task runtime ships as its own bundle (omo-task.js) with its own copy of the lazy
      // pi-tui module state; compose's warm-up only reaches the omo.js copy. Warming here keeps
      // this bundle's dynamic import alive through minification and covers a standalone load.
      await loadPiTui()

      const cwd = options.resolveCwd?.() ?? sessionCwd(pi)
      const loaded = loadConfig({ cwd })
      const loadSkills = options.loadSkills ?? createTaskSkillLoader()

      const engine = composeTaskEngine({
        pi,
        omoConfig: loaded.config,
        cwd,
        loadSkills,
        sharedParentTools: () => ctx.getCapturedTools?.() ?? [],
        ...(ctx.idleCoordinator !== undefined && { coordinator: ctx.idleCoordinator }),
      })

      pi.registerMessageRenderer?.(TASK_COMPLETION_MESSAGE_TYPE, renderTaskCompletion)
      pi.registerMessageRenderer?.(TEAM_MEMBER_LIVENESS_MESSAGE_TYPE, renderTeamMemberLiveness)
      pi.registerMessageRenderer?.(CATEGORY_UNAVAILABLE_MESSAGE_TYPE, renderCategoryUnavailable)
      const teamTools = createTeamToolContext(pi, ctx, engine)
      const skillInvocations = createSkillInvocationTracker(pi)
      const dagRuntime = createDagRuntime({
        pi,
        engine,
        logger: ctx.logger,
        nodeSpawnPolicy: (node) =>
          evaluateSpawnPolicy(
            {
              manager: engine.manager,
              omoConfig: engine.omoConfig,
              agents: engine.agents,
              resolveSkillInvocations: (sessionId: string) => skillInvocations.stateFor(sessionId),
            },
            node.subagentType,
            node.prompt,
            node.parentSessionId,
          ),
        ...(ctx.idleCoordinator === undefined ? {} : { coordinator: ctx.idleCoordinator }),
      })
      registerTaskTools(pi, engine, teamTools.service, teamTools.leadPollers.resolveDefaultTeamRunId, skillInvocations, dagRuntime)
      registerTeamTools(pi, teamTools)
      registerRemovedTeamWaitHint(pi)
      registerTaskCommands(pi, engine.manager)
      registerDagCommands(pi, {
        list: dagRuntime.manager.list,
        snapshot: dagRuntime.manager.snapshot,
        taskRecord: dagRuntime.taskRecord,
      })

      const statusUi = createTaskStatusUi({
        manager: engine.manager,
        runtime: engine.runtime,
        terminalWidth: () => process.stdout.columns,
        logger: ctx.logger,
      })
      const resumptionChannels = createResumptionChannelEmitter({
        pi,
        manager: engine.manager,
        sessionId: () => engine.runtime.sessionId(),
        stateDir: {
          project_dir: cwd,
          ...(engine.settings.state_dir !== undefined ? { task: { state_dir: engine.settings.state_dir } } : {}),
        },
        settings: engine.settings,
      })
      engine.onStoreMutation(() => {
        statusUi.scheduleSync()
        dagRuntime.sync()
        void resumptionChannels.emitIfChanged().catch((error: unknown) => {
          ctx.logger.warn("omo-senpi task resumption-channel emission failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      })
      const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })

      wireDagLifecycle(pi, dagRuntime, () => {
        wireEventBridge(pi, ctx, engine, statusUi, transitions, {
          reconcileTeamMailbox: teamTools.reconcileTeamMailbox,
          leadPollers: teamTools.leadPollers,
          resumptionChannels,
          dagReloadSource: createDagReloadSource({
            manager: dagRuntime.manager,
            sessionId: () => engine.runtime.sessionId(),
          }),
        })
      })
    },
  }
}

// senpi loads one extension instance per session and builds its ExtensionAPI with that session's
// cwd. A multi-session host keeps every session in ONE process, so process.cwd() is the process
// launch directory: anchoring there collapses every session's task state into a single store and
// hides child artifacts from the host's per-project readers. It remains the fallback only for
// hosts that predate `cwd` on the extension API.
function sessionCwd(pi: SenpiExtensionAPI): string {
  return typeof pi.cwd === "string" && pi.cwd.length > 0 ? pi.cwd : process.cwd()
}

function registerRemovedTeamWaitHint(pi: SenpiExtensionAPI): void {
  pi.registerRemovedToolHint?.(
    "team_wait",
    "team_wait was removed - team messages arrive as steered notifications; send updates with task_send and end your turn.",
  )
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
function registerTaskTools(
  pi: SenpiExtensionAPI,
  engine: TaskEngine,
  teamService: TeamToolsService,
  resolveDefaultTeamRunId: TaskSendTeamRouting["resolveDefaultTeamRunId"],
  skillInvocations: SkillInvocationTracker,
  dagRuntime: DagRuntime,
): void {
  const resolveCallerSessionId = defaultResolveCallerSessionId
  const manager = engine.manager
  pi.registerTool({
    ...createTaskTool({
      manager,
      omoConfig: engine.omoConfig,
      agents: engine.agents,
      loadSkills: engine.loadSkills,
      resolveSkillInvocations: (sessionId: string) => skillInvocations.stateFor(sessionId),
    }),
  })
  pi.registerTool({
    ...createTaskSendTool({
      manager,
      resolveCallerSessionId,
      teamRouting: { service: teamService, from: TEAM_LEAD_SENTINEL, ...(resolveDefaultTeamRunId !== undefined ? { resolveDefaultTeamRunId } : {}) },
    }),
  })
  pi.registerTool({ ...createTaskCancelTool({ manager }) })
  pi.registerTool({ ...createTaskOutputTool({ manager, stateDir: engine.stateDir, resolveCallerSessionId }) })
  registerDagTool(pi, engine, dagRuntime)
}

function registerDagTool(pi: SenpiExtensionAPI, engine: TaskEngine, runtime: DagRuntime): void {
  const sessionId = (): string => engine.runtime.sessionId() ?? ""
  pi.registerTool({
    ...createDagTool({
      manager: runtime.manager,
      parentSessionId: sessionId,
      rootSessionId: sessionId,
      wait: runtime.wait,
      cancel: runtime.cancel,
      retry: runtime.retry,
      send: runtime.send,
      amend: runtime.amend,
    }),
  })
}

export function wireDagLifecycle(
  pi: SenpiExtensionAPI,
  runtime: Pick<DagRuntime, "attach" | "detach" | "pauseForShutdown" | "dispose">,
  wireTaskLifecycle: () => void,
): void {
  pi.on("session_shutdown", () => runtime.pauseForShutdown())
  wireTaskLifecycle()
  pi.on("session_start", () => runtime.attach())
  pi.on("session_before_switch", () => runtime.detach())
  pi.on("session_shutdown", () => runtime.dispose())
}

function createTeamToolContext(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  engine: TaskEngine,
): TeamToolContext {
  const serviceDeps = {
    manager: engine.manager,
    destruction: engine.lifecycle,
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
  const deliveryJournal = createLeadDeliveryJournal()
  const leadPollers = createLeadPollerLifecycle({
    listTeams: service.listTeams,
    runtime: engine.runtime,
    config: toTeamCoreConfig(engine.settings, teamStorageBaseDir(stateDir)),
    runtimeDir: (teamRunId) => resolveTeamRuntimeDirs(stateDir, teamRunId).runtimeDir,
    deliveryJournal,
    appendTaskEvent: engine.appendTaskEvent,
    pi,
    logger: ctx.logger,
    ...(ctx.idleCoordinator !== undefined ? { coordinator: ctx.idleCoordinator } : {}),
  })
  return { service, reconcileTeamMailbox: createTeamMailboxReconciler(serviceDeps), deliveryJournal, leadPollers }
}

type TeamToolContext = {
  readonly service: TeamToolsService
  readonly reconcileTeamMailbox: () => Promise<void>
  readonly deliveryJournal: LeadDeliveryJournal
  readonly leadPollers: LeadPollerLifecycle
}

function registerTeamTools(pi: SenpiExtensionAPI, context: TeamToolContext): void {
  for (const tool of buildLeadTeamTools({ service: context.service })) pi.registerTool({ ...tool })
}
