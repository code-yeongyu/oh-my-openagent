import { describe, it, expect } from "bun:test"
import { parseModelString, parseVariantFromModelID, splitProvidersAndModel } from "./model-string-parser"

describe("splitProvidersAndModel", () => {
  it("splits provider1|provider2/name format", () => {
    const result = splitProvidersAndModel("cpa|opencode-go/kimi-k2.6")
    expect(result).toEqual({ providers: ["cpa", "opencode-go"], modelID: "kimi-k2.6" })
  })

  it("splits single provider/model format", () => {
    const result = splitProvidersAndModel("cpa/kimi-k2.6")
    expect(result).toEqual({ providers: ["cpa"], modelID: "kimi-k2.6" })
  })

  it("handles provider|model with slashes in model", () => {
    const result = splitProvidersAndModel("anthropic|cpa/claude-opus-4-8")
    expect(result).toEqual({ providers: ["anthropic", "cpa"], modelID: "claude-opus-4-8" })
  })

  it("handles model without provider or slash", () => {
    const result = splitProvidersAndModel("kimi-k2.6")
    expect(result).toEqual({ providers: [], modelID: "kimi-k2.6" })
  })

  it("handles three providers", () => {
    const result = splitProvidersAndModel("cpa|opencode-go|zai/kimi-k2.6")
    expect(result).toEqual({ providers: ["cpa", "opencode-go", "zai"], modelID: "kimi-k2.6" })
  })

  it("returns empty arrays for empty string", () => {
    const result = splitProvidersAndModel("")
    expect(result).toEqual({ providers: [], modelID: "" })
  })

  it("handles trailing slash gracefully", () => {
    const result = splitProvidersAndModel("cpa|opencode-go/")
    expect(result).toEqual({ providers: ["cpa", "opencode-go"], modelID: "" })
  })
})

describe("parseModelString with pipe syntax", () => {
  it("extracts first provider from pipe syntax", () => {
    const result = parseModelString("cpa|opencode-go/kimi-k2.6")
    expect(result).toEqual({ providerID: "cpa", modelID: "kimi-k2.6" })
  })

  it("extracts variant from pipe syntax", () => {
    const result = parseModelString("cpa|opencode-go/kimi-k2.6 high")
    expect(result).toEqual({ providerID: "cpa", modelID: "kimi-k2.6", variant: "high" })
  })

  it("standard provider/model still works", () => {
    const result = parseModelString("openai/gpt-5.4")
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
  })
})
