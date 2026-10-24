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

  test("transforms commandcode models for GOAT and greater plans", () => {
    expect(transformModelForProvider("commandcode", "commandcode/claude-3-7-sonnet")).toBe("claude-3-7-sonnet")
    expect(transformModelForProvider("commandcode", "commandcode/claude-sonnet-3-5")).toBe("claude-sonnet-3.5")
    expect(transformModelForProvider("commandcode-goat-plan", "gpt-4o")).toBe("gpt-4o")
    expect(transformModelForProvider("command-code", "deepseek-chat")).toBe("deepseek-chat")
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
