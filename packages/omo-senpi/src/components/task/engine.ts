import type { ToolDefinition } from "@code-yeongyu/senpi"
import { OmoTaskSettingsSchema, type OmoConfig, type OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { log } from "@oh-my-opencode/utils"
import {
  createCompletionNotifier,
  createFsSkillLoader,
  createTaskLifecycle,
  parseExtensionEntries,
  createTaskManager,
  createTeamMemberRespawnLaunchResolver,
  createTaskRecordStore,
  resolveMemberExtensionEntryPath,
  type AgentDefinition,
  type ChildPlanner,
  type CompletionNotifier,
  type PersistedTaskEvent,
  type SpawnAdmission,
  type SkillLoader,
  type TaskLifecycle,
  type TaskManager,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import {
  createCategoryConfigGenerations,
  createGenerationObservingPlanner,
  type CategoryConfigGenerations,
} from "./category-config-generation"
import { createCategoryUnavailableWarningPlanner } from "./category-unavailable-warning"
import { createTaskStoreChain } from "./engine-store-chain"
import {
  DEFAULT_RUNNER_FACTORIES,
  resolveTaskAgents,
  type RunnerBuildContext,
  type TaskRunnerFactories,
} from "./engine-runners"
import { createOwnedMemberLivenessNotifier } from "./owned-member-liveness"
import { createParentNotifier } from "./parent-notifier"
import { createTaskChildPlanner, type ResolveModelRegistry } from "./planner"
import { createTeamMemberLivenessNotifier, type TeamMemberLivenessNotifier } from "./member-liveness"
import { createManagerResidencyRegistry } from "./residency-registry"
import { TaskRuntimeContext } from "./runtime-context"
import { sharedTaskTerminalObservers, type TaskTerminalObservers } from "./terminal-observers"

export interface TaskEngine {
  readonly manager: TaskManager
  readonly lifecycle: TaskLifecycle
  readonly notifier: CompletionNotifier
  readonly runtime: TaskRuntimeContext
  readonly planner: ChildPlanner
  // Session-local category config generations observed at the planner seam. Telemetry reads the
  // current snapshot; every task record carries the generation that planned it.
  readonly categoryConfigGenerations: CategoryConfigGenerations
  readonly agents: Readonly<Record<string, AgentDefinition>>
  readonly omoConfig: OmoConfig
  readonly settings: OmoTaskSettings
  readonly stateDir: string
  readonly loadSkills: SkillLoader
  readonly memberLiveness: TeamMemberLivenessNotifier
  readonly notifyOwnedMemberLiveness: (record: TaskRecord) => Promise<void>
  readonly appendTaskEvent: (taskId: string, event: PersistedTaskEvent) => void
  // Subscribe to every store mutation (spawn/transition/replace/remove). The UI status sync attaches
  // here so the footer/widget refresh on background task activity. Returns an unsubscribe.
  onStoreMutation(listener: () => void): () => void
}

export interface ComposeTaskEngineDeps {
  readonly pi: SenpiExtensionAPI
  readonly omoConfig: OmoConfig
  readonly cwd: string
  readonly sharedParentTools: () => readonly ToolDefinition[]
  readonly coordinator?: IdleInjectionCoordinator
  readonly loadSkills?: SkillLoader
  // Per-execution-mode runner construction, injectable so tests can prove `execution_mode:"process"`
  // routes to the process (rpc) runner and not the in-process one. Defaults wire the real runners.
  readonly runnerFactories?: TaskRunnerFactories
  // Terminal status-edge ledger notified on every nonterminal -> terminal write. Defaults to the
  // process-shared ledger; tests inject an isolated one so edges cannot leak between engines.
  readonly terminalObservers?: TaskTerminalObservers
}

export type { RunnerBuildContext, TaskRunnerFactories } from "./engine-runners"

/**
 * Assemble the full senpi-task engine graph and wire the W1-V contracts:
 * - the store is completion-observing, so notifyTerminal is driven by terminal transitions (F7);
 * - the manager consults lifecycle.admitResident at spawn (F7) and shares one forget path with the
 *   residency registry (F3/F7);
 * - notifier delivery routes idle wakes through the idle coordinator.
 * Construction order breaks the store<->manager and lifecycle<->manager cycles via late binding.
 */
export function composeTaskEngine(deps: ComposeTaskEngineDeps): TaskEngine {
  const settings: OmoTaskSettings = deps.omoConfig.task ?? OmoTaskSettingsSchema.parse({})
  const runtime = new TaskRuntimeContext(deps.cwd)
  const loadSkills = deps.loadSkills ?? createFsSkillLoader()
  const stateDir = {
    project_dir: deps.cwd,
    ...(settings.state_dir !== undefined && { task: { state_dir: settings.state_dir } }),
  }
  const baseStore = createTaskRecordStore(stateDir)
  const memberLiveness = createTeamMemberLivenessNotifier({
    pi: deps.pi,
    ...(deps.coordinator === undefined ? {} : { coordinator: deps.coordinator }),
    isStreaming: () => runtime.parentState().kind === "streaming",
    wasDelivered: (record) => {
      try {
        const fresh = baseStore.load(record.task_id) ?? record
        return (fresh.notification.liveness_notified_epoch ?? -1) >= record.notification.run_epoch
      } catch (error) {
        log("omo-senpi team liveness marker read failed", {
          taskId: record.task_id,
          error: error instanceof Error ? error.message : String(error),
        })
        return false
      }
    },
    markDelivered: (record) => {
      try {
        const capturedEpoch = record.notification.run_epoch
        baseStore.mutate(record.task_id, (fresh) => {
          if (fresh.status !== record.status || fresh.notification.run_epoch !== capturedEpoch) return fresh
          if ((fresh.notification.liveness_notified_epoch ?? -1) >= capturedEpoch) return fresh
          return {
            ...fresh,
            notification: { ...fresh.notification, liveness_notified_epoch: capturedEpoch },
          }
        })
      } catch (error) {
        log("omo-senpi team liveness marker write failed", {
          taskId: record.task_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    onError: (error) => {
      log("omo-senpi team liveness delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })
  const notifyOwnedMemberLiveness = createOwnedMemberLivenessNotifier({
    stateDir,
    settings,
    runtime,
    notifier: memberLiveness,
    onError: (error, record) => {
      log("omo-senpi team liveness ownership check failed", {
        taskId: record.task_id,
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })
  const agents = resolveTaskAgents(deps.omoConfig)

  const parentNotifier = createParentNotifier(deps.pi, deps.coordinator, () => runtime.parentState().kind === "streaming")
  const notifier = createCompletionNotifier({
    notifier: parentNotifier,
    store: baseStore,
    stateDir: baseStore.stateDir,
    getParentState: () => runtime.parentState(),
    getCurrentSessionId: () => runtime.sessionId(),
  })

  const appendTaskEvent = (taskId: string, event: PersistedTaskEvent): void => {
    try {
      baseStore.appendEvent(taskId, event)
    } catch (error) {
      log("omo-senpi task event append failed", {
        taskId,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  let managerRef: TaskManager | undefined
  const getManager = (): TaskManager => {
    if (managerRef === undefined) throw new Error("task manager accessed before composition finished")
    return managerRef
  }

  const categoryConfigGenerations = createCategoryConfigGenerations()
  const storeChain = createTaskStoreChain({
    baseStore,
    runtime,
    notifier,
    terminal: {
      wasBackground: (taskId) => managerRef?.wasBackground(taskId) ?? false,
      notifyOwnedMemberLiveness: (record) => void notifyOwnedMemberLiveness(record),
      observers: deps.terminalObservers ?? sharedTaskTerminalObservers(),
    },
    generations: categoryConfigGenerations,
  })

  const registry = createManagerResidencyRegistry(getManager)
  const lifecycle = createTaskLifecycle({ store: storeChain.store, registry, config: settings })

  const factories = deps.runnerFactories ?? DEFAULT_RUNNER_FACTORIES
  const runnerContext: RunnerBuildContext = { runtime, sharedParentTools: deps.sharedParentTools, settings }
  const resolveRegistry: ResolveModelRegistry = () => runtime.modelRegistry()
  const basePlanner = createGenerationObservingPlanner({
    planner: createTaskChildPlanner(deps.omoConfig, agents, resolveRegistry),
    omoConfig: deps.omoConfig,
    resolveRegistry,
    generations: categoryConfigGenerations,
  })
  const planner = createCategoryUnavailableWarningPlanner({
    planner: basePlanner,
    pi: deps.pi,
    runtime,
    omoConfig: deps.omoConfig,
    settings,
  })
  const manager = createTaskManager({
    store: storeChain.store,
    runners: { "in-process": factories.inProcess(runnerContext), process: factories.process(runnerContext) },
    planner,
    config: settings,
    cwd: deps.cwd,
    destruction: {
      destroyResidentTask: (taskId, cause) =>
        lifecycle.destroyResidentTask(taskId, cause),
    },
    admit: (parentSessionId) => admitAdapter(lifecycle, parentSessionId),
    trustedRespawnLaunch: createTeamMemberRespawnLaunchResolver({
      stateDir,
      taskSettings: settings,
      memberExtension: {
        entryPath: resolveMemberExtensionEntryPath(),
        inheritedExtensions: parseExtensionEntries(process.argv),
      },
    }),
  })
  managerRef = manager

  return {
    manager,
    lifecycle,
    notifier,
    runtime,
    planner,
    categoryConfigGenerations,
    agents,
    omoConfig: deps.omoConfig,
    settings,
    stateDir: baseStore.stateDir,
    loadSkills,
    memberLiveness,
    notifyOwnedMemberLiveness,
    appendTaskEvent,
    onStoreMutation: storeChain.onMutation,
  }
}

async function admitAdapter(lifecycle: TaskLifecycle, parentSessionId: string): Promise<SpawnAdmission> {
  const admission = await lifecycle.admitResident(parentSessionId)
  if (admission.kind === "admitted") return { kind: "admitted" }
  if (admission.kind === "evicted") return { kind: "evicted", evicted_task_id: admission.evicted_task_id }
  return { kind: "rejected", message: admission.error.message }
}
