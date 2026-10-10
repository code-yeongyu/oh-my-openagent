import type { ToolDefinition } from "@code-yeongyu/senpi"
import type { OmoConfig, OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle, type LifecycleDeps, type TaskLifecycle, type TaskRecordStore } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { CategoryConfigGenerations } from "./category-config-generation"
import { createInheritedExtensionsResolver, type RunnerBuildContext } from "./engine-runners"
import { createEngineHostRuntime, type EngineHostRuntime } from "./host-execution-mode"
import type { TaskRuntimeContext } from "./runtime-context"

export interface EngineHostWiringInput {
  readonly pi: SenpiExtensionAPI
  readonly omoConfig: OmoConfig
  readonly settings: OmoTaskSettings
  readonly runtime: TaskRuntimeContext
  readonly sharedParentTools: () => readonly ToolDefinition[]
  readonly host?: EngineHostRuntime
  // The raw store: config-generation warnings append to it, and its state dir is the store the
  // shard routing registers in the agent-dir store index.
  readonly baseStore: TaskRecordStore
  readonly generations: CategoryConfigGenerations
  readonly lifecycle: Pick<LifecycleDeps, "store" | "registry" | "kernelToolBindings" | "isolation" | "onStoreMutation">
}

export interface EngineHostWiring {
  readonly host: EngineHostRuntime
  readonly lifecycle: TaskLifecycle
  readonly resolveInheritedExtensions: () => Promise<readonly string[]>
  readonly runnerContext: RunnerBuildContext
}

/**
 * The half of the engine that reaches a task host: the session's host runtime, the lifecycle that
 * revives recorded host sessions through that runtime's endpoint port, and the runner context whose
 * shard routing the `process` runners open children with. The lifecycle and the runners share ONE
 * host runtime, so a revival ensure and a spawn ensure hit the same cache and the same notice list.
 */
export function composeEngineHostWiring(input: EngineHostWiringInput): EngineHostWiring {
  const { pi, omoConfig, settings, runtime, baseStore, generations } = input
  const host = input.host ?? createEngineHostRuntime(settings, runtime, pi, { storeDir: baseStore.stateDir })
  const lifecycle = createTaskLifecycle({ ...input.lifecycle, config: settings,
    hostEndpoint: host.hostEndpoint,
    revivePolicy: {
      currentGeneration: () => {
        const modelRegistry = runtime.modelRegistry()
        return modelRegistry === undefined ? generations.current()?.generation
          : generations.observe({ omoConfig, registry: modelRegistry }).generation
      },
      warn: (warning) => {
        baseStore.appendEvent(warning.task_id, { type: "config_generation_mismatch", payload: warning })
        pi.sendMessage({ customType: "senpi-task.config-generation-mismatch", content: "Resuming the recorded task configuration.", display: true, details: warning }, {})
      },
    },
  })

  const hostRouting = { ...host.routing, storeDir: baseStore.stateDir }
  const baseRunnerContext: RunnerBuildContext = { runtime, sharedParentTools: input.sharedParentTools, settings, kernelToolBindings: input.lifecycle.kernelToolBindings, agentDir: host.agentDir, onHostWarning: host.notices.add, hostRouting }
  // One resolver for the whole session, so an ordinary spawn, a revival, a team member and a
  // workpool worker all inherit the SAME package-aware extension list (#8492).
  const resolveInheritedExtensions = createInheritedExtensionsResolver(baseRunnerContext)
  return { host, lifecycle, resolveInheritedExtensions, runnerContext: { ...baseRunnerContext, resolveInheritedExtensions } }
}
