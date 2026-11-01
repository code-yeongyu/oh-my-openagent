import { describe, expect, test } from "bun:test"
import { OmoConfigSchema } from "@oh-my-opencode/omo-config-core"
import { mapOmoConfigAgents, resolveCategory } from "@oh-my-opencode/senpi-task"
import { createTaskChildPlanner } from "./planner"
import { normalizeAgentDefinition, RawAgentDefinitionSchema } from "../../../../senpi-task/src/agents/schema"

const models = ["a", "b", "c"].map((id) => ({ provider: "test-provider", id }))
const registry = {
  getAvailable: () => models,
  find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
}

describe("task model distribution", () => {
  test("markdown agent parsing retains the policy and rejects unknown policies", () => {
    const raw = RawAgentDefinitionSchema.parse({
      models: ["test-provider/a", "test-provider/b"],
      models_distribution: "round_robin",
    })
    expect(normalizeAgentDefinition("fixture", raw, "fixture").models_distribution).toBe("round_robin")
    expect(RawAgentDefinitionSchema.safeParse({ models_distribution: "random" }).success).toBe(false)
  })

  test("unavailable starts skip forward and duplicate entries are never retried", () => {
    const config = OmoConfigSchema.parse({
      categories: {
        distributed: {
          models: ["test-provider/missing", "test-provider/a", "test-provider/a:low", "test-provider/b"],
          models_distribution: "round_robin",
        },
      },
    })
    const planner = createTaskChildPlanner(config, {}, () => registry)
    const plans = Array.from({ length: 3 }, () => {
      const result = planner({ prompt: "fixture", parent_session_id: "parent", depth: 0, category: "distributed" })
      if (result.kind !== "resolved") throw new Error(JSON.stringify(result))
      return result.plan
    })
    expect(plans.map((plan) => plan.model)).toEqual([
      "test-provider/a", "test-provider/a", "test-provider/b",
    ])
    expect(plans[2].fallback_models?.map((entry) => entry.display)).toEqual(["test-provider/a"])
  })

  for (const target of ["category", "agent"] as const) {
    for (const distribution of [undefined, "sequential", "round_robin"] as const) {
      test(`${target} ${distribution ?? "default"} starts and fallbacks`, () => {
        const definition = {
          models: ["test-provider/a", { model: "test-provider/b", reasoning: "high" }, "test-provider/c"],
          ...(distribution === undefined ? {} : { models_distribution: distribution }),
        }
        const config = OmoConfigSchema.parse({
          categories: { distributed: definition, independent: definition },
          agents: { distributed: definition, independent: definition },
        })
        const planner = createTaskChildPlanner(config, mapOmoConfigAgents(config), () => registry)
        const spawn = (name: string) => {
          const result = planner({
            prompt: "fixture", parent_session_id: "parent", depth: 0,
            ...(target === "category" ? { category: name } : { subagent_type: name }),
          })
          if (result.kind !== "resolved") throw new Error(JSON.stringify(result))
          return result.plan
        }
        const first = spawn("distributed")
        // Introspection must not consume a spawn's turn.
        resolveCategory("distributed", config, registry)
        const second = spawn("distributed")
        expect(spawn("independent").model).toBe("test-provider/a")
        const third = spawn("distributed")
        const fourth = spawn("distributed")
        const rotating = distribution === "round_robin"
        expect([first, second, third, fourth].map((plan) => plan.model)).toEqual(
          rotating ? ["test-provider/a", "test-provider/b", "test-provider/c", "test-provider/a"]
            : Array(4).fill("test-provider/a"),
        )
        expect(second.fallback_models?.map((entry) => entry.display)).toEqual(
          rotating ? ["test-provider/c", "test-provider/a"] : ["test-provider/b", "test-provider/c"],
        )
        if (rotating) expect(second.resolved_model?.reasoning_effort).toBe("high")
      })
    }
  }
})
