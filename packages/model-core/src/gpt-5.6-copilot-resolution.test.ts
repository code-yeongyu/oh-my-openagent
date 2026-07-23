import { describe, expect, test } from "bun:test"

import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"
import { resolveModelWithFallback } from "./model-resolver"

describe("GitHub Copilot GPT-5.6 resolution", () => {
  const selectionCases = [
    {
      name: "hephaestus",
      requirement: AGENT_MODEL_REQUIREMENTS.hephaestus,
      expectedModel: "github-copilot/gpt-5.6-sol",
    },
    {
      name: "momus",
      requirement: AGENT_MODEL_REQUIREMENTS.momus,
      expectedModel: "github-copilot/gpt-5.6-terra",
    },
    {
      name: "ultrabrain",
      requirement: CATEGORY_MODEL_REQUIREMENTS.ultrabrain,
      expectedModel: "github-copilot/gpt-5.6-sol",
    },
    {
      name: "deep",
      requirement: CATEGORY_MODEL_REQUIREMENTS.deep,
      expectedModel: "github-copilot/gpt-5.6-terra",
    },
    {
      name: "unspecified-low",
      requirement: CATEGORY_MODEL_REQUIREMENTS["unspecified-low"],
      expectedModel: "github-copilot/gpt-5.6-luna",
    },
  ] as const

  for (const { name, requirement, expectedModel } of selectionCases) {
    test(`${name} selects its Copilot GPT-5.6 model with its configured variant`, () => {
      // given
      const expectedVariant = name === "hephaestus" ? "medium" : "high"
      const availableModels = new Set([expectedModel, "github-copilot/gpt-5.5"])

      // when
      const result = resolveModelWithFallback({
        fallbackChain: requirement.fallbackChain,
        availableModels,
        systemDefaultModel: "system/default",
      })

      // then
      expect(result).toEqual({
        model: expectedModel,
        source: "provider-fallback",
        variant: expectedVariant,
      })
    })
  }

  test("warm cache resolves transformed Vercel GPT-5.6 with high", () => {
    // given
    const availableModels = new Set(["vercel/openai/gpt-5.6-terra"])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.momus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toEqual({
      model: "vercel/openai/gpt-5.6-terra",
      source: "provider-fallback",
      variant: "high",
    })
  })

  test("warm cache keeps transformed Vercel terra ahead of Copilot terra", () => {
    // given
    const availableModels = new Set([
      "github-copilot/gpt-5.6-terra",
      "vercel/openai/gpt-5.6-terra",
    ])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.momus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toEqual({
      model: "vercel/openai/gpt-5.6-terra",
      source: "provider-fallback",
      variant: "high",
    })
  })

  test("Copilot is never included in a GPT-5.6 xhigh rung", () => {
    // given
    const requirements = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ]

    // when
    const copilotXhighEntries = requirements.flatMap(({ fallbackChain }) =>
      fallbackChain.filter(
        ({ model, providers, variant }) =>
          model.startsWith("gpt-5.6-") && providers.includes("github-copilot") && variant === "xhigh"
      )
    )

    // then
    expect(copilotXhighEntries).toEqual([])
  })

  test("momus uses high for its Copilot Sol fallback when Terra is unavailable", () => {
    // given
    const availableModels = new Set(["github-copilot/gpt-5.6-sol"])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.momus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toEqual({
      model: "github-copilot/gpt-5.6-sol",
      source: "provider-fallback",
      variant: "high",
    })
  })

  const fallbackCases = [
    { name: "hephaestus", requirement: AGENT_MODEL_REQUIREMENTS.hephaestus },
    { name: "momus", requirement: AGENT_MODEL_REQUIREMENTS.momus },
    { name: "deep", requirement: CATEGORY_MODEL_REQUIREMENTS.deep },
  ] as const

  for (const { name, requirement } of fallbackCases) {
    test(`${name} ignores GPT-5.5 when its GPT-5.6 rungs are unavailable`, () => {
      // given
      const availableModels = new Set(["github-copilot/gpt-5.5"])

      // when
      const result = resolveModelWithFallback({
        fallbackChain: requirement.fallbackChain,
        availableModels,
        systemDefaultModel: "system/default",
      })

      // then
      expect(result).toEqual({
        model: "system/default",
        source: "system-default",
      })
    })
  }
})
