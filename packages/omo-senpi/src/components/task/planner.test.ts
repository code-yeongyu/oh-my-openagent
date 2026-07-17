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
})
