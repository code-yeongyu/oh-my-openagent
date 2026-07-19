import { describe, expect, test } from "bun:test"

import { resolveAgent } from "./resolve-agent"
import type { AgentDefinition } from "./types"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

type FakeRegistry = {
  readonly getAvailable: () => readonly FakeModel[]
  readonly find: (provider: string, modelId: string) => FakeModel | undefined
}

function model(provider: string, id: string): FakeModel {
  return { provider, id }
}

function registry(models: readonly FakeModel[]): FakeRegistry {
  return {
    getAvailable: () => models,
    find: (provider, modelId) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function roster(...definitions: readonly AgentDefinition[]): Readonly<Record<string, AgentDefinition>> {
  return Object.fromEntries(definitions.map((definition) => [definition.name, definition]))
}

function expectResolved(result: ReturnType<typeof resolveAgent>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") throw new Error(`Expected resolved agent, got ${result.kind}`)
  return result
}

describe("resolveAgent", () => {
  test("#given an agent fallback chain and matching live model #when resolved #then it returns agent metadata and persona", () => {
    // given
    const agents = roster({
      name: "explore",
      prompt: "Inspect the codebase",
      executionMode: "in-process",
    })
    const models = registry([model("openai", "gpt-5.4-mini-fast")])

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.model).toBe("openai/gpt-5.4-mini-fast")
    expect(result.resolved_model).toEqual({
      source: "agent",
      provider: "openai",
      model_id: "gpt-5.4-mini-fast",
      display: "openai/gpt-5.4-mini-fast",
    })
    expect(result.agentType).toBe("explore")
    expect(result.instructions).toBe("Inspect the codebase")
    expect(result.agentExecutionMode).toBe("in-process")
  })

  test("#given def.model and def.models are both available #when resolved #then def.model wins", () => {
    // given
    const agents = roster({
      name: "custom",
      model: "local/primary",
      models: ["openai/secondary"],
    })
    const models = registry([model("local", "primary"), model("openai", "secondary")])

    // when
    const result = expectResolved(resolveAgent("custom", agents, models))

    // then
    expect(result.model).toBe("local/primary")
  })

  test("#given an unavailable primary and ordered def.models #when resolved #then the first available model wins", () => {
    // given
    const agents = roster({
      name: "custom",
      model: "local/missing",
      models: ["openai/first", "openai/second"],
    })
    const models = registry([model("openai", "first"), model("openai", "second")])

    // when
    const result = expectResolved(resolveAgent("custom", agents, models))

    // then
    expect(result.model).toBe("openai/first")
  })

  test("#given a disabled agent #when resolved #then it is hidden as not_found", () => {
    // given
    const agents = roster(
      { name: "explore", disable: true },
      { name: "oracle", model: "openai/oracle" },
    )

    // when
    const result = resolveAgent("explore", agents, registry([]))

    // then
    expect(result).toEqual({ kind: "not_found", agent: "explore", availableAgents: ["oracle"] })
  })

  test("#given an unknown agent name #when resolved #then it returns the active sorted roster", () => {
    // given
    const agents = roster(
      { name: "oracle", model: "openai/oracle" },
      { name: "explore", model: "openai/explore" },
    )

    // when
    const result = resolveAgent("missing", agents, registry([]))

    // then
    expect(result).toEqual({
      kind: "not_found",
      agent: "missing",
      availableAgents: ["explore", "oracle"],
    })
  })

  test("#given no registry model matches #when resolved #then it returns model_unavailable without throwing", () => {
    // given
    const agents = roster({ name: "custom", model: "local/missing" })

    // when
    const result = resolveAgent("custom", agents, registry([]))

    // then
    expect(result).toEqual({
      kind: "model_unavailable",
      agent: "custom",
      attemptedModel: "local/missing",
      availableAgents: ["custom"],
    })
  })

  test("#given a model override without a registry #when resolved #then it returns persona fields and filters the tool allowlist", () => {
    // given
    const agents = roster({
      name: "oracle",
      prompt: "Advise only",
      executionMode: "in-process",
      allowedSubagents: ["explore"],
      maxDepth: 2,
      tools: [
        { pattern: "read", allow: true },
        { pattern: "grep", allow: false },
        { pattern: "lsp_*", allow: true },
        { pattern: "bash git status", allow: true },
        { pattern: "lsp_diagnostics", allow: true },
      ],
    })

    // when
    const result = expectResolved(
      resolveAgent("oracle", agents, undefined, { modelOverride: "openai/explicit" }),
    )

    // then
    expect(result.model).toBe("openai/explicit")
    expect(result.resolved_model).toBeUndefined()
    expect(result.instructions).toBe("Advise only")
    expect(result.toolAllowlist).toEqual(["read", "lsp_diagnostics"])
    expect(result.agentExecutionMode).toBe("in-process")
    expect(result.allowedSubagents).toEqual(["explore"])
    expect(result.maxDepth).toBe(2)
  })
})
