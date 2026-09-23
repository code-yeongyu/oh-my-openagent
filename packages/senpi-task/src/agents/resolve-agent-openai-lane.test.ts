import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENTS } from "./builtin"
import { resolveAgent } from "./resolve-agent"

// Curated agent chains list only senpi's chatgpt-subscription subscription lane (#8300): when a machine
// also holds an OpenAI API key, the metered `openai` lane must never be picked over it.

type FakeModel = {
  readonly provider: string
  readonly id: string
}

function model(provider: string, id: string): FakeModel {
  return { provider, id }
}

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function expectResolved(result: ReturnType<typeof resolveAgent>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") throw new Error(`Expected resolved agent, got ${result.kind}`)
  return result
}

const CURATED_GPT_CASES = [
  { agent: "explore", modelId: "gpt-6-luna-fast" },
  { agent: "librarian", modelId: "gpt-6-luna-fast" },
  { agent: "plan-reviewer", modelId: "gpt-6-astra" },
] as const

describe("resolveAgent openai lane policy", () => {
  for (const { agent, modelId } of CURATED_GPT_CASES) {
    test(`#given openai and chatgpt-subscription both serve ${modelId} #when ${agent} resolves #then the chatgpt-subscription lane wins`, () => {
      // given
      const models = registry([model("openai", modelId), model("chatgpt-subscription", modelId)])

      // when
      const result = expectResolved(resolveAgent(agent, BUILTIN_AGENTS, models))

      // then
      expect(result.model).toBe(`chatgpt-subscription/${modelId}`)
      expect(result.resolved_model?.provider).toBe("chatgpt-subscription")
    })

    test(`#given only the openai API lane serves ${modelId} #when ${agent} resolves #then the API lane is still reachable`, () => {
      // given
      const models = registry([model("openai", modelId)])

      // when
      const result = expectResolved(resolveAgent(agent, BUILTIN_AGENTS, models))

      // then
      expect(result.model).toBe(`openai/${modelId}`)
    })
  }
})
