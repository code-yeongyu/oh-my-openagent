import { describe, expect, test } from "bun:test"

import { mapOmoConfigAgents } from "./omo-config-agents"
import { resolveAgent } from "./resolve-agent"
import type { AgentDefinition } from "./types"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function roster(...definitions: readonly AgentDefinition[]): Readonly<Record<string, AgentDefinition>> {
  return Object.fromEntries(definitions.map((definition) => [definition.name, definition]))
}

function expectResolved(result: ReturnType<typeof resolveAgent>) {
  if (result.kind !== "resolved") throw new Error(`Expected resolved agent, got ${result.kind}`)
  return result
}

describe("agent model entries carrying effort", () => {
  test("#given an omo agent whose models carry effort #when bridged #then the entry objects survive onto the definition", () => {
    // given
    const config = {
      agents: {
        explore: {
          models: [{ model: "openai-codex/gpt-5.6-luna-fast", reasoningEffort: "minimal" as const }],
        },
      },
    }

    // when
    const agents = mapOmoConfigAgents(config)

    // then
    const entry = agents.explore?.models?.[0]
    if (typeof entry !== "object") throw new Error("Expected the bridged entry to stay an object")
    expect(entry.model).toBe("openai-codex/gpt-5.6-luna-fast")
    expect(entry.reasoningEffort).toBe("minimal")
  })

  test("#given an omo agent whose model entries carry canonical reasoning #when bridged #then the entry reasoning is preserved on the candidate", () => {
    // given a canonicalized agent entry (the schema rewrites reasoningEffort to reasoning)
    const config = {
      agents: {
        explore: {
          models: [{ model: "provider/model", reasoning: "high" }],
        },
      },
    }

    // when
    const agents = mapOmoConfigAgents(config)

    // then canonical reasoning flows into the internal effort slot
    const entry = agents.explore?.models?.[0]
    if (typeof entry !== "object") throw new Error("Expected the bridged entry to stay an object")
    expect(entry.reasoning).toBe("high")
  })

  test("#given an omo agent with plain string models #when bridged #then the legacy strings are preserved verbatim", () => {
    // given
    const config = { agents: { explore: { models: ["openai/a", "openai/b"] } } }

    // when
    const agents = mapOmoConfigAgents(config)

    // then
    expect(agents.explore?.models).toEqual(["openai/a", "openai/b"])
  })

  test("#given a canonicalized agent entry #when resolved through resolveAgent #then its canonical reasoning reaches the resolved model record", () => {
    // given a canonical entry (the schema rewrites reasoningEffort to reasoning)
    const agents = roster({
      name: "explore",
      models: [{ model: "openai-codex/gpt-5.6-luna-fast", reasoning: "high" }],
    })
    const models = registry([{ provider: "openai-codex", id: "gpt-5.6-luna-fast" }])

    // when resolved end to end through withDefaults
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then the canonical level survives into the resolved record
    expect(result.resolved_model?.reasoning_effort).toBe("high")
  })

  test("#given a resolved agent model entry carrying effort #when resolved #then the effort reaches the resolved model record", () => {
    // given
    const agents = roster({
      name: "explore",
      models: [{ model: "openai-codex/gpt-5.6-luna-fast", reasoningEffort: "minimal" }],
    })
    const models = registry([{ provider: "openai-codex", id: "gpt-5.6-luna-fast" }])

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.model).toBe("openai-codex/gpt-5.6-luna-fast")
    expect(result.resolved_model?.reasoning_effort).toBe("minimal")
  })

  test("#given a model entry carrying an explicit variant #when resolved #then the variant reaches the resolved model record", () => {
    // given
    const agents = roster({
      name: "explore",
      models: [{ model: "anthropic/claude-haiku-4-5", variant: "low" }],
    })
    const models = registry([{ provider: "anthropic", id: "claude-haiku-4-5" }])

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.resolved_model?.variant).toBe("low")
  })

  test("#given an agent whose top level effort applies to its primary model #when resolved #then the effort reaches the record", () => {
    // given
    const agents = roster({
      name: "librarian",
      model: "openai-codex/gpt-5.6-luna-fast",
      reasoningEffort: "minimal",
      models: ["openai-codex/gpt-5.6-luna-fast"],
    })
    const models = registry([{ provider: "openai-codex", id: "gpt-5.6-luna-fast" }])

    // when
    const result = expectResolved(resolveAgent("librarian", agents, models))

    // then
    expect(result.resolved_model?.reasoning_effort).toBe("minimal")
  })

  test("#given a fallback entry with its own effort #when the primary is unavailable #then the fallback effort wins over the agent default", () => {
    // given
    const agents = roster({
      name: "explore",
      model: "kimi-coding/kimi-for-coding-highspeed",
      reasoningEffort: "high",
      models: [{ model: "openai-codex/gpt-5.6-luna-fast", reasoningEffort: "minimal" }],
    })
    const models = registry([{ provider: "openai-codex", id: "gpt-5.6-luna-fast" }])

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.model).toBe("openai-codex/gpt-5.6-luna-fast")
    expect(result.resolved_model?.reasoning_effort).toBe("minimal")
  })

  test("#given a model entry with no effort of its own #when resolved #then no effort is invented", () => {
    // given
    const agents = roster({ name: "explore", models: [{ model: "openai/plain" }] })
    const models = registry([{ provider: "openai", id: "plain" }])

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.resolved_model?.reasoning_effort).toBeUndefined()
    expect(result.resolved_model?.variant).toBeUndefined()
  })
})
