import type { ToolDefinition } from "@code-yeongyu/senpi"
import { OmoTaskSettingsSchema, type OmoConfig, type OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { log } from "@oh-my-opencode/utils"
import {
  createCompletionNotifier,
  createFsSkillLoader,
  createIsolationRuntime,
  createTaskManager,
  createTeamMemberRespawnLaunchResolver,
  createTaskRecordStore,
  readSessionAncestry,
  readSettingsDefaultRoute,
  resolveMemberExtensionEntryPath,
  TASK_CHILD_EXTENSION_EVENT,
  type AgentDefinition,
  type ChildPlanner,
  type CompletionNotifier,
  type PersistedTaskEvent,
  type ResolveAncestry,
  type SessionAncestry,
  type SkillInvocationState,
  type SkillLoader,
  type TaskLifecycle,
  type TaskManager,
  type TaskRecord,
  type TaskToolDeps,
} from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { EngineHostRuntime } from "./host-execution-mode"
import {
  createCategoryConfigGenerations,
  createGenerationObservingPlanner,
  type CategoryConfigGenerations,
} from "./category-config-generation"
import { createCategoryUnavailableWarningPlanner } from "./category-unavailable-warning"
import { createTaskStoreChain } from "./engine-store-chain"
import { createEngineKernelTools } from "./engine-kernel-tools"
import { composeEngineHostWiring } from "./engine-host-wiring"
import { createEngineLiveness } from "./engine-liveness"
import {
  DEFAULT_RUNNER_FACTORIES,
  buildRespawnRunner,
  resolveTaskAgents,
  type TaskRunnerFactories,
} from "./engine-runners"
import { createParentNotifier } from "./parent-notifier"
import { createTaskChildPlanner, type ResolveModelRegistry } from "./planner"
import type { TeamMemberLivenessNotifier } from "./member-liveness"
import { createManagerResidencyRegistry } from "./residency-registry"
import { TaskRuntimeContext } from "./runtime-context"
import { sharedTaskTerminalObservers, type TaskTerminalObservers } from "./terminal-observers"
import { admitAdapter } from "./engine-admission"

export { admitAdapter } from "./engine-admission"

export interface TaskEngine {
  readonly manager: TaskManager
  // The session's package-aware inherited extension list, shared with every child-launch producer.
  readonly resolveInheritedExtensions: () => Promise<readonly string[]>
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
  // Where THIS session sits in the task tree (undefined = top-level). Every spawn entry point - task,
  // workpool, workflow, team - counts its children's depth from here so max_depth holds (#9036).
  readonly ancestry: SessionAncestry | undefined
  readonly resolveAncestry: ResolveAncestry
  // This session's task-host wiring: the ONE answer to `task.default_execution_mode: "auto"`, the
  // per-call shard routing, and the deduped reasons its host could not take its children.
  readonly host: EngineHostRuntime
  readonly stateDir: string
  readonly loadSkills: SkillLoader
  readonly memberLiveness: TeamMemberLivenessNotifier
  readonly notifyOwnedMemberLiveness: (record: TaskRecord) => Promise<void>
  /**
   * Everything the `task` tool resolves a spawn against, including the child tool names a parent
   * kernel-tool grant is decided from (item 6) - assembled here because this engine owns the
   * manager, the agent map and the shared parent tool surface they are derived from.
   */
  readonly taskToolDeps: (resolveSkillInvocations: (sessionId: string) => SkillInvocationState) => TaskToolDeps
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
  // This session's shared-daemon wiring. Defaults to the real one (ensure + capability check); a
  // suite injects it whole so no test ever ensures a daemon and its notices are the engine's.
  readonly host?: EngineHostRuntime
  // The process env the per-child launch channel is read from. Defaults to this process's env.
  readonly env?: NodeJS.ProcessEnv
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
  const ancestry = readSessionAncestry(deps.pi, deps.env ?? process.env)
  const resolveAncestry: ResolveAncestry = (sessionId) =>
    ancestry === undefined ? undefined : { depth: ancestry.depth, rootSessionId: ancestry.rootSessionId ?? sessionId }
  const runtime = new TaskRuntimeContext(deps.cwd)
  const loadSkills = deps.loadSkills ?? createFsSkillLoader()
  const stateDir = {
    project_dir: deps.cwd,
    ...(settings.state_dir !== undefined && { task: { state_dir: settings.state_dir } }),
  }
  const baseStore = createTaskRecordStore(stateDir)
  const { memberLiveness, notifyOwnedMemberLiveness } = createEngineLiveness({
    pi: deps.pi,
    ...(deps.coordinator === undefined ? {} : { coordinator: deps.coordinator }),
    runtime,
    store: baseStore,
    stateDir,
    settings,
  })
  const agents = resolveTaskAgents(deps.omoConfig)

  // The coordinator's async receipt closes the loop on batched delivery: a completion the coordinator
  // accepted but never delivered (failed flush, or a batch window dropped when /reload retires it)
  // rolls notified_epoch back and stamps the failure, so the post-reload session_start reconcile
  // redelivers it instead of skipping the record forever.
  const parentNotifier = createParentNotifier(
    deps.pi,
    deps.coordinator,
    () => runtime.parentState().kind === "streaming",
    (taskIds, error) => notifier.recordDeliveryFailure({ taskIds, error }),
    () => runtime.parentModel(),
  )
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
  const kernelTools = createEngineKernelTools(deps.sharedParentTools)
  const kernelToolBindings = kernelTools.bindings
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

  const registry = createManagerResidencyRegistry(getManager, () => runtime.sessionId())
  // The engine owns ONE isolation runtime: the manager clones the checkout for an isolated child
  // with it, and the lifecycle salvages and sweeps a crashed host's clones through the same object.
  // Without it every `isolated: true` spawn is refused as `isolation_unavailable`.
  const isolation = createIsolationRuntime()
  const { host, lifecycle, resolveInheritedExtensions, runnerContext } = composeEngineHostWiring({
    pi: deps.pi,
    omoConfig: deps.omoConfig,
    settings,
    runtime,
    sharedParentTools: deps.sharedParentTools,
    ...(deps.host === undefined ? {} : { host: deps.host }),
    baseStore,
    generations: categoryConfigGenerations,
    lifecycle: { store: storeChain.store, registry, kernelToolBindings, isolation, onStoreMutation: storeChain.onMutation },
  })

  const factories = deps.runnerFactories ?? DEFAULT_RUNNER_FACTORIES
  const resolveRegistry: ResolveModelRegistry = () => runtime.modelRegistry()
  // The default route a pin-less child would ride, named in model_unavailable refusals (#9722) so
  // the caller sees the substitution the failure prevented. Read lazily per plan: a mid-session
  // default change reaches the next spawn's message.
  const resolveDefaultRoute = () =>
    readSettingsDefaultRoute({ cwd: runtime.cwd(), agentDir: host.agentDir ?? resolveAgentHome({ env: deps.env ?? process.env }) })
  const basePlanner = createGenerationObservingPlanner({
    planner: createTaskChildPlanner(deps.omoConfig, agents, resolveRegistry, () => runtime.parentServiceTier(), resolveDefaultRoute),
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
    // An in-process child's task tool shares this manager; its owner connection is still ours.
    onChildExtensionEvent: (event, owner) => deps.pi.events?.emit(TASK_CHILD_EXTENSION_EVENT, {
      parent_session_id: runtime.sessionId(), root_session_id: owner.root_session_id, event,
    }),
    store: storeChain.store,
    isolation,
    runners: { "in-process": factories.inProcess(runnerContext), process: factories.process(runnerContext) },
    kernelToolBindings,
    resolveChildToolNames: kernelTools.childToolNames,
    planner,
    config: settings,
    resolveInheritedExtensions,
    rpcRespawnRunner: buildRespawnRunner(runnerContext),
    executionModeGate: host.executionModeGate,
    cwd: deps.cwd,
    destruction: {
      destroyResidentTask: (taskId, cause) =>
        lifecycle.destroyResidentTask(taskId, cause),
      parkTerminalResident: (taskId) => lifecycle.parkTerminalResident(taskId),
    },
    admit: (parentSessionId) => admitAdapter(lifecycle, parentSessionId),
    trustedRespawnLaunch: createTeamMemberRespawnLaunchResolver({
      stateDir,
      taskSettings: settings,
      memberExtension: {
        entryPath: resolveMemberExtensionEntryPath(),
        inheritedExtensions: resolveInheritedExtensions,
      },
    }),
  })
  managerRef = manager

  return {
    manager,
    resolveInheritedExtensions,
    lifecycle,
    notifier,
    runtime,
    planner,
    categoryConfigGenerations,
    agents,
    omoConfig: deps.omoConfig,
    settings,
    ancestry,
    resolveAncestry,
    host,
    stateDir: baseStore.stateDir,
    loadSkills,
    memberLiveness,
    notifyOwnedMemberLiveness,
    taskToolDeps: (resolveSkillInvocations) => ({
      manager,
      omoConfig: deps.omoConfig,
      agents,
      resolveAncestry,
      loadSkills,
      resolveSkillInvocations,
      resolveChildToolNames: kernelTools.childToolNames,
      executionModeGate: host.executionModeGate,
    }),
    appendTaskEvent,
    onStoreMutation: storeChain.onMutation,
  }
}
