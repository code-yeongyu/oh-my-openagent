import { describe, expect, test } from "bun:test"
import { parseModelString, parseVariantFromModelID } from "./model-string-parser"

describe("parseVariantFromModelID", () => {
  test("extracts parenthesized variant", () => {
    expect(parseVariantFromModelID("claude-opus(max)")).toEqual({
      modelID: "claude-opus",
      variant: "max",
    })
  })

  test("extracts space-delimited known variant", () => {
    expect(parseVariantFromModelID("claude-opus high")).toEqual({
      modelID: "claude-opus",
      variant: "high",
    })
  })
})

describe("parseModelString", () => {
  test("normalizes provider casing", () => {
    expect(parseModelString("GitHub-Copilot/gpt-5.4")).toEqual({
      providerID: "github-copilot",
      modelID: "gpt-5.4",
    })
  })

  test("preserves parsed variant while normalizing provider casing", () => {
    expect(parseModelString("AnThRoPiC/claude-opus(max)")).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus",
      variant: "max",
    })
  })
})
