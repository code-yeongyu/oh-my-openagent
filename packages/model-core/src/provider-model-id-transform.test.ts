import { describe, expect, test } from "bun:test"

import { transformModelForProvider } from "./provider-model-id-transform"

describe("provider model id transform", () => {
  test("qualifies Atlas Cloud model IDs with their upstream organization", () => {
    expect(transformModelForProvider("atlascloud", "kimi-k3")).toBe("moonshotai/kimi-k3")
    expect(transformModelForProvider("atlascloud", "gpt-5.6-sol")).toBe("openai/gpt-5.6-sol")
    expect(transformModelForProvider("atlascloud", "deepseek-v4-pro")).toBe("deepseek-ai/deepseek-v4-pro")
  })

  test("transforms kimi models for kimi coding providers", () => {
    // given
    const provider = "kimi-coding"

    // when
    const transformed = transformModelForProvider(provider, "kimi-k3")
    const transformed256k = transformModelForProvider(provider, "kimi-k3-256k")

    // then
    expect(transformed).toBe("k3")
    expect(transformed256k).toBe("k3-256k")
  })

  test("passes through unrelated models unchanged", () => {
    // given
    const provider = "kimi-for-coding"

    // when
    const transformed = transformModelForProvider(provider, "gpt-5.6-luna-fast")

    // then
    expect(transformed).toBe("gpt-5.6-luna-fast")
  })
})
