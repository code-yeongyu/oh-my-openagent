import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

import type {
  MemoryLaunchRouteInput,
  MemoryLaunchSurface,
  MemoryRouteCandidate,
} from "./fork-cost"
import { MEMORY_WORKLOAD_PROFILES } from "./fork-cost"
import { readModelContextWindow, readModelPricing } from "./registry-fallback"
import type { ReflectionSessionModel } from "./resolve-model"

type Registry = SenpiModelRegistryPort<SenpiModelPort> | undefined

/** Serialized transcript bytes the reflection child must read, at the usual ~4 bytes/token. */
export function reflectionPayloadTokens(
  snapshots: readonly {
    readonly conversationId: string
    readonly snapshot: { readonly entries: readonly unknown[] }
  }[],
): number {
  const bytes = snapshots.reduce(
    (total, captured) => total + Buffer.byteLength(JSON.stringify(captured.snapshot.entries), "utf8"),
    0,
  )
  return Math.ceil(bytes / 4)
}

/**
 * Assemble the pure route inputs from the runner's registry lookups. Both routes run the designated
 * model (#12081): the fork candidate is that same model forked onto the parent's context, never the
 * parent session's model. The session model is read only to decide whether the parent's provider
 * cache can be replayed, which requires the fork to run the exact model the parent ran. Both
 * candidates carry their context window because fork inherits the parent's whole context
 * (`--fork <parentSessionFile>`), so a window that cannot hold parent + payload + working turns must
 * lose before cost is compared.
 */
export function memoryLaunchRouteInput(input: {
  readonly surface: MemoryLaunchSurface
  readonly quickModel: string
  readonly quickThinking?: string
  readonly registry: Registry
  readonly sessionModel?: ReflectionSessionModel
  readonly parentContextTokens?: number
  readonly payloadTokens: number
  readonly cacheHit: boolean
}): MemoryLaunchRouteInput {
  const quickEntry = findRegistryEntry(input.registry, input.quickModel)
  const quickCost = readModelPricing(quickEntry)
  const quickWindow = readModelContextWindow(quickEntry)
  const quick: MemoryRouteCandidate = {
    model: input.quickModel,
    ...(input.quickThinking === undefined ? {} : { thinking: input.quickThinking }),
    ...(quickCost === undefined ? {} : { cost: quickCost }),
    ...(quickWindow === undefined ? {} : { contextWindow: quickWindow }),
  }
  const sessionModel = input.sessionModel
  const parentRanDesignated = sessionModel !== undefined
    && `${sessionModel.provider}/${sessionModel.id}` === input.quickModel
  return {
    surface: input.surface,
    quick,
    ...(sessionModel === undefined || quickCost === undefined ? {} : { fork: quick }),
    ...(input.parentContextTokens === undefined ? {} : { parentContextTokens: input.parentContextTokens }),
    payloadTokens: input.payloadTokens,
    turns: MEMORY_WORKLOAD_PROFILES[input.surface].turns,
    cacheHit: input.cacheHit && parentRanDesignated,
  }
}

function findRegistryEntry(registry: Registry, model: string): unknown {
  if (registry === undefined) return undefined
  const separator = model.indexOf("/")
  if (separator <= 0) return undefined
  return registry.find(model.slice(0, separator), model.slice(separator + 1))
}

