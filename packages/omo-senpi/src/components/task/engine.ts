import type { ToolDefinition } from "@code-yeongyu/senpi"
import { OmoTaskSettingsSchema, type OmoConfig, type OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { log } from "@oh-my-opencode/utils"
import {
  InProcessRunner,
  RpcProcessRunner,
  createCompletionNotifier,
  createInProcessManagedRunner,
  createParentRegistrySessionContext,
  createRpcManagedRunner,
  createTaskLifecycle,
  parseExtensionEntries,
  createTaskManager,
  createTeamMemberRespawnLaunchResolver,
  createTaskRecordStore,
  mapOmoConfigAgents,
  resolveMemberExtensionEntryPath,
  type AgentDefinition,
  type CompletionNotifier,
  type ManagedRunner,
  type PersistedTaskEvent,
  type SpawnAdmission,
  type TaskLifecycle,
  type TaskManager,
  type TaskRecordStore,
} from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import { createCompletionObservingStore } from "./completion-bridge"
import { createParentNotifier } from "./parent-notifier"
import { createTaskChildPlanner } from "./planner"
import { createManagerResidencyRegistry } from "./residency-registry"
import { TaskRuntimeContext } from "./runtime-context"
import { createMutationNotifyingStore } from "./store-mutation-observer"

export interface TaskEngine {
  readonly manager: TaskManager
  readonly lifecycle: TaskLifecycle
  readonly notifier: CompletionNotifier
  readonly runtime: TaskRuntimeContext
  readonly agents: Readonly<Record<string, AgentDefinition>>
  readonly omoConfig: OmoConfig
  readonly settings: OmoTaskSettings
  readonly stateDir: string
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
  // Per-execution-mode runner construction, injectable so tests can prove `execution_mode:"process"`
  // routes to the process (rpc) runner and not the in-process one. Defaults wire the real runners.
  readonly runnerFactories?: TaskRunnerFactories
}

export interface RunnerBuildContext {
  readonly runtime: TaskRuntimeContext
  readonly sharedParentTools: () => readonly ToolDefinition[]
  readonly settings: OmoTaskSettings
}

export interface TaskRunnerFactories {
  readonly inProcess: (context: RunnerBuildContext) => ManagedRunner
  readonly process: (context: RunnerBuildContext) => ManagedRunner
}

const DEFAULT_RUNNER_FACTORIES: TaskRunnerFactories = {
  inProcess: buildInProcessRunner,
  process: buildProcessRunner,
}

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

  const baseStore = createTaskRecordStore({
    project_dir: deps.cwd,
    ...(settings.state_dir !== undefined && { task: { state_dir: settings.state_dir } }),
  })

  const parentNotifier = createParentNotifier(deps.pi, deps.coordinator, () => runtime.parentState().kind === "streaming")
  const notifier = createCompletionNotifier({
    notifier: parentNotifier,
    store: baseStore,
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

  const observingStore = createCompletionObservingStore(baseStore, {
    notifier,
    parentState: () => runtime.parentState(),
    wasBackground: (taskId) => managerRef?.wasBackground(taskId) ?? false,
  })

  const mutationListeners = new Set<() => void>()
  const notifyingStore: TaskRecordStore = createMutationNotifyingStore(observingStore, () => {
    for (const listener of mutationListeners) listener()
  })

  const registry = createManagerResidencyRegistry(getManager)
  const lifecycle = createTaskLifecycle({ store: notifyingStore, registry, config: settings })

  const factories = deps.runnerFactories ?? DEFAULT_RUNNER_FACTORIES
  const runnerContext: RunnerBuildContext = { runtime, sharedParentTools: deps.sharedParentTools, settings }
  const manager = createTaskManager({
    store: notifyingStore,
    runners: { "in-process": factories.inProcess(runnerContext), process: factories.process(runnerContext) },
    planner: createTaskChildPlanner(deps.omoConfig, () => runtime.modelRegistry()),
    config: settings,
    cwd: deps.cwd,
    destruction: { destroyResidentTask: (taskId) => lifecycle.destroyResidentTask(taskId, "cancel") },
    admit: (parentSessionId) => admitAdapter(lifecycle, parentSessionId),
    trustedRespawnLaunch: createTeamMemberRespawnLaunchResolver({
      stateDir: {
        project_dir: deps.cwd,
        ...(settings.state_dir === undefined ? {} : { task: { state_dir: settings.state_dir } }),
      },
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
    agents: resolveAgents(deps.omoConfig),
    omoConfig: deps.omoConfig,
    settings,
    stateDir: baseStore.stateDir,
    appendTaskEvent,
    onStoreMutation: (listener) => {
      mutationListeners.add(listener)
      return () => mutationListeners.delete(listener)
    },
  }
}

async function admitAdapter(lifecycle: TaskLifecycle, parentSessionId: string): Promise<SpawnAdmission> {
  const admission = await lifecycle.admitResident(parentSessionId)
  if (admission.kind === "admitted") return { kind: "admitted" }
  if (admission.kind === "evicted") return { kind: "evicted", evicted_task_id: admission.evicted_task_id }
  return { kind: "rejected", message: admission.error.message }
}

function buildInProcessRunner(build: RunnerBuildContext): ManagedRunner {
  const inProcess = new InProcessRunner({
    // The live capture-registry array; the runner filters the task/team family at spawn time.
    get sharedParentTools(): readonly ToolDefinition[] {
      return build.sharedParentTools()
    },
    depthPolicy: { maxDepth: Math.max(build.settings.max_depth + 1, 1) },
  })
  // Thread the PARENT session's captured model registry (and its bound auth storage) into every child,
  // resolving the plan's provider/modelId against that same registry. Without this a child spawns
  // against senpi's default agent-dir resolution and never sees a provider registered on the live
  // parent session (the -e mock provider, extension providers) - the W2-V "No API key found" gap.
  const context = createParentRegistrySessionContext(() => build.runtime.modelRegistry())
  return createInProcessManagedRunner(inProcess, context)
}

// The process (multi-process) slot: a real senpi rpc child. It runs in a SEPARATE OS process, so the
// parent's in-memory model registry object cannot be handed across the boundary; instead the child
// inherits the parent env (SENPI_CODING_AGENT_DIR and friends via buildRpcSpawn) and resolves the same
// agent dir's auth/models. Wiring this slot is what makes `execution_mode:"process"` spawn an rpc child
// instead of silently falling back to the in-process runner.
function buildProcessRunner(_build: RunnerBuildContext): ManagedRunner {
  // Forward the parent's own `-e` extensions to every detached child. A separate OS process cannot
  // inherit the parent's in-memory extension registry, so the child is spawned with `--no-extensions`
  // plus these entries reproduced explicitly (a local provider in QA, or a production `-e` extension).
  const inheritedExtensions = parseExtensionEntries(process.argv)
  return createRpcManagedRunner(new RpcProcessRunner({ inheritedExtensions }))
}

// Fold the user's omo.json `agents` into the child-agent registry so the task tool advertises them and
// `subagent_type` / team-member spawns can address them. mapOmoConfigAgents bridges the structural gap
// between the omo-config-core `OmoAgentDef` shape and senpi-task's `AgentDefinition`.
function resolveAgents(config: OmoConfig): Readonly<Record<string, AgentDefinition>> {
  return mapOmoConfigAgents(config)
}
