import { afterEach, describe, expect, test } from "bun:test"

import { resolveCompactionFallbackChain, resolveCompactionModel } from "./compaction-model-resolver"
import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

describe("resolveCompactionModel", () => {
  afterEach(() => {
    clearSessionAgent("ses_compaction_resolver")
  })

  test("returns the original model when no session agent is registered", () => {
    //#given
    const pluginConfig = unsafeTestValue({ agents: {} })

    //#when
    const result = resolveCompactionModel(
      pluginConfig,
      "ses_compaction_resolver",
      "anthropic",
      "claude-opus-4-7",
    )

    //#then
    expect(result).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
  })

  test("uses agents[X].compaction.model when configured", () => {
    //#given
    setSessionAgent("ses_compaction_resolver", "sisyphus")
    const pluginConfig = unsafeTestValue({
      agents: {
        sisyphus: {
          compaction: { model: "google/gemini-3.1-flash-preview" },
        },
      },
    })

    //#when
    const result = resolveCompactionModel(
      pluginConfig,
      "ses_compaction_resolver",
      "anthropic",
      "claude-opus-4-7",
    )

    //#then
    expect(result).toEqual({ providerID: "google", modelID: "gemini-3.1-flash-preview" })
  })
})

describe("resolveCompactionFallbackChain (#3779)", () => {
  afterEach(() => {
    clearSessionAgent("ses_compaction_chain")
  })

  test("returns undefined when no compaction-scoped fallback_models is set", () => {
    //#given - the resolver intentionally does NOT fall back to agent-level
    //         chain here; that fall-through is the responsibility of
    //         getRawFallbackModelsForScope, which the resolver delegates to.
    //         (The fall-through is exercised in fallback-models.test.ts.)
    setSessionAgent("ses_compaction_chain", "sisyphus")
    const pluginConfig = unsafeTestValue({
      agents: {
        sisyphus: {
          compaction: { model: "google/gemini-3.1-flash-preview" },
        },
      },
    })

    //#when
    const result = resolveCompactionFallbackChain(
      pluginConfig,
      "ses_compaction_chain",
      "google",
    )

    //#then
    expect(result).toBeUndefined()
  })

  test("returns the scoped chain built against the override provider context", () => {
    //#given - mirrors the example in #3779 issue body
    setSessionAgent("ses_compaction_chain", "sisyphus")
    const pluginConfig = unsafeTestValue({
      agents: {
        sisyphus: {
          fallback_models: ["openai/gpt-5.5"],
          compaction: {
            model: "google/gemini-3.1-flash-preview",
            fallback_models: ["openai/gpt-5.4"],
          },
        },
      },
    })

    //#when - currentProviderID is google because the primary compaction
    //         override is "google/gemini-3.1-flash-preview".
    const result = resolveCompactionFallbackChain(
      pluginConfig,
      "ses_compaction_chain",
      "google",
    )

    //#then - scoped chain wins over agent-level fallback ("openai/gpt-5.5")
    expect(result).toBeDefined()
    expect(result?.length).toBe(1)
    expect(result?.[0]?.providers).toContain("openai")
    expect(result?.[0]?.model).toBe("gpt-5.4")
  })

  test("returns undefined when no session agent is registered (no scope to resolve from)", () => {
    //#given - explicit no setSessionAgent call

    //#when
    const result = resolveCompactionFallbackChain(
      unsafeTestValue({ agents: {} }),
      "ses_compaction_chain",
      "google",
    )

    //#then
    expect(result).toBeUndefined()
  })
})
