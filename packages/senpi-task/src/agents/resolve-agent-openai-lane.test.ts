import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENTS } from "./builtin"
import { resolveAgent } from "./resolve-agent"

// Curated GPT rungs list chatgpt-subscription first and openai second: when a machine holds both, the
// metered `openai` lane is never picked over the subscription (#8300); when it holds only `openai`, the
// rung is still reachable at selection AND in the runtime fallback list (#8734).

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
  test("#given the kimi head plus an openai-only luna lane #when explore resolves #then the runtime fallback list tries openai/gpt-6-luna-fast before claude-haiku-4-5", () => {
    // given
    const models = registry([
      model("kimi-coding", "kimi-for-coding-highspeed"),
      model("openai", "gpt-6-luna-fast"),
      model("anthropic", "claude-haiku-4-5"),
    ])

    // when
    const result = expectResolved(resolveAgent("explore", BUILTIN_AGENTS, models))

    // then
    expect(result.model).toBe("kimi-coding/kimi-for-coding-highspeed")
    expect(result.fallback_models?.map((entry) => entry.display)).toEqual([
      "openai/gpt-6-luna-fast",
      "anthropic/claude-haiku-4-5",
    ])
  })

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
