import { describe, expect, test } from "bun:test"

import { transformModelForProvider } from "./provider-model-id-transform"

describe("provider model id transform", () => {
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
