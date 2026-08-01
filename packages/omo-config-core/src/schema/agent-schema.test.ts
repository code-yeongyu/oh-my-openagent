import { describe, expect, test } from "bun:test"

import { OmoAgentDefSchema } from "./agent"

describe("agent model entries", () => {
  test("#given an agent whose models carry per-entry reasoning effort #when parsed #then the effort becomes canonical reasoning", () => {
    // given
    const definition = {
      models: [
        { model: "quotio-openai/gpt-5.6-luna-fast", reasoningEffort: "minimal" },
        { model: "quotio-openai/gpt-5.6-luna-fast", reasoningEffort: "minimal" },
      ],
    }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    const entries = result.data.models
    if (entries === undefined) throw new Error("Expected models to be preserved")
    const first = entries[0]
    if (typeof first === "string") throw new Error("Expected the object entry to stay an object")
    expect(first.model).toBe("quotio-openai/gpt-5.6-luna-fast")
    expect(first.reasoning).toBe("minimal")
  })

  test("#given an agent whose models mix strings and objects #when parsed #then both forms are accepted", () => {
    // given
    const definition = {
      model: "kimi-coding/kimi-for-coding-highspeed",
      models: ["quotio-openai/gpt-5.6-luna-fast", { model: "anthropic/claude-haiku-4-5", variant: "low" }],
    }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.models?.[0]).toBe("quotio-openai/gpt-5.6-luna-fast")
    const second = result.data.models?.[1]
    if (typeof second !== "object") throw new Error("Expected the second entry to stay an object")
    expect(second.reasoning).toBe("low")
  })

  test("#given an agent carrying top level variant and reasoning effort #when parsed #then effort wins as canonical reasoning", () => {
    // given
    const definition = {
      model: "quotio-openai/gpt-5.6-luna-fast",
      variant: "low",
      reasoningEffort: "minimal",
    }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.reasoning).toBe("minimal")
    expect(result.data.variant).toBeUndefined()
    expect(result.data.reasoningEffort).toBeUndefined()
  })

  test("#given plain string models #when parsed #then the legacy form still parses unchanged", () => {
    // given
    const definition = { models: ["anthropic/claude", "openai/gpt-5"] }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.models).toEqual(["anthropic/claude", "openai/gpt-5"])
  })

  test("#given a harness-native preset in reasoning effort #when parsed #then it passes through as canonical reasoning", () => {
    // given
    const definition = { models: [{ model: "openai/gpt-5", reasoningEffort: "turbo" }] }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    const entry = result.data.models?.[0]
    if (typeof entry !== "object") throw new Error("Expected object model entry")
    expect(entry.reasoning).toBe("turbo")
  })

  test("#given a model entry object without a model field #when parsed #then the schema rejects it", () => {
    // given
    const definition = { models: [{ reasoningEffort: "minimal" }] }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a model entry carrying an unknown key #when parsed #then the strict entry rejects it", () => {
    // given
    const definition = { models: [{ model: "openai/gpt-5", effort: "minimal" }] }

    // when
    const result = OmoAgentDefSchema.safeParse(definition)

    // then
    expect(result.success).toBe(false)
  })
})
