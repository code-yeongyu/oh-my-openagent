const { describe, test, expect } = require("bun:test")

import { resolveMetadataModel } from "./resolve-metadata-model"

const PRIMARY = { providerID: "openai", modelID: "gpt-5.4" }
const FALLBACK = { providerID: "anthropic", modelID: "claude-sonnet-4-6" }

describe("resolveMetadataModel", () => {
  describe("#given primary and fallback are both present", () => {
    test("#when resolving #then returns primary", () => {
      const result = resolveMetadataModel(PRIMARY, FALLBACK)

      expect(result).toEqual(PRIMARY)
    })
  })

  describe("#given only fallback is present", () => {
    test("#when resolving #then returns fallback", () => {
      const result = resolveMetadataModel(undefined, FALLBACK)

      expect(result).toEqual(FALLBACK)
    })
  })

  describe("#given only primary is present", () => {
    test("#when resolving #then returns primary", () => {
      const result = resolveMetadataModel(PRIMARY, undefined)

      expect(result).toEqual(PRIMARY)
    })
  })

  describe("#given both are undefined", () => {
    test("#when resolving #then returns undefined", () => {
      const result = resolveMetadataModel(undefined, undefined)

      expect(result).toBeUndefined()
    })
  })

  describe("#given primary has extra fields", () => {
    test("#when resolving #then preserves variant and strips unrelated fields", () => {
      const extended = { providerID: "openai", modelID: "gpt-5.4", variant: "high", temperature: 0.7 } as const

      const result = resolveMetadataModel(extended, undefined)

      expect(result).toEqual({ providerID: "openai", modelID: "gpt-5.4", variant: "high" })
    })
  })

  describe("#given primary has variant", () => {
    test("#when resolving metadata model #then variant is preserved", () => {
      const primary = { providerID: "google", modelID: "gemini-3.1-pro", variant: "high" }

      const result = resolveMetadataModel(primary, undefined)

      expect(result).toEqual({ providerID: "google", modelID: "gemini-3.1-pro", variant: "high" })
    })
  })

  describe("#given primary lacks variant but fallback has variant", () => {
    test("#when primary provided #then fallback variant is not used", () => {
      const primary = { providerID: "google", modelID: "gemini-3.1-pro" }
      const fallback = { providerID: "anthropic", modelID: "claude", variant: "max" }

      const result = resolveMetadataModel(primary, fallback)

      expect(result).toEqual({ providerID: "google", modelID: "gemini-3.1-pro" })
      expect(result?.variant).toBeUndefined()
    })
  })

  describe("#given primary is undefined and fallback has variant", () => {
    test("#when resolving metadata model #then fallback variant is preserved", () => {
      const fallback = { providerID: "anthropic", modelID: "claude", variant: "max" }

      const result = resolveMetadataModel(undefined, fallback)

      expect(result).toEqual({ providerID: "anthropic", modelID: "claude", variant: "max" })
    })
  })

  describe("#given both lack variant", () => {
    test("#when resolving metadata model #then variant is not on result", () => {
      const primary = { providerID: "openai", modelID: "gpt-5.4" }

      const result = resolveMetadataModel(primary, undefined)

      expect(result).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
      expect(result?.variant).toBeUndefined()
    })
  })
})
