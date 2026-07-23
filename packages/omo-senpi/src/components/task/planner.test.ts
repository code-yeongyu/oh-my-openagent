import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENTS, type SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { createTaskChildPlanner, type TaskModelRegistry } from "./planner"

type FakeModel = SenpiModelPort & { readonly name?: string }

function model(provider: string, id: string, name?: string): FakeModel {
  return { provider, id, ...(name === undefined ? {} : { name }) }
}

function registry(models: readonly FakeModel[]): TaskModelRegistry {
  return {
    getAvailable: () => models,
    find: (provider, modelId) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function expectResolved(plan: ReturnType<ReturnType<typeof createTaskChildPlanner>>): Extract<typeof plan, { readonly kind: "resolved" }> {
  if (plan.kind !== "resolved") {
    throw new Error(`Expected resolved plan, got ${plan.kind}`)
  }
  return plan
}

describe("createTaskChildPlanner", () => {
  test("#given a category with model metadata #when planned #then resolved_model preserves display, variant, and reasoning effort", () => {
    // given
    const planner = createTaskChildPlanner(
      {
        categories: {
          ultrabrain: {
            model: "google/gemini-3.1-pro",
            variant: "high",
            reasoningEffort: "xhigh",
          },
        },
      },
      {},
      () => registry([model("google", "gemini-3.1-pro", "Gemini 3.1 Pro")]),
    )

    // when
    const result = planner({
      prompt: "Find the hard bug.",
      parent_session_id: "parent-1",
      depth: 0,
      category: "ultrabrain",
    })

    // then
    const resolved = expectResolved(result)
    expect(resolved.plan.model).toBe("google/gemini-3.1-pro")
    expect(resolved.plan.resolved_model).toEqual({
      source: "category",
      provider: "google",
      model_id: "gemini-3.1-pro",
      display: "Gemini 3.1 Pro",
      variant: "high",
      reasoning_effort: "xhigh",
    })
  })

  test("#given ultrabrain falls back to a variant-bearing model #when planned #then resolved_model keeps fallback variant metadata", () => {
    // given
    const planner = createTaskChildPlanner(
      {},
      {},
      () => registry([model("google", "gemini-3.1-pro")]),
    )

    // when
    const result = planner({
      prompt: "Think hard.",
      parent_session_id: "parent-1",
      depth: 0,
      category: "ultrabrain",
    })

    // then
    const resolved = expectResolved(result)
    expect(resolved.plan.resolved_model).toMatchObject({
      source: "category",
      provider: "google",
      model_id: "gemini-3.1-pro",
      display: "google/gemini-3.1-pro",
      variant: "high",
    })
  })

  test("#given an explicit provider model #when planned #then explicit metadata does not invent variant or reasoning effort", () => {
    // given
    const planner = createTaskChildPlanner(
      {
        categories: {
          ultrabrain: {
            model: "google/gemini-3.1-pro",
            variant: "high",
            reasoningEffort: "xhigh",
          },
        },
      },
      {},
      () => registry([model("google", "gemini-3.1-pro")]),
    )

    // when
    const result = planner({
      prompt: "Use this model directly.",
      parent_session_id: "parent-1",
      depth: 0,
      model: "openai/gpt-5.5",
    })

    // then
    const resolved = expectResolved(result)
    expect(resolved.plan).toEqual({
      model: "openai/gpt-5.5",
      resolved_model: {
        source: "explicit",
        provider: "openai",
        model_id: "gpt-5.5",
        display: "openai/gpt-5.5",
      },
    })
  })

  test("#given subagent_type naming a builtin agent #when planned against a registry serving its chain #then the plan carries the agent persona and an agent-sourced model", () => {
    // given
    const planner = createTaskChildPlanner(
      {},
      BUILTIN_AGENTS,
      () => registry([model("openai", "gpt-5.4-mini-fast")]),
    )

    // when
    const result = planner({
      prompt: "Find the auth flow.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "explore",
    })

    // then
    const resolved = expectResolved(result)
    expect(resolved.plan.model).toBe("openai/gpt-5.4-mini-fast")
    expect(resolved.plan.resolved_model).toEqual({
      source: "agent",
      provider: "openai",
      model_id: "gpt-5.4-mini-fast",
      display: "openai/gpt-5.4-mini-fast",
    })
    expect(resolved.plan.agentType).toBe("explore")
    expect(resolved.plan.instructions).toContain("codebase search specialist")
    expect(resolved.plan.toolAllowlist).toEqual([
      "read",
      "find",
      "grep",
      "ls",
      "bash",
      "lsp_diagnostics",
      "lsp_goto_definition",
      "lsp_find_references",
      "lsp_symbols",
    ])
    expect(resolved.plan.agentExecutionMode).toBe("in-process")
  })

  test("#given an explicit model with subagent_type and no registry #when planned #then the agent persona is kept and the model stays explicit", () => {
    // given
    const planner = createTaskChildPlanner({}, BUILTIN_AGENTS, () => undefined)

    // when
    const result = planner({
      prompt: "Review this design.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "oracle",
      model: "openai/gpt-5.5",
    })

    // then
    const resolved = expectResolved(result)
    expect(resolved.plan.model).toBe("openai/gpt-5.5")
    expect(resolved.plan.resolved_model).toEqual({
      source: "explicit",
      provider: "openai",
      model_id: "gpt-5.5",
      display: "openai/gpt-5.5",
    })
    expect(resolved.plan.agentType).toBe("oracle")
    expect(resolved.plan.instructions).toBeDefined()
    expect(resolved.plan.toolAllowlist).toHaveLength(9)
    expect(resolved.plan.agentExecutionMode).toBe("in-process")
  })

  test("#given subagent_type naming a builtin agent with no registry #when planned #then it fails closed with the registry-unavailable error", () => {
    // given
    const planner = createTaskChildPlanner({}, BUILTIN_AGENTS, () => undefined)

    // when
    const result = planner({
      prompt: "Find the auth flow.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "explore",
    })

    // then
    expect(result).toEqual({
      kind: "error",
      error: {
        code: "model_unavailable",
        message: "No senpi model registry is available yet to resolve a task model.",
      },
    })
  })

  test("#given subagent_type naming a category rather than an agent #when planned #then category resolution still applies", () => {
    // given
    const planner = createTaskChildPlanner(
      {},
      BUILTIN_AGENTS,
      () => registry([model("google", "gemini-3.1-pro")]),
    )

    // when
    const result = planner({
      prompt: "Think hard.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "ultrabrain",
    })

    // then
    const resolved = expectResolved(result)
    expect(resolved.plan.resolved_model).toMatchObject({ source: "category", provider: "google" })
    expect(resolved.plan.category).toBe("ultrabrain")
  })

  test("#given a disabled agent sharing a category name #when planned without an explicit model #then category fallback remains available", () => {
    // given
    const agents = { ...BUILTIN_AGENTS, explore: { name: "explore", disable: true } }
    const planner = createTaskChildPlanner(
      { categories: { explore: { model: "google/gemini-3.1-pro" } } },
      agents,
      () => registry([model("google", "gemini-3.1-pro")]),
    )

    // when
    const result = planner({
      prompt: "Find the auth flow.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "explore",
    })

    // then
    const resolved = expectResolved(result)
    expect(resolved.plan.agentType).toBeUndefined()
    expect(resolved.plan.category).toBe("explore")
    expect(resolved.plan.resolved_model?.source).toBe("category")
  })

  test("#given a disabled agent and explicit model #when planned via subagent_type #then the model cannot bypass disablement", () => {
    // given
    const agents = { ...BUILTIN_AGENTS, oracle: { name: "oracle", disable: true } }
    const planner = createTaskChildPlanner({}, agents, () => undefined)

    // when
    const result = planner({
      prompt: "Review this design.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "oracle",
      model: "openai/gpt-5.5",
    })

    // then
    if (result.kind !== "error") throw new Error(`Expected error resolution, got ${result.kind}`)
    expect(result.error.code).toBe("unknown_target")
    expect(result.error.availableAgents).toEqual(["explore", "librarian", "metis", "momus"])
  })

  test("#given an unknown subagent_type #when planned #then the unknown-target error lists available agents and categories", () => {
    // given
    const planner = createTaskChildPlanner(
      {},
      BUILTIN_AGENTS,
      () => registry([model("google", "gemini-3.1-pro")]),
    )

    // when
    const result = planner({
      prompt: "Do something.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "nonexistent",
    })

    // then
    if (result.kind !== "error") throw new Error(`Expected error resolution, got ${result.kind}`)
    expect(result.error.code).toBe("unknown_target")
    expect(result.error.availableAgents).toEqual(["explore", "librarian", "metis", "momus", "oracle"])
    expect(result.error.availableCategories).toContain("ultrabrain")
  })

  test("#given subagent_type naming a builtin agent whose chain no registry model satisfies #when planned #then it reports model_unavailable with the agent list", () => {
    // given
    const planner = createTaskChildPlanner(
      {},
      BUILTIN_AGENTS,
      () => registry([model("acme", "unrelated-1")]),
    )

    // when
    const result = planner({
      prompt: "Find the auth flow.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "explore",
    })

    // then
    if (result.kind !== "error") throw new Error(`Expected error resolution, got ${result.kind}`)
    expect(result.error.code).toBe("model_unavailable")
    expect(result.error.message).toContain('No available model for agent "explore"')
    expect(result.error.availableAgents).toEqual(["explore", "librarian", "metis", "momus", "oracle"])
  })
})

describe("createTaskChildPlanner plan variant", () => {
  test("#given a category with an explicit reasoning effort and a variant #when planned #then the applied variant is the reasoning effort", () => {
    // given
    const planner = createTaskChildPlanner(
      {
        categories: {
          ultrabrain: {
            model: "google/gemini-3.1-pro",
            variant: "high",
            reasoningEffort: "xhigh",
          },
        },
      },
      {},
      () => registry([model("google", "gemini-3.1-pro")]),
    )

    // when
    const result = planner({
      prompt: "Find the hard bug.",
      parent_session_id: "parent-1",
      depth: 0,
      category: "ultrabrain",
    })

    // then
    expect(expectResolved(result).plan.variant).toBe("xhigh")
  })

  test("#given a category resolving a variant-bearing fallback without reasoning effort #when planned #then the applied variant is the resolved variant", () => {
    // given
    const planner = createTaskChildPlanner(
      {},
      {},
      () => registry([model("google", "gemini-3.1-pro")]),
    )

    // when
    const result = planner({
      prompt: "Think hard.",
      parent_session_id: "parent-1",
      depth: 0,
      category: "ultrabrain",
    })

    // then
    expect(expectResolved(result).plan.variant).toBe("high")
  })

  test("#given an explicit provider model #when planned #then no variant is applied", () => {
    // given
    const planner = createTaskChildPlanner(
      {},
      {},
      () => registry([model("openai", "gpt-5.5")]),
    )

    // when
    const result = planner({
      prompt: "Use this model directly.",
      parent_session_id: "parent-1",
      depth: 0,
      model: "openai/gpt-5.5",
    })

    // then
    expect(expectResolved(result).plan.variant).toBeUndefined()
  })

  test("#given momus resolves a variant-bearing chain entry #when planned #then the applied variant matches the resolved model", () => {
    // given
    const planner = createTaskChildPlanner(
      {},
      BUILTIN_AGENTS,
      () => registry([model("openai", "gpt-5.6-sol")]),
    )

    // when
    const result = planner({
      prompt: "Review the plan.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "momus",
    })

    // then
    const resolved = expectResolved(result)
    expect(resolved.plan.model).toBe("openai/gpt-5.6-sol")
    expect(resolved.plan.variant).toBe("xhigh")
  })
})
