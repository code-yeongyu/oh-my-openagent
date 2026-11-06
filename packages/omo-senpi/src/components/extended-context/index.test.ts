import { describe, expect, it } from "bun:test"

import {
  applyContextWindowOverrides,
  clearContextWindowOverrides,
  contextWindowOverrideIds,
  type ModelsJson,
} from "./store"
import { computeWidenedWindows, matchReportedSlug, parseReportedWindows } from "./windows"

const reported = parseReportedWindows({
  models: [
    { slug: "gpt-6.1-sol", context_window: 500_000, max_context_window: 872_000 },
    { slug: "gpt-6-luna", context_window: 922_000, max_context_window: 872_000 },
    { slug: "gpt-6.1-sol-ultrafast", context_window: 500_000, max_context_window: 872_000 },
    { slug: "", context_window: 1, max_context_window: 1 },
    { slug: "broken" },
  ],
})

describe("parseReportedWindows", () => {
  it("#given a payload with unusable rows #when parsed #then only rows with a slug and a maximum survive", () => {
    expect(reported).toEqual([
      { slug: "gpt-6.1-sol", contextWindow: 500_000, maxContextWindow: 872_000 },
      { slug: "gpt-6-luna", contextWindow: 922_000, maxContextWindow: 872_000 },
      { slug: "gpt-6.1-sol-ultrafast", contextWindow: 500_000, maxContextWindow: 872_000 },
    ])
  })

  it("#given a non-object payload #when parsed #then it yields no windows", () => {
    expect(parseReportedWindows("nope")).toEqual([])
    expect(parseReportedWindows(undefined)).toEqual([])
  })
})

describe("matchReportedSlug", () => {
  const slugs = ["gpt-6.1-sol", "gpt-6.1-sol-ultrafast"]

  it("#given a clone id #when matched #then the longest owning slug wins", () => {
    expect(matchReportedSlug("gpt-6.1-sol-ultrafast", slugs)).toBe("gpt-6.1-sol-ultrafast")
    expect(matchReportedSlug("gpt-6.1-sol-fast", slugs)).toBe("gpt-6.1-sol")
  })

  it("#given an unrelated id #when matched #then nothing matches", () => {
    expect(matchReportedSlug("gpt-5.6-terra", slugs)).toBeUndefined()
  })
})

describe("computeWidenedWindows", () => {
  it("#given a reported maximum above the catalog window #when computed #then the output reserve is subtracted", () => {
    const widened = computeWidenedWindows(
      [{ id: "gpt-6.1-sol", contextWindow: 500_000, maxTokens: 128_000 }],
      reported,
    )
    expect(widened).toEqual([
      { id: "gpt-6.1-sol", slug: "gpt-6.1-sol", from: 500_000, to: 744_000 },
    ])
  })

  it("#given a catalog window above the reported maximum #when computed #then it is never lowered", () => {
    const widened = computeWidenedWindows(
      [{ id: "gpt-6-luna", contextWindow: 922_000, maxTokens: 128_000 }],
      reported,
    )
    expect(widened).toEqual([])
  })

  it("#given a model the subscription does not report #when computed #then it is left alone", () => {
    const widened = computeWidenedWindows(
      [{ id: "gpt-5.6-terra", contextWindow: 272_000, maxTokens: 128_000 }],
      reported,
    )
    expect(widened).toEqual([])
  })
})

describe("models.json overrides", () => {
  const widened = [{ id: "gpt-6.1-sol", slug: "gpt-6.1-sol", from: 500_000, to: 744_000 }]

  it("#given a provider with another override #when applied #then only contextWindow is written", () => {
    const config: ModelsJson = {
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { maxTokens: 64_000 } } } },
    }
    const next = applyContextWindowOverrides(config, "chatgpt-subscription", widened)
    expect(next.providers?.["chatgpt-subscription"]?.modelOverrides?.["gpt-6.1-sol"]).toEqual({
      maxTokens: 64_000,
      contextWindow: 744_000,
    })
  })

  it("#given applied overrides #when cleared #then the window is dropped and a sibling override survives", () => {
    const applied = applyContextWindowOverrides(
      { providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { maxTokens: 64_000 } } } } },
      "chatgpt-subscription",
      widened,
    )
    const { config, cleared } = clearContextWindowOverrides(applied, "chatgpt-subscription")
    expect(cleared).toEqual(["gpt-6.1-sol"])
    expect(config.providers?.["chatgpt-subscription"]?.modelOverrides?.["gpt-6.1-sol"]).toEqual({
      maxTokens: 64_000,
    })
  })

  it("#given a provider whose only override was the window #when cleared #then the provider entry is removed", () => {
    const { config } = clearContextWindowOverrides(
      { providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } } },
      "chatgpt-subscription",
    )
    expect(config.providers).toBeUndefined()
  })
})

describe("toggle state", () => {
  it("#given a written window override #when the command inspects it #then the toggle knows it is on", () => {
    const config: ModelsJson = {
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } },
    }
    expect(contextWindowOverrideIds(config, "chatgpt-subscription")).toEqual(["gpt-6.1-sol"])
  })

  it("#given an override that only sets another field #when inspected #then the toggle stays on the apply path", () => {
    const config: ModelsJson = {
      providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { maxTokens: 64_000 } } } },
    }
    expect(contextWindowOverrideIds(config, "chatgpt-subscription")).toEqual([])
  })
})
