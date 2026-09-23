import { describe, expect, test } from "bun:test"

import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"
import { resolveModelWithFallback } from "./model-resolver"

describe("GitHub Copilot GPT-5.6 and GPT-6 Astra resolution", () => {
  test("ultrabrain and deep-high prefer Copilot Astra when available", () => {
    const availableModels = new Set(["github-copilot/gpt-6-astra", "github-copilot/gpt-5.6-sol"])
    expect(resolveModelWithFallback({ fallbackChain: CATEGORY_MODEL_REQUIREMENTS.ultrabrain.fallbackChain, availableModels, systemDefaultModel: "system/default" })).toMatchObject({ model: "github-copilot/gpt-6-astra", variant: "max" })
    expect(resolveModelWithFallback({ fallbackChain: CATEGORY_MODEL_REQUIREMENTS["deep-high"].fallbackChain, availableModels, systemDefaultModel: "system/default" })).toMatchObject({ model: "github-copilot/gpt-6-astra", variant: "xhigh" })
  })

  test("unspecified-high never borrows Copilot Astra: it takes the Copilot Opus 5.5 rung, and without it falls to the system default", () => {
    const withOpus = new Set(["github-copilot/gpt-6-astra", "github-copilot/claude-opus-5-5"])
    expect(resolveModelWithFallback({ fallbackChain: CATEGORY_MODEL_REQUIREMENTS["unspecified-high"].fallbackChain, availableModels: withOpus, systemDefaultModel: "system/default" })).toMatchObject({ model: "github-copilot/claude-opus-5-5", variant: "medium" })

    const gptOnly = new Set(["github-copilot/gpt-6-astra", "github-copilot/gpt-5.6-sol"])
    expect(resolveModelWithFallback({ fallbackChain: CATEGORY_MODEL_REQUIREMENTS["unspecified-high"].fallbackChain, availableModels: gptOnly, systemDefaultModel: "system/default" })).toMatchObject({ model: "system/default" })
  })

  test("ultrabrain falls back to Copilot GPT-5.6 Sol when Astra is absent, while deep-high and deep-low never use it", () => {
    const availableModels = new Set(["github-copilot/gpt-5.6-sol"])
    expect(resolveModelWithFallback({ fallbackChain: CATEGORY_MODEL_REQUIREMENTS.ultrabrain.fallbackChain, availableModels, systemDefaultModel: "system/default" })).toMatchObject({ model: "github-copilot/gpt-5.6-sol", variant: "max" })
    expect(resolveModelWithFallback({ fallbackChain: CATEGORY_MODEL_REQUIREMENTS["deep-low"].fallbackChain, availableModels, systemDefaultModel: "system/default" })).toMatchObject({ model: "system/default" })
    expect(resolveModelWithFallback({ fallbackChain: CATEGORY_MODEL_REQUIREMENTS["deep-high"].fallbackChain, availableModels, systemDefaultModel: "system/default" })).toMatchObject({ model: "system/default" })
  })
  const selectionCases = [
    {
      name: "hephaestus",
      requirement: AGENT_MODEL_REQUIREMENTS.hephaestus,
      expectedModel: "github-copilot/gpt-5.6-sol",
      expectedVariant: "medium",
    },
    {
      name: "momus",
      requirement: AGENT_MODEL_REQUIREMENTS.momus,
      expectedModel: "github-copilot/gpt-6-astra",
      expectedVariant: "high",
    },
    {
      name: "ultrabrain",
      requirement: CATEGORY_MODEL_REQUIREMENTS.ultrabrain,
      expectedModel: "github-copilot/gpt-6-astra",
      expectedVariant: "max",
    },
    {
      name: "deep-low",
      requirement: CATEGORY_MODEL_REQUIREMENTS["deep-low"],
      expectedModel: "github-copilot/gpt-6-sol",
      expectedVariant: "medium",
    },
    {
      name: "deep-high",
      requirement: CATEGORY_MODEL_REQUIREMENTS["deep-high"],
      expectedModel: "github-copilot/gpt-6-astra",
      expectedVariant: "xhigh",
    },
    {
      name: "unspecified-low",
      requirement: CATEGORY_MODEL_REQUIREMENTS["unspecified-low"],
      expectedModel: "github-copilot/gpt-5.6-terra",
      expectedVariant: "high",
    },
  ] as const

  for (const { name, requirement, expectedModel, expectedVariant } of selectionCases) {
    test(`${name} selects its Copilot GPT model with its configured variant`, () => {
      // given
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

  test("warm cache does not pick up a transformed Vercel Astra now that vercel left the default lanes", () => {
    // given
    const availableModels = new Set(["vercel/openai/gpt-6-astra"])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.momus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toEqual({
      model: "system/default",
      source: "system-default",
      variant: undefined,
    })
  })

  test("warm cache prefers the Copilot rung over a transformed Vercel astra", () => {
    // given
    const availableModels = new Set([
      "github-copilot/gpt-6-astra",
      "vercel/openai/gpt-6-astra",
    ])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.momus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toEqual({
      model: "github-copilot/gpt-6-astra",
      source: "provider-fallback",
      variant: "high",
    })
  })

  test("Copilot keeps the GPT-6 Astra max tier because no Copilot cap applies", () => {
    const entries = CATEGORY_MODEL_REQUIREMENTS.ultrabrain.fallbackChain.filter(({ model, providers }) => model === "gpt-6-astra" && providers.includes("github-copilot"))
    expect(entries).toEqual([{ providers: ["github-copilot"], model: "gpt-6-astra", variant: "max" }])
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

  test("momus prefers native Astra xhigh over the Copilot Astra rung when both are available", () => {
    // given
    const availableModels = new Set(["chatgpt-subscription/gpt-6-astra", "github-copilot/gpt-6-astra"])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.momus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toEqual({
      model: "chatgpt-subscription/gpt-6-astra",
      source: "provider-fallback",
      variant: "xhigh",
    })
  })

  test("momus falls to claude-opus-5-5 max when no Astra rung is available", () => {
    // given
    const availableModels = new Set(["github-copilot/gpt-5.6-sol", "anthropic/claude-opus-5-5"])

    // when
    const result = resolveModelWithFallback({
      fallbackChain: AGENT_MODEL_REQUIREMENTS.momus.fallbackChain,
      availableModels,
      systemDefaultModel: "system/default",
    })

    // then
    expect(result).toEqual({
      model: "anthropic/claude-opus-5-5",
      source: "provider-fallback",
      variant: "max",
    })
  })

  const fallbackCases = [
    { name: "hephaestus", requirement: AGENT_MODEL_REQUIREMENTS.hephaestus },
    { name: "momus", requirement: AGENT_MODEL_REQUIREMENTS.momus },
    { name: "deep-low", requirement: CATEGORY_MODEL_REQUIREMENTS["deep-low"] },
    { name: "deep-high", requirement: CATEGORY_MODEL_REQUIREMENTS["deep-high"] },
  ] as const

  for (const { name, requirement } of fallbackCases) {
    test(`${name} ignores GPT-5.5 when its frontier GPT rungs are unavailable`, () => {
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
