import { describe, expect, test } from "bun:test"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import { mapOmoConfigAgents } from "@oh-my-opencode/senpi-task"

import { createTaskChildPlanner } from "./planner"

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

function resolvedPlan(resolution: ReturnType<ReturnType<typeof createTaskChildPlanner>>) {
  if (resolution.kind !== "resolved") throw new Error(`Expected a resolved plan, got ${resolution.kind}`)
  return resolution.plan
}

describe("agent plans carrying configured effort", () => {
  test("#given an agent model entry with effort #when planned #then the effort becomes the child variant", () => {
    // given
    const config = {
      agents: {
        explore: {
          models: [{ model: "openai-codex/gpt-5.6-luna-fast", reasoningEffort: "minimal" as const }],
        },
      },
    } satisfies OmoConfig
    const agents = mapOmoConfigAgents(config)
    const models = registry([{ provider: "openai-codex", id: "gpt-5.6-luna-fast" }])
    const planner = createTaskChildPlanner(config, agents, () => models)

    // when
    const plan = resolvedPlan(planner({ subagent_type: "explore", prompt: "go", parent_session_id: "p", depth: 1 }))

    // then
    expect(plan.model).toBe("openai-codex/gpt-5.6-luna-fast")
    expect(plan.variant).toBe("minimal")
    expect(plan.resolved_model?.reasoning_effort).toBe("minimal")
  })

  test("#given an agent carrying both variant and effort #when planned #then effort wins exactly as it does for a category", () => {
    // given
    const config = {
      agents: {
        librarian: {
          models: [{ model: "openai/tuned", variant: "high", reasoningEffort: "minimal" as const }],
        },
      },
    } satisfies OmoConfig
    const agents = mapOmoConfigAgents(config)
    const models = registry([{ provider: "openai", id: "tuned" }])
    const planner = createTaskChildPlanner(config, agents, () => models)

    // when
    const plan = resolvedPlan(planner({ subagent_type: "librarian", prompt: "go", parent_session_id: "p", depth: 1 }))

    // then
    expect(plan.variant).toBe("minimal")
  })

  test("#given an agent level variant and a per entry effort #when planned #then the per entry effort still reaches the child", () => {
    // given
    const config = {
      agents: {
        explore: {
          variant: "high",
          models: [{ model: "openai-codex/gpt-5.6-luna-fast", reasoningEffort: "minimal" as const }],
        },
      },
    } satisfies OmoConfig
    const agents = mapOmoConfigAgents(config)
    const models = registry([{ provider: "openai-codex", id: "gpt-5.6-luna-fast" }])
    const planner = createTaskChildPlanner(config, agents, () => models)

    // when
    const plan = resolvedPlan(planner({ subagent_type: "explore", prompt: "go", parent_session_id: "p", depth: 1 }))

    // then
    expect(plan.variant).toBe("minimal")
  })

  test("#given an agent with plain string models #when planned #then no variant is invented", () => {
    // given
    const config = { agents: { explore: { models: ["openai/plain"] } } } satisfies OmoConfig
    const agents = mapOmoConfigAgents(config)
    const models = registry([{ provider: "openai", id: "plain" }])
    const planner = createTaskChildPlanner(config, agents, () => models)

    // when
    const plan = resolvedPlan(planner({ subagent_type: "explore", prompt: "go", parent_session_id: "p", depth: 1 }))

    // then
    expect(plan.variant).toBeUndefined()
  })
})
