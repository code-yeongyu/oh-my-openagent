import { describe, expect, test } from "bun:test"

import { normalizeLegacyModelEntry } from "./fallback-models"

describe("normalizeLegacyModelEntry", () => {
  test("#given each deprecated reasoning spelling #when normalized #then reasoning is canonical and effort wins conflicts", () => {
    // given
    const entries = [
      { model: "openai/gpt-5", variant: "high" },
      { model: "openai/gpt-5", reasoningEffort: "none" },
      { model: "openai/gpt-5", variant: "low", reasoningEffort: "xhigh" },
      { model: "openai/gpt-5", thinking: { type: "disabled" } },
    ]

    // when
    const normalized = entries.map(normalizeLegacyModelEntry)

    // then
    expect(normalized.map((entry) => entry.reasoning)).toEqual(["high", "off", "xhigh", "off"])
  })

  test("#given enabled thinking and text verbosity #when normalized #then wire settings move under provider_options verbatim", () => {
    // given
    const thinking = { type: "enabled" as const, budgetTokens: 4096 }

    // when
    const normalized = normalizeLegacyModelEntry({
      model: "anthropic/claude",
      thinking,
      textVerbosity: "low",
    })

    // then
    expect(normalized.provider_options).toEqual({ thinking, textVerbosity: "low" })
  })

  test("#given camelCase tuning and legacy model suffixes #when normalized #then casing and suffixes are canonical", () => {
    // given
    const entries = [
      { model: "openai/gpt-5(xhigh)", maxTokens: 8192 },
      { model: "openai/gpt-5 minimal" },
      { model: "openai/gpt-5:high" },
    ]

    // when
    const normalized = entries.map(normalizeLegacyModelEntry)

    // then
    expect(normalized).toEqual([
      { model: "openai/gpt-5:xhigh", max_tokens: 8192 },
      { model: "openai/gpt-5:minimal" },
      { model: "openai/gpt-5:high" },
    ])
  })

  test("#given existing canonical provider options #when aliases normalize #then options merge without discarding canonical values", () => {
    // given
    const input = {
      model: "openai/gpt-5",
      provider_options: { service_tier: "priority" },
      textVerbosity: "high",
    }

    // when
    const normalized = normalizeLegacyModelEntry(input)

    // then
    expect(normalized.provider_options).toEqual({ service_tier: "priority", textVerbosity: "high" })
  })
})
