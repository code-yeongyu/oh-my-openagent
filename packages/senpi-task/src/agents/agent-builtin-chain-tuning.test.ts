import { describe, expect, test } from "bun:test"

import { resolveAgent } from "./resolve-agent"
import type { AgentDefinition } from "./types"

function registry(models: readonly { readonly provider: string; readonly id: string }[]) {
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

describe("agent tuning on the builtin fallback chain", () => {
  test("#given an agent with only top level effort #when the builtin chain resolves #then the effort still reaches the record", () => {
    // given
    const agents = roster({ name: "explore", reasoningEffort: "minimal" })
    const models = registry([{ provider: "openai", id: "gpt-5.4-mini-fast" }])

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.resolved_model?.reasoning_effort).toBe("minimal")
  })

  // momus resolves through a chain rung that carries its own variant ("high"), so these two cases
  // can actually distinguish configured-wins from rung-wins rather than both passing vacuously.
  test("#given an agent with a top level variant #when a variant bearing chain rung resolves #then the configured variant wins", () => {
    // given
    const agents = roster({ name: "momus", variant: "low" })
    const models = registry([{ provider: "openai", id: "gpt-5.6-terra" }])

    // when
    const result = expectResolved(resolveAgent("momus", agents, models))

    // then
    expect(result.resolved_model?.variant).toBe("low")
  })

  test("#given an agent with no configured tuning #when a variant bearing chain rung resolves #then the rung variant survives and no effort is invented", () => {
    // given
    const agents = roster({ name: "momus" })
    const models = registry([{ provider: "openai", id: "gpt-5.6-terra" }])

    // when
    const result = expectResolved(resolveAgent("momus", agents, models))

    // then
    expect(result.resolved_model?.variant).toBe("high")
    expect(result.resolved_model?.reasoning_effort).toBeUndefined()
  })
})
