import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENTS, type SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { createTaskChildPlanner, type TaskModelRegistry } from "./planner"

const MODELS: readonly SenpiModelPort[] = [
  { provider: "anthropic", id: "claude-fable-5-1" },
  { provider: "anthropic", id: "claude-opus-5-5" },
]

const REGISTRY: TaskModelRegistry = {
  getAvailable: () => MODELS,
  find: (provider, modelId) => MODELS.find((model) => model.provider === provider && model.id === modelId),
}

describe("task model pins with exclude_models", () => {
  test("#given a task call pinning an excluded model #when planned #then the spawn fails typed and names the entry", () => {
    // given
    const planner = createTaskChildPlanner({ exclude_models: ["claude-fable-*"] }, BUILTIN_AGENTS, () => REGISTRY)

    // when
    const result = planner({ prompt: "draw", parent_session_id: "parent-1", depth: 0, model: "anthropic/claude-fable-5-1" })

    // then
    expect(result.kind).toBe("error")
    expect(result.kind === "error" ? result.error.code : undefined).toBe("model_unavailable")
    expect(result.kind === "error" ? result.error.message : "").toContain("claude-fable-*")
  })

  test("#given a fast parent and an excluded -fast sibling #when planned #then the child keeps the planned model", () => {
    // given
    const models = [
      { provider: "chatgpt-subscription", id: "gpt-5.6-luna" },
      { provider: "chatgpt-subscription", id: "gpt-5.6-luna-fast", upstreamModelId: "gpt-5.6-luna", serviceTier: "priority" as const },
    ]
    const fastRegistry: TaskModelRegistry = {
      getAvailable: () => models,
      find: (provider, modelId) => models.find((model) => model.provider === provider && model.id === modelId),
    }
    const planner = createTaskChildPlanner({ exclude_models: ["*-fast"] }, BUILTIN_AGENTS, () => fastRegistry, () => "priority")

    // when
    const result = planner({ prompt: "go", parent_session_id: "parent-1", depth: 0, model: "chatgpt-subscription/gpt-5.6-luna" })

    // then
    expect(result.kind === "resolved" ? result.plan.model : result.kind).toBe("chatgpt-subscription/gpt-5.6-luna")
  })

  test("#given a pin outside the list #when planned #then it still resolves", () => {
    // given
    const planner = createTaskChildPlanner({ exclude_models: ["claude-fable-*"] }, BUILTIN_AGENTS, () => REGISTRY)

    // when
    const result = planner({ prompt: "draw", parent_session_id: "parent-1", depth: 0, model: "anthropic/claude-opus-5-5" })

    // then
    expect(result.kind === "resolved" ? result.plan.model : result.kind).toBe("anthropic/claude-opus-5-5")
  })
})
