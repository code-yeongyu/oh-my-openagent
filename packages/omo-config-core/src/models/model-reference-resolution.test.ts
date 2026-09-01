import { describe, expect, test } from "bun:test"

import { OmoConfigSchema } from "../schema"
import { resolveModelReferences } from "./model-reference-resolution"

describe("resolveModelReferences", () => {
  test("#given catalog references in agent and category model chains #when resolved #then ids and unset tuning come from the catalog without mutating the view", () => {
    // given
    const view = OmoConfigSchema.parse({
      models: {
        sol: { model: "openai/gpt-5.6-sol", variant: "high", reasoningEffort: "xhigh" },
      },
      agents: {
        oracle: { model: "sol", models: ["sol"] },
      },
      categories: {
        deep: { model: "sol", fallback_models: ["sol"] },
      },
    })
    const originalView = structuredClone(view)

    // when
    const result = resolveModelReferences(view)

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.view.agents?.oracle).toEqual({
      model: "openai/gpt-5.6-sol",
      reasoning: "xhigh",
      models: [{ model: "openai/gpt-5.6-sol", reasoning: "xhigh" }],
    })
    expect(result.view.categories?.deep).toEqual({
      model: "openai/gpt-5.6-sol",
      reasoning: "xhigh",
      fallback_models: [{ model: "openai/gpt-5.6-sol", reasoning: "xhigh" }],
    })
    expect(view).toEqual(originalView)
  })

  test("#given site-local tuning beside catalog references #when resolved #then site tuning wins", () => {
    // given
    const view = OmoConfigSchema.parse({
      models: {
        sol: { model: "openai/gpt-5.6-sol", variant: "high", reasoningEffort: "xhigh" },
      },
      agents: {
        oracle: {
          model: "sol",
          variant: "low",
          reasoningEffort: "minimal",
          models: [{ model: "sol", variant: "medium", reasoningEffort: "high" }],
        },
      },
      categories: {
        deep: {
          fallback_models: [{ model: "sol", variant: "medium", reasoningEffort: "high" }],
        },
      },
    })

    // when
    const result = resolveModelReferences(view)

    // then
    expect(result.view.agents?.oracle?.model).toBe("openai/gpt-5.6-sol")
    expect(result.view.agents?.oracle?.reasoning).toBe("minimal")
    expect(result.view.agents?.oracle?.models).toEqual([
      { model: "openai/gpt-5.6-sol", reasoning: "high" },
    ])
    expect(result.view.categories?.deep?.fallback_models).toEqual([
      { model: "openai/gpt-5.6-sol", reasoning: "high" },
    ])
  })

  test("#given model names outside the catalog #when resolved #then every name passes through verbatim", () => {
    // given
    const view = OmoConfigSchema.parse({
      models: {
        sol: { model: "openai/gpt-5.6-sol" },
      },
      agents: {
        oracle: { model: "anthropic/claude", models: ["openai/gpt-5"] },
      },
      categories: {
        deep: { model: "anthropic/claude", fallback_models: ["openai/gpt-5"] },
      },
    })

    // when
    const result = resolveModelReferences(view)

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.view.agents?.oracle?.model).toBe("anthropic/claude")
    expect(result.view.agents?.oracle?.models).toEqual(["openai/gpt-5"])
    expect(result.view.categories?.deep?.model).toBe("anthropic/claude")
    expect(result.view.categories?.deep?.fallback_models).toEqual(["openai/gpt-5"])
  })

  test("#given a self-referential catalog entry #when resolved #then a cycle diagnostic is returned without hanging", () => {
    // given
    const view = OmoConfigSchema.parse({
      models: {
        a: { model: "a" },
      },
      agents: {
        oracle: { model: "a" },
      },
    })

    // when
    const result = resolveModelReferences(view)

    // then
    expect(result.diagnostics).toEqual([
      {
        kind: "model_catalog_cycle",
        message: 'Model catalog entry "a" references itself',
        path: "models.a.model",
      },
    ])
    expect(result.view.agents?.oracle?.model).toBe("a")
  })
})
