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
              { model: "openai-codex/gpt-5.6-luna-fast", reasoningEffort: "minimal" },
              { model: "example-gateway/z-ai/glm-5.2-ultrafast-unlocked", reasoningEffort: "none" },
            ],
          },
        },
      },
      {},
      () => registry([
        model("kimi-coding", "kimi-for-coding-highspeed-unlocked"),
        model("openai-codex", "gpt-5.6-luna-fast"),
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
          provider: "openai-codex",
          model_id: "gpt-5.6-luna-fast",
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
        model("openai-codex", "gpt-5.6-luna-fast"),
        model("opencode-go", "minimax-m3"),
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
      model: "openai-codex/gpt-5.6-luna-fast",
      requested_model: {
        source: "category",
        provider: "kimi-coding",
        model_id: "kimi-for-coding-highspeed",
      },
      resolved_model: {
        source: "category",
        provider: "openai-codex",
        model_id: "gpt-5.6-luna-fast",
        variant: "low",
      },
      fallback_models: [
        {
          source: "category",
          provider: "opencode-go",
          model_id: "minimax-m3",
          variant: "max",
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
            fallback_models: [{ model: "openai-codex/gpt-5.6-luna-fast", variant: "low" }],
          },
        },
      },
      {},
      () => registry([
        model("openai-codex", "gpt-5.6-luna-fast"),
        model("opencode-go", "minimax-m3"),
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
    expect(result.plan.model).toBe("openai-codex/gpt-5.6-luna-fast")
    expect(result.plan.resolved_model).toMatchObject({
      provider: "openai-codex",
      model_id: "gpt-5.6-luna-fast",
      variant: "low",
    })
    expect(result.plan.fallback_models).toEqual([
      {
        source: "category",
        provider: "opencode-go",
        model_id: "minimax-m3",
        display: "opencode-go/minimax-m3",
        variant: "max",
      },
    ])
  })
})
