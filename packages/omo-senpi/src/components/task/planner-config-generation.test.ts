import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import {
  createCategoryConfigGenerations,
  createGenerationObservingPlanner,
} from "./category-config-generation"
import { createTaskChildPlanner, type TaskModelRegistry } from "./planner"

type FakeModel = SenpiModelPort

function registry(models: readonly FakeModel[]): TaskModelRegistry {
  return {
    getAvailable: () => models,
    find: (provider, modelId) => models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

const CONFIG: OmoConfig = {
  categories: {
    quick: { model: "kimi-coding/kimi-for-coding-highspeed-unlocked", reasoningEffort: "minimal" },
    deep: { model: "anthropic/claude-opus-5", reasoningEffort: "high" },
  },
}

function harness(models: () => readonly FakeModel[]) {
  const generations = createCategoryConfigGenerations()
  const resolveRegistry = (): TaskModelRegistry => registry(models())
  const planner = createGenerationObservingPlanner({
    planner: createTaskChildPlanner(CONFIG, {}, resolveRegistry),
    omoConfig: CONFIG,
    resolveRegistry,
    generations,
  })
  return { generations, planner }
}

function plan(planner: ReturnType<typeof harness>["planner"], category: string) {
  return planner({ prompt: "work", parent_session_id: "parent-1", depth: 0, category })
}

describe("category config generations at the planner seam", () => {
  test("#given an unchanged effective category map #when two tasks are planned #then the same generation is reused", () => {
    // given
    const models: FakeModel[] = [
      { provider: "kimi-coding", id: "kimi-for-coding-highspeed-unlocked" },
      { provider: "anthropic", id: "claude-opus-5" },
    ]
    const { generations, planner } = harness(() => models)

    // when
    const first = plan(planner, "quick")
    const firstGeneration = generations.current()?.generation
    const second = plan(planner, "deep")

    // then
    expect(first.kind).toBe("resolved")
    expect(second.kind).toBe("resolved")
    expect(firstGeneration).toBe(0)
    expect(generations.current()?.generation).toBe(0)
  })

  test("#given a registry whose model availability changes between plans #when two tasks are planned #then the second carries a new generation", () => {
    // given
    const models: FakeModel[] = [
      { provider: "kimi-coding", id: "kimi-for-coding-highspeed-unlocked" },
      { provider: "anthropic", id: "claude-opus-5" },
    ]
    const { generations, planner } = harness(() => models)
    plan(planner, "quick")
    const before = generations.current()?.generation

    // when
    models.splice(0, 1)
    plan(planner, "deep")

    // then
    expect(before).toBe(0)
    expect(generations.current()?.generation).toBe(1)
  })

  test("#given a category map #when canonicalized #then unresolvable categories encode as unavailable and disabled ones as disabled", () => {
    // given
    const config: OmoConfig = {
      categories: {
        quick: { model: "kimi-coding/kimi-for-coding-highspeed-unlocked" },
        deep: { disable: true },
      },
    }
    const generations = createCategoryConfigGenerations()
    const resolveRegistry = (): TaskModelRegistry => registry([])

    // when
    const snapshot = generations.observe({ omoConfig: config, registry: resolveRegistry() })

    // then
    expect(snapshot.categories["quick"]).toBe("unavailable")
    expect(snapshot.categories["deep"]).toBe("disabled")
  })

  test("#given a resolved category #when canonicalized #then the value encodes provider, model and reasoning", () => {
    // given
    const generations = createCategoryConfigGenerations()
    const models: readonly FakeModel[] = [{ provider: "anthropic", id: "claude-opus-5" }]

    // when
    const snapshot = generations.observe({
      omoConfig: { categories: { deep: { model: "anthropic/claude-opus-5", reasoningEffort: "high" } } },
      registry: registry(models),
    })

    // then
    expect(snapshot.categories["deep"]).toBe("anthropic/claude-opus-5/high")
  })

  test("#given an injected masking function #when a category resolves to an unknown provider #then the canonical value is masked", () => {
    // given
    const generations = createCategoryConfigGenerations(() => ({ provider: "custom", model_id: "custom" }))
    const models: readonly FakeModel[] = [{ provider: "anthropic", id: "claude-opus-5" }]

    // when
    const snapshot = generations.observe({
      omoConfig: { categories: { deep: { model: "anthropic/claude-opus-5", reasoningEffort: "high" } } },
      registry: registry(models),
    })

    // then
    expect(snapshot.categories["deep"]).toBe("custom/custom/high")
  })

  test("#given an unresolvable target #when planned #then the planner error passes through untouched and no generation is recorded", () => {
    // given
    const { generations, planner } = harness(() => [])

    // when
    const result = plan(planner, "no-such-category")

    // then
    expect(result.kind).toBe("error")
    expect(generations.current()).toBeUndefined()
  })

  test("#given no live registry #when planned #then observation is skipped and the plan error survives", () => {
    // given
    const generations = createCategoryConfigGenerations()
    const planner = createGenerationObservingPlanner({
      planner: createTaskChildPlanner(CONFIG, {}, () => undefined),
      omoConfig: CONFIG,
      resolveRegistry: () => undefined,
      generations,
    })

    // when
    const result = plan(planner, "quick")

    // then
    expect(result.kind).toBe("error")
    expect(generations.current()).toBeUndefined()
  })
})
