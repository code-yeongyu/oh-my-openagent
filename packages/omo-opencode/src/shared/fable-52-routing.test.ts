import { describe, expect, test } from "bun:test"
import { resolveModelForDelegateTask } from "@oh-my-opencode/delegate-core"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS, resolveModelPipeline } from "@oh-my-opencode/model-core"
import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"

// Every builtin agent and category that leads its Claude rungs with the current Fable resolves to Fable 5.2
// at the rung's effort on every resolver, and drops to Fable 5.1 at the same effort when only 5.1 is served.
type Lane = {
  name: string
  chain: { providers: string[]; model: string; variant?: string }[]
  categoryDefaultModel?: string
}

const lanes: Lane[] = [
  ...Object.entries(AGENT_MODEL_REQUIREMENTS).map(([name, requirement]) => ({
    name: `agent ${name}`,
    chain: requirement.fallbackChain ?? [],
  })),
  ...Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(([name, requirement]) => ({
    name: `category ${name}`,
    chain: requirement.fallbackChain ?? [],
    categoryDefaultModel: DEFAULT_CATEGORIES[name]?.model,
  })),
].filter((lane) => lane.chain.some((rung) => rung.model === "claude-fable-5-2"))

function resolveEverywhere(lane: Lane, availableModels: Set<string>) {
  const pipeline = resolveModelPipeline({
    intent: { categoryDefaultModel: lane.categoryDefaultModel },
    constraints: { availableModels, connectedProviders: ["anthropic"] },
    policy: { fallbackChain: lane.chain },
  })
  const delegated = resolveModelForDelegateTask(
    { availableModels, categoryDefaultModel: lane.categoryDefaultModel, fallbackChain: lane.chain },
    {
      connectedProviders: ["anthropic"],
      hasProviderModelsCache: availableModels.size > 0,
      hasConnectedProvidersCache: true,
    },
  )
  return {
    pipeline: pipeline?.model,
    delegated: delegated && "model" in delegated ? delegated.model : undefined,
  }
}

describe("Fable 5.2 routing across builtin lanes", () => {
  test("the lanes that lead with the current Fable are the ones the release moves", () => {
    expect(lanes.map((lane) => lane.name).sort()).toEqual([
      "agent metis",
      "agent prometheus",
      "category artistry",
      "category visual-engineering",
    ])
  })

  for (const lane of lanes) {
    test(`${lane.name} keeps Fable 5.1 as the next rung at the same effort and providers`, () => {
      // given
      const head = lane.chain.findIndex((rung) => rung.model === "claude-fable-5-2")
      // when
      const [fable52, fable51] = lane.chain.slice(head, head + 2)
      // then
      expect(fable51).toEqual({ ...fable52, model: "claude-fable-5-1" })
      expect(["xhigh", "max"]).toContain(fable52?.variant)
    })

    test(`${lane.name} resolves to Fable 5.2 when the provider lists it`, () => {
      // given
      const available = new Set(["anthropic/claude-fable-5-1", "anthropic/claude-fable-5-2"])
      // when / then
      expect(resolveEverywhere(lane, available)).toEqual({
        pipeline: "anthropic/claude-fable-5-2",
        delegated: "anthropic/claude-fable-5-2",
      })
    })

    test(`${lane.name} falls back to Fable 5.1 when the provider has not listed 5.2 yet`, () => {
      // given
      const available = new Set(["anthropic/claude-fable-5-1"])
      // when / then
      expect(resolveEverywhere(lane, available)).toEqual({
        pipeline: "anthropic/claude-fable-5-1",
        delegated: "anthropic/claude-fable-5-1",
      })
    })
  }
})
