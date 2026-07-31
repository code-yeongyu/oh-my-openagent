import { describe, expect, test } from "bun:test"

import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { createTaskChildPlanner, type TaskModelRegistry } from "./planner"

type FakeModel = SenpiModelPort & { readonly name?: string }

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

describe("createTaskChildPlanner runtime fallback", () => {
  test("#given a category with configured runtime fallbacks #when planned #then requested and ordered fallback metadata are preserved", () => {
    // given
    const planner = createTaskChildPlanner(
      {
        categories: {
          quick: {
            model: "kimi-coding/kimi-for-coding-highspeed-unlocked",
            reasoningEffort: "minimal",
            fallback_models: [
              { model: "quotio-openai/gpt-5.4-mini-fast", reasoningEffort: "minimal" },
              { model: "example-gateway/z-ai/glm-5.2-ultrafast-unlocked", reasoningEffort: "none" },
            ],
          },
        },
      },
      {},
      () => registry([
        model("kimi-coding", "kimi-for-coding-highspeed-unlocked"),
        model("quotio-openai", "gpt-5.4-mini-fast"),
        model("example-gateway", "z-ai/glm-5.2-ultrafast-unlocked"),
      ]),
    )

    // when
    const result = planner({
      prompt: "Finish quickly.",
      parent_session_id: "parent-1",
      depth: 0,
      category: "quick",
    })

    // then
    if (result.kind !== "resolved") throw new Error(`Expected resolved plan, got ${result.kind}`)
    expect(result.plan).toMatchObject({
      requested_model: {
        source: "category",
        provider: "kimi-coding",
        model_id: "kimi-for-coding-highspeed-unlocked",
      },
      fallback_models: [
        {
          source: "category",
          provider: "quotio-openai",
          model_id: "gpt-5.4-mini-fast",
          reasoning_effort: "minimal",
        },
        {
          source: "category",
          provider: "example-gateway",
          model_id: "z-ai/glm-5.2-ultrafast-unlocked",
          reasoning_effort: "none",
        },
      ],
    })
  })

  test("#given a builtin category whose chain head is unavailable #when planned #then the remaining chain rungs become fallback models", () => {
    // given
    const planner = createTaskChildPlanner(
      {},
      {},
      () => registry([
        model("quotio-openai", "gpt-5.4-mini-fast"),
        model("openai", "gpt-5.4-mini"),
      ]),
    )

    // when
    const result = planner({
      prompt: "Finish quickly.",
      parent_session_id: "parent-1",
      depth: 0,
      category: "quick",
    })

    // then
    if (result.kind !== "resolved") throw new Error(`Expected resolved plan, got ${result.kind}`)
    expect(result.plan).toMatchObject({
      model: "quotio-openai/gpt-5.4-mini-fast",
      requested_model: {
        source: "category",
        provider: "kimi-coding",
        model_id: "kimi-for-coding-highspeed",
      },
      resolved_model: {
        source: "category",
        provider: "quotio-openai",
        model_id: "gpt-5.4-mini-fast",
        variant: "minimal",
      },
      fallback_models: [
        {
          source: "category",
          provider: "openai",
          model_id: "gpt-5.4-mini",
          variant: "minimal",
        },
      ],
    })
  })

  test("#given a user fallback that lands on a chain rung #when planned #then the user entry keeps priority and only later chain rungs append", () => {
    // given
    const planner = createTaskChildPlanner(
      {
        categories: {
          quick: {
            fallback_models: [{ model: "quotio-openai/gpt-5.4-mini-fast", variant: "low" }],
          },
        },
      },
      {},
      () => registry([
        model("quotio-openai", "gpt-5.4-mini-fast"),
        model("openai", "gpt-5.4-mini"),
      ]),
    )

    // when
    const result = planner({
      prompt: "Finish quickly.",
      parent_session_id: "parent-1",
      depth: 0,
      category: "quick",
    })

    // then
    if (result.kind !== "resolved") throw new Error(`Expected resolved plan, got ${result.kind}`)
    expect(result.plan.model).toBe("quotio-openai/gpt-5.4-mini-fast")
    expect(result.plan.resolved_model).toMatchObject({
      provider: "quotio-openai",
      model_id: "gpt-5.4-mini-fast",
      variant: "low",
    })
    expect(result.plan.fallback_models).toEqual([
      {
        source: "category",
        provider: "openai",
        model_id: "gpt-5.4-mini",
        display: "openai/gpt-5.4-mini",
        variant: "minimal",
      },
    ])
  })
})
