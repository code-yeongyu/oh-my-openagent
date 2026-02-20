import { describe, expect, test } from "bun:test"
import { parseModelString } from "./model-string-parser"

describe("parseModelString", () => {
  describe("valid model strings", () => {
    //#given provider/model strings with one separator
    //#when parsing model strings
    //#then it returns providerID and modelID parts

    test("parses anthropic model", () => {
      expect(parseModelString("anthropic/claude-opus-4-6")).toEqual({
        providerID: "anthropic",
        modelID: "claude-opus-4-6",
      })
    })

    test("parses openai model", () => {
      expect(parseModelString("openai/gpt-5.3-codex")).toEqual({
        providerID: "openai",
        modelID: "gpt-5.3-codex",
      })
    })

    test("parses google model", () => {
      expect(parseModelString("google/gemini-3-flash")).toEqual({
        providerID: "google",
        modelID: "gemini-3-flash",
      })
    })

    test("parses xai model", () => {
      expect(parseModelString("xai/grok-code-fast-1")).toEqual({
        providerID: "xai",
        modelID: "grok-code-fast-1",
      })
    })
  })

  describe("edge cases", () => {
    //#given a model string with extra slashes
    //#when parsing with first slash as separator
    //#then provider is before first slash and model keeps remaining path

    test("keeps extra slashes in model segment", () => {
      expect(parseModelString("provider/model/with/extra/slashes")).toEqual({
        providerID: "provider",
        modelID: "model/with/extra/slashes",
      })
    })
  })

  describe("invalid model strings", () => {
    //#given malformed or empty model strings
    //#when parsing model strings
    //#then it returns undefined

    test("returns undefined for empty string", () => {
      expect(parseModelString("")).toBeUndefined()
    })

    test("returns undefined for model without slash", () => {
      expect(parseModelString("no-slash-model")).toBeUndefined()
    })

    test("returns undefined for empty provider", () => {
      expect(parseModelString("/missing-provider")).toBeUndefined()
    })

    test("returns undefined for empty model", () => {
      expect(parseModelString("missing-model/")).toBeUndefined()
    })
  })

  describe("whitespace handling", () => {
    //#given model strings with whitespace
    //#when parsing
    //#then it rejects whitespace-only parts and trims valid parts

    test("returns undefined for whitespace-only string", () => {
      expect(parseModelString("   ")).toBeUndefined()
    })

    test("returns undefined for whitespace-only provider", () => {
      expect(parseModelString("  /model")).toBeUndefined()
    })

    test("returns undefined for whitespace-only model", () => {
      expect(parseModelString("provider/  ")).toBeUndefined()
    })

    test("trims whitespace from provider and model", () => {
      expect(parseModelString(" openai / gpt-5.3-codex ")).toEqual({
        providerID: "openai",
        modelID: "gpt-5.3-codex",
      })
    })
  })
})
