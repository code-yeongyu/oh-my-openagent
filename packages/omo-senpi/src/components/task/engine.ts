import type { ToolDefinition } from "@code-yeongyu/senpi"
import { OmoTaskSettingsSchema, type OmoConfig, type OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  InProcessRunner,
  createCompletionNotifier,
  createInProcessManagedRunner,
  createTaskLifecycle,
  createTaskManager,
  createTaskRecordStore,
  type AgentDefinition,
  type CompletionNotifier,
  type ManagedRunner,
  type SpawnAdmission,
  type TaskLifecycle,
  type TaskManager,
} from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import { createCompletionObservingStore } from "./completion-bridge"
import { createParentNotifier } from "./parent-notifier"
import { createTaskChildPlanner } from "./planner"
import { createManagerResidencyRegistry } from "./residency-registry"
import { TaskRuntimeContext } from "./runtime-context"

export interface TaskEngine {
  readonly manager: TaskManager
  readonly lifecycle: TaskLifecycle
  readonly notifier: CompletionNotifier
  readonly runtime: TaskRuntimeContext
  readonly agents: Readonly<Record<string, AgentDefinition>>
  readonly omoConfig: OmoConfig
  readonly settings: OmoTaskSettings
  readonly stateDir: string
}

export interface ComposeTaskEngineDeps {
  readonly pi: SenpiExtensionAPI
  readonly omoConfig: OmoConfig
  readonly cwd: string
  readonly sharedParentTools: () => readonly ToolDefinition[]
  readonly coordinator?: IdleInjectionCoordinator
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

  const parentNotifier = createParentNotifier(deps.pi, deps.coordinator)
  const notifier = createCompletionNotifier({
    notifier: parentNotifier,
    store: baseStore,
    config: settings.notification,
  })

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

  const registry = createManagerResidencyRegistry(getManager)
  const lifecycle = createTaskLifecycle({ store: observingStore, registry, config: settings })

  const runner = buildRunner(runtime, deps.sharedParentTools, settings)
  const manager = createTaskManager({
    store: observingStore,
    runners: { "in-process": runner, process: runner },
    planner: createTaskChildPlanner(deps.omoConfig, () => runtime.modelRegistry()),
    config: settings,
    cwd: deps.cwd,
    destruction: { destroyResidentTask: (taskId) => lifecycle.destroyResidentTask(taskId, "cancel") },
    admit: (parentSessionId) => admitAdapter(lifecycle, parentSessionId),
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
  }
}

async function admitAdapter(lifecycle: TaskLifecycle, parentSessionId: string): Promise<SpawnAdmission> {
  const admission = await lifecycle.admitResident(parentSessionId)
  if (admission.kind === "admitted") return { kind: "admitted" }
  if (admission.kind === "evicted") return { kind: "evicted", evicted_task_id: admission.evicted_task_id }
  return { kind: "rejected", message: admission.error.message }
}

function buildRunner(
  _runtime: TaskRuntimeContext,
  sharedParentTools: () => readonly ToolDefinition[],
  settings: OmoTaskSettings,
): ManagedRunner {
  const inProcess = new InProcessRunner({
    // The live capture-registry array; the runner filters the task/team family at spawn time. v1: the
    // in-process child inherits the parent's default agent dir / auth resolution, so no per-child
    // modelRegistry override is threaded here yet (deferred to the live-QA follow-up).
    get sharedParentTools(): readonly ToolDefinition[] {
      return sharedParentTools()
    },
    depthPolicy: { maxDepth: Math.max(settings.max_depth + 1, 1) },
  })
  return createInProcessManagedRunner(inProcess)
}

// v1: the task tool's description enriches its category list from omoConfig directly. Custom agent
// definitions from omo.json are not yet folded into the child-agent registry (deferred follow-up), so
// this stays an empty record rather than casting the structurally-different omo.json agent shape.
function resolveAgents(_config: OmoConfig): Readonly<Record<string, AgentDefinition>> {
  return {}
}
