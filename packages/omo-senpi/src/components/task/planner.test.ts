import { describe, expect, test } from "bun:test"

import { createTaskChildPlanner, type TaskModelRegistry } from "./planner"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

function model(provider: string, id: string): FakeModel {
  return { provider, id }
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
    const resolved = expectResolved(result)
    expect(resolved.plan.model).toBe("google/gemini-3.1-pro")
    expect(resolved.plan.resolved_model).toEqual({
      source: "category",
      provider: "google",
      model_id: "gemini-3.1-pro",
      display: "google/gemini-3.1-pro",
      variant: "high",
      reasoning_effort: "xhigh",
    })
  })

  test("#given ultrabrain falls back to a variant-bearing model #when planned #then resolved_model keeps fallback variant metadata", () => {
    // given
    const planner = createTaskChildPlanner(
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

  test("#given a subagent_type with an explicit model #when planned #then resolves via the agent definition and preserves agent metadata", () => {
    // given — hephaestus is a user-defined agent in omo.json, NOT a category.
    const planner = createTaskChildPlanner(
      {
        agents: {
          hephaestus: {
            model: "openai/gpt-5.6-luna",
            execution_mode: "in-process",
            allowed_subagents: ["oracle"],
            max_depth: 2,
            prompt: "You are Hephaestus, the implementer.",
          },
        },
      },
      () => registry([model("openai", "gpt-5.6-luna")]),
    )

    // when
    const result = planner({
      prompt: "Build the thing.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "hephaestus",
    })

    // then — must resolve as the agent's model, NOT fall through to category resolution.
    const resolved = expectResolved(result)
    expect(resolved.plan.model).toBe("openai/gpt-5.6-luna")
    expect(resolved.plan.agentType).toBe("hephaestus")
    expect(resolved.plan.agentExecutionMode).toBe("in-process")
    expect(resolved.plan.allowedSubagents).toEqual(["oracle"])
    expect(resolved.plan.maxDepth).toBe(2)
    expect(resolved.plan.instructions).toBe("You are Hephaestus, the implementer.")
    expect(resolved.plan.resolved_model).toEqual({
      source: "explicit",
      provider: "openai",
      model_id: "gpt-5.6-luna",
      display: "openai/gpt-5.6-luna",
    })
  })

  test("#given an unknown subagent_type #when planned #then fails with unknown_target and lists no categories (subagent_type is not a category lookup)", () => {
    // given — no `ghost` agent in omo.json.
    const planner = createTaskChildPlanner(
      { agents: { hephaestus: { model: "openai/gpt-5.6-luna" } } },
      () => registry([model("openai", "gpt-5.6-luna")]),
    )

    // when
    const result = planner({
      prompt: "Do the thing.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "ghost",
    })

    // then — error must be unknown_target, NOT "Category ghost not found".
    if (result.kind !== "error") throw new Error(`Expected error, got ${result.kind}`)
    expect(result.error.code).toBe("unknown_target")
    expect(result.error.message).toContain('subagent_type "ghost"')
    expect(result.error.message).not.toContain('Category "ghost"')
  })

  test("#given a disabled subagent_type #when planned #then fails with category_disabled", () => {
    // given
    const planner = createTaskChildPlanner(
      {
        agents: {
          hephaestus: {
            model: "openai/gpt-5.6-luna",
            disable: true,
          },
        },
      },
      () => registry([model("openai", "gpt-5.6-luna")]),
    )

    // when
    const result = planner({
      prompt: "Do the thing.",
      parent_session_id: "parent-1",
      depth: 0,
      subagent_type: "hephaestus",
    })

    // then
    if (result.kind !== "error") throw new Error(`Expected error, got ${result.kind}`)
    expect(result.error.code).toBe("category_disabled")
  })
})
