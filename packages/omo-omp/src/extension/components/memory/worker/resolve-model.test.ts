import { describe, expect, test } from "bun:test"

import { OmoTaskSettingsSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { resolveReflectionModel, shouldWarnCategoryUnavailable } from "./resolve-model"

const model: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
const registry = {
  getAvailable: () => [model],
  find: (provider: string, modelId: string) =>
    provider === model.provider && modelId === model.id ? model : undefined,
}

describe("resolveReflectionModel", () => {
  test("#given quick category model and reasoning #when resolved #then it returns the Senpi model selector and thinking level", () => {
    // given
    const config: OmoConfig = {
      categories: { quick: { model: "omo-mock/mock-1", reasoning: "high" } },
    }

    // when
    const result = resolveReflectionModel("quick", config, registry)

    // then
    expect(result).toEqual({
      kind: "resolved",
      category: "quick",
      model: "omo-mock/mock-1",
      thinking: "high",
    })
  })

  test("#given an empty model registry #when quick cannot resolve #then it fails closed as category_unavailable", () => {
    // given
    const config: OmoConfig = { categories: {} }

    // when
    const result = resolveReflectionModel("quick", config, {
      getAvailable: () => [],
      find: () => undefined,
    })

    // then
    expect(result.kind).toBe("category_unavailable")
    if (result.kind === "category_unavailable") {
      expect(result.category).toBe("quick")
      expect(result.attemptedChain?.length).toBeGreaterThan(0)
    }
  })

  test("#given a pinned user model with a stale availability snapshot #when resolved #then find() wins over the gate", () => {
    // given: availability is stale (empty) but registry.find can still locate the pinned model
    const staleRegistry = {
      getAvailable: () => [],
      find: (provider: string, modelId: string) =>
        provider === model.provider && modelId === model.id ? model : undefined,
    }
    const config: OmoConfig = {
      categories: { quick: { model: "omo-mock/mock-1" } },
    }

    // when
    const result = resolveReflectionModel("quick", config, staleRegistry)

    // then
    expect(result).toEqual({ kind: "resolved", category: "quick", model: "omo-mock/mock-1" })
  })

  test("#given a pinned model that find() cannot locate #when resolved #then it still fails closed", () => {
    // given
    const staleRegistry = {
      getAvailable: () => [],
      find: () => undefined,
    }
    const config: OmoConfig = {
      categories: { quick: { model: "omo-mock/ghost" } },
    }

    // when
    const result = resolveReflectionModel("quick", config, staleRegistry)

    // then
    expect(result.kind).toBe("category_unavailable")
  })

  test("#given the task warning suppression convention #when evaluated #then global opt-out and per-category opt-in retain their precedence", () => {
    // given
    const globallySuppressed: OmoConfig = {
      task: OmoTaskSettingsSchema.parse({ warnings: { unavailable_categories: false } }),
    }
    const categoryOptIn: OmoConfig = {
      task: OmoTaskSettingsSchema.parse({ warnings: { unavailable_categories: false } }),
      categories: { quick: { warn_unavailable: true } },
    }

    // when / then
    expect(shouldWarnCategoryUnavailable(globallySuppressed, "quick")).toBe(false)
    expect(shouldWarnCategoryUnavailable(categoryOptIn, "quick")).toBe(true)
    expect(shouldWarnCategoryUnavailable({ categories: { quick: { model: "missing/model" } } }, "quick")).toBe(false)
  })
})
