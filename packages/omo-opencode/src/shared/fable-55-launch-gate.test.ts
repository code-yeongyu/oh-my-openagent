import { describe, expect, test } from "bun:test"
import { resolveModelForDelegateTask } from "@oh-my-opencode/delegate-core"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  FABLE_55_RELEASED,
  isLaunchGatedModel,
  resolveModelPipeline,
} from "@oh-my-opencode/model-core"
import { getFirstFallbackModel } from "../agents/builtin-agents/model-resolution"
import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"

// The provisional Fable 5.5 id must never reach live routing before release, whichever resolver runs
// and whatever the caches hold. This sweep walks every builtin agent and category through each path.
const caches: { name: string; availableModels: Set<string>; connectedProviders: string[] | null }[] = [
  { name: "cold cache, anthropic connected", availableModels: new Set<string>(), connectedProviders: ["anthropic"] },
  { name: "null connected-providers cache", availableModels: new Set<string>(), connectedProviders: null },
  {
    name: "warm cache listing 5.1 and 5.5",
    availableModels: new Set(["anthropic/claude-fable-5-1", "anthropic/claude-fable-5-5"]),
    connectedProviders: ["anthropic"],
  },
]

const requirements: { name: string; requirement: (typeof AGENT_MODEL_REQUIREMENTS)[string]; categoryDefaultModel?: string }[] = [
  ...Object.entries(AGENT_MODEL_REQUIREMENTS).map(([name, requirement]) => ({ name: `agent ${name}`, requirement })),
  ...Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(([name, requirement]) => ({
    name: `category ${name}`,
    requirement,
    categoryDefaultModel: DEFAULT_CATEGORIES[name]?.model,
  })),
]

describe("launch-gated Fable 5.5 never resolves before release", () => {
  test("the gate is closed in this build", () => {
    expect(FABLE_55_RELEASED).toBe(false)
  })

  for (const cache of caches) {
    test(`no builtin default or chain resolves to a launch-gated id (${cache.name})`, () => {
      const leaks: string[] = []
      for (const { name, requirement, categoryDefaultModel } of requirements) {
        const chain = requirement.fallbackChain
        for (const rung of chain ?? []) {
          if (isLaunchGatedModel(rung.model)) leaks.push(`${name}: chain rung ${rung.model}`)
        }
        if (categoryDefaultModel && isLaunchGatedModel(categoryDefaultModel)) {
          leaks.push(`${name}: category default ${categoryDefaultModel}`)
        }
        const pipeline = resolveModelPipeline({
          intent: { categoryDefaultModel },
          constraints: { availableModels: cache.availableModels, connectedProviders: cache.connectedProviders ?? undefined },
          policy: { fallbackChain: chain },
        })
        if (pipeline?.model && isLaunchGatedModel(pipeline.model)) leaks.push(`${name}: model-core ${pipeline.model}`)
        const delegated = resolveModelForDelegateTask(
          { availableModels: cache.availableModels, categoryDefaultModel, fallbackChain: chain },
          {
            connectedProviders: cache.connectedProviders,
            hasProviderModelsCache: cache.availableModels.size > 0,
            hasConnectedProvidersCache: cache.connectedProviders !== null,
          },
        )
        const delegatedModel = delegated && "model" in delegated ? delegated.model : undefined
        if (delegatedModel && isLaunchGatedModel(delegatedModel)) {
          leaks.push(`${name}: delegate-core ${delegatedModel}`)
        }
        const first = getFirstFallbackModel(requirement)
        if (first && isLaunchGatedModel(first.model)) leaks.push(`${name}: getFirstFallbackModel ${first.model}`)
      }
      expect(leaks).toEqual([])
    })
  }
})
