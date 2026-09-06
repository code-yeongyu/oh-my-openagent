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

// The live senpi registry shape: find() answers from the whole catalog while getAvailable() is
// filtered to providers this machine actually has credentials for.
function catalogRegistry(available: readonly FakeModel[], catalog: readonly FakeModel[]): FakeRegistry {
  return {
    getAvailable: () => available,
    find: (provider, modelId) =>
      catalog.find((candidate) => candidate.provider === provider && candidate.id === modelId),
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
  test("#given an agent with disallowedTools #when resolved #then the denylist rides the persona as toolDenylist", () => {
    // given
    const agents = roster({
      name: "explore",
      prompt: "Inspect the codebase",
      disallowedTools: ["bash", "write"],
    })
    const models = registry([model("openai", "gpt-5.6-luna-fast")])

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.toolDenylist).toEqual(["bash", "write"])
  })

  test("#given an agent without disallowedTools #when resolved #then no denylist is forced onto the persona", () => {
    // given
    const agents = roster({ name: "explore", prompt: "Inspect the codebase" })
    const models = registry([model("openai", "gpt-5.6-luna-fast")])

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.toolDenylist).toBeUndefined()
  })

  test("#given an agent fallback chain and matching live model #when resolved #then it returns agent metadata and persona", () => {
    // given
    const agents = roster({
      name: "explore",
      prompt: "Inspect the codebase",
      executionMode: "in-process",
    })
    const models = registry([model("openai", "gpt-5.6-luna-fast")])

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.model).toBe("openai/gpt-5.6-luna-fast")
    expect(result.resolved_model).toEqual({
      source: "agent",
      provider: "openai",
      model_id: "gpt-5.6-luna-fast",
      display: "openai/gpt-5.6-luna-fast",
      variant: "low",
      reasoning: "low",
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

  test("#given configured runtime fallback preserves requested and resolved models #when an agent resolves #then the ordered runtime chain is retained", () => {
    // given
    const agents = roster({
      name: "custom",
      model: "local/primary",
      models: ["openai/secondary", "google/tertiary"],
    })
    const models = registry([
      model("openai", "secondary"),
      model("google", "tertiary"),
    ])

    // when
    const result = expectResolved(resolveAgent("custom", agents, models))

    // then
    expect(result.model).toBe("openai/secondary")
    expect(result).toMatchObject({
      requested_model: {
        source: "agent",
        provider: "local",
        model_id: "primary",
        display: "local/primary",
      },
      fallback_models: [
        {
          source: "agent",
          provider: "google",
          model_id: "tertiary",
          display: "google/tertiary",
        },
      ],
    })
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

  test("#given def.models entries the machine has no credentials for #when resolved #then resolution falls through to the first available entry", () => {
    // given
    const agents = roster({
      name: "custom",
      model: "keyless/primary",
      models: ["keyless/secondary", "openai/available"],
    })
    const models = catalogRegistry(
      [model("openai", "available")],
      [model("keyless", "primary"), model("keyless", "secondary"), model("openai", "available")],
    )

    // when
    const result = expectResolved(resolveAgent("custom", agents, models))

    // then
    expect(result.model).toBe("openai/available")
  })

  test("#given every configured model is keyless #when resolved #then the builtin fallback chain still resolves an available model", () => {
    // given
    const agents = roster({ name: "explore", models: ["anthropic/claude-haiku-4-5"] })
    const models = catalogRegistry(
      [model("openai", "gpt-5.6-luna-fast")],
      [model("anthropic", "claude-haiku-4-5"), model("openai", "gpt-5.6-luna-fast")],
    )

    // when
    const result = expectResolved(resolveAgent("explore", agents, models))

    // then
    expect(result.model).toBe("openai/gpt-5.6-luna-fast")
  })

  test("#given a disabled agent #when resolved #then it is hidden as not_found", () => {
    // given
    const agents = roster(
      { name: "explore", disable: true },
      { name: "momus", model: "openai/momus" },
    )

    // when
    const result = resolveAgent("explore", agents, registry([]))

    // then
    expect(result).toEqual({ kind: "not_found", agent: "explore", availableAgents: ["momus"] })
  })

  test("#given an unknown agent name #when resolved #then it returns the active sorted roster", () => {
    // given
    const agents = roster(
      { name: "momus", model: "openai/momus" },
      { name: "explore", model: "openai/explore" },
    )

    // when
    const result = resolveAgent("missing", agents, registry([]))

    // then
    expect(result).toEqual({
      kind: "not_found",
      agent: "missing",
      availableAgents: ["explore", "momus"],
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

  test("#given curated tool rules #when resolved #then explicit denies become child exclusions while librarian keeps x_search", () => {
    const explore = expectResolved(resolveAgent("explore", roster({
      name: "explore",
      tools: [
        { pattern: "read", allow: true },
        { pattern: "x_search", allow: false },
      ],
    }), undefined, { modelOverride: "openai/explicit" }))
    const librarian = expectResolved(resolveAgent("librarian", roster({
      name: "librarian",
      tools: [
        { pattern: "read", allow: true },
        { pattern: "x_search", allow: true },
      ],
    }), undefined, { modelOverride: "openai/explicit" }))

    expect(explore.toolAllowlist).toEqual(["read"])
    expect(explore.toolDenylist).toEqual(["x_search"])
    expect(librarian.toolAllowlist).toEqual(["read", "x_search"])
    expect(librarian.toolDenylist).toBeUndefined()
  })

  test("#given a model override without a registry #when resolved #then it returns persona fields and filters the tool allowlist", () => {
    // given
    const agents = roster({
      name: "momus",
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
      resolveAgent("momus", agents, undefined, { modelOverride: "openai/explicit" }),
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
