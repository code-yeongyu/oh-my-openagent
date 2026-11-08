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

  test("#given catalog references inside a model profile chain #when resolved #then the chain expands exactly like a category chain", () => {
    // given
    const view = OmoConfigSchema.parse({
      models: {
        fable: { model: "anthropic/claude-fable-5-1", reasoningEffort: "max" },
      },
      model_profiles: {
        capable: {
          display_name: "Capable",
          models: ["fable", { model: "fable", variant: "high" }, "openai/gpt-6-astra"],
        },
      },
    })
    const originalView = structuredClone(view)

    // when
    const result = resolveModelReferences(view)

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.view.model_profiles?.capable).toEqual({
      display_name: "Capable",
      models: [
        { model: "anthropic/claude-fable-5-1", reasoning: "max" },
        { model: "anthropic/claude-fable-5-1", reasoning: "high" },
        "openai/gpt-6-astra",
      ],
    })
    expect(view).toEqual(originalView)
  })

  test("#given a self-referential catalog entry named by a profile chain #when resolved #then only the existing cycle diagnostic is returned", () => {
    // given
    const view = OmoConfigSchema.parse({
      models: {
        a: { model: "a" },
      },
      model_profiles: {
        capable: { models: ["a"] },
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
    expect(result.view.model_profiles?.capable?.models).toEqual(["a"])
  })

  test("#given a model profile named like a catalog entry #when resolved #then a validation diagnostic reports the shadowing", () => {
    // given
    const view = OmoConfigSchema.parse({
      models: {
        capable: { model: "anthropic/claude-fable-5-1" },
      },
      model_profiles: {
        capable: { models: ["anthropic/claude-fable-5-1"] },
      },
    })

    // when
    const result = resolveModelReferences(view)

    // then
    expect(result.diagnostics).toEqual([
      {
        kind: "validation",
        message: 'Model profile "capable" shadows a model catalog entry of the same name',
        path: "model_profiles.capable",
      },
    ])
  })

  test("#given a bare profile name inside category and agent chains #when resolved #then each occurrence is reported as an unsupported splice", () => {
    // given
    const view = OmoConfigSchema.parse({
      model_profiles: {
        capable: { models: ["anthropic/claude-fable-5-1"] },
      },
      categories: {
        deep: { models: ["capable", "openai/gpt-6-astra"] },
      },
      agents: {
        reviewer: { models: [{ model: "capable" }, "capable"] },
      },
    })

    // when
    const result = resolveModelReferences(view)

    // then
    expect(result.diagnostics).toEqual([
      {
        kind: "validation",
        message: '"capable" is a model profile; splicing a profile into a category chain is not supported yet',
        path: "categories.deep.models.0",
      },
      {
        kind: "validation",
        message: '"capable" is a model profile; splicing a profile into a category chain is not supported yet',
        path: "agents.reviewer.models.1",
      },
    ])
    expect(result.view.categories?.deep?.models).toEqual(["capable", "openai/gpt-6-astra"])
  })

  test("#given profiles that shadow nothing and chains that name no profile #when resolved #then no profile diagnostic is emitted", () => {
    // given
    const view = OmoConfigSchema.parse({
      models: {
        fable: { model: "anthropic/claude-fable-5-1" },
      },
      model_profiles: {
        capable: { models: ["fable"] },
      },
      categories: {
        deep: { models: ["fable", "openai/gpt-6-astra"] },
      },
      agents: {
        reviewer: { models: ["openai/gpt-6-astra"] },
      },
    })

    // when
    const result = resolveModelReferences(view)

    // then
    expect(result.diagnostics).toEqual([])
  })
})
