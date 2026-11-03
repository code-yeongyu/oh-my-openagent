import { describe, expect, test } from "bun:test"

import { OmoAgentDefSchema } from "./agent"

describe("agent schema permission and prompt_append keys", () => {
  test("#given an agent carrying permission and prompt_append #when parsed #then both keys are accepted", () => {
    // given
    const definition = {
      description: "a",
      prompt: "p",
      permission: {
        edit: "deny",
        bash: { "rm *": "ask" },
      },
      prompt_append: "x",
    }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.permission?.edit).toBe("deny")
    expect(result.data.permission?.bash).toEqual({ "rm *": "ask" })
    expect(result.data.prompt_append).toBe("x")
  })

  test("#given an agent carrying a truly unknown key #when parsed #then strict mode still rejects it", () => {
    // given
    const definition = { bogus_key: 1 }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a permission object with an invalid value #when parsed #then the schema rejects it", () => {
    // given
    const definition = { permission: { edit: "sometimes" } }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(false)
  })

  test("#given an agent carrying every key documented in the per-agent config table #when parsed #then all are accepted", () => {
    // given — the per-agent table in docs/reference/configuration.md; keep in sync
    const definition = {
      fallback_models: ["anthropic/claude-opus-5"],
      category: "ultrabrain",
      skills: ["frontend"],
      top_p: 0.9,
      mode: "primary",
      color: "#FF6600",
      displayName: "Sisyphus",
      maxTokens: 8192,
      thinking: { type: "enabled", budgetTokens: 4096 },
      textVerbosity: "high",
      providerOptions: { anthropic: { cache: true } },
      ultrawork: { model: "anthropic/claude-opus-5" },
      compaction: { model: "anthropic/claude-sonnet-5" },
      allow_non_gpt_model: true,
    }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.ultrawork).toEqual({ model: "anthropic/claude-opus-5" })
    expect(result.data.allow_non_gpt_model).toBe(true)
    expect(result.data.max_tokens).toBe(8192)
    expect(result.data.provider_options?.thinking).toEqual({ type: "enabled", budgetTokens: 4096 })
  })
})
