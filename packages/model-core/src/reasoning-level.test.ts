import { describe, expect, test } from "bun:test"
import { clampReasoningLevel, normalizeReasoning, splitReasoningSuffix } from "./reasoning-level"

describe("reasoning-level", () => {
  test("given none when normalized then it becomes off", () => {
    expect(normalizeReasoning("none")).toEqual({ level: "off" })
  })

  test("given unknown token when normalized then it passes through", () => {
    expect(normalizeReasoning("thinking")).toEqual({ passthrough: "thinking" })
  })

  test("given requested reasoning when clamped then it downgrades within one ladder", () => {
    expect(clampReasoningLevel("xhigh", ["low", "medium"])).toBe("medium")
  })

  test("given provider suffix when split then it extracts reasoning level", () => {
    expect(splitReasoningSuffix("anthropic/claude:high")).toEqual({ base: "anthropic/claude", level: "high" })
  })

  test("given max suffix without provider prefix when split then it stays attached", () => {
    expect(splitReasoningSuffix("model:max")).toEqual({ base: "model:max" })
  })

  test("given max suffix with provider prefix when split then it extracts the suffix", () => {
    expect(splitReasoningSuffix("anthropic/claude:max")).toEqual({ base: "anthropic/claude", level: "max" })
  })

  test("given max suffix without provider prefix when allowMaxSuffix then it extracts the suffix", () => {
    expect(splitReasoningSuffix("gpt-5.6-sol:max", { allowMaxSuffix: true })).toEqual({ base: "gpt-5.6-sol", level: "max" })
  })

  test("given max suffix without provider prefix and no option when split then it stays attached", () => {
    expect(splitReasoningSuffix("gpt-5.6-sol:max")).toEqual({ base: "gpt-5.6-sol:max" })
  })
})
