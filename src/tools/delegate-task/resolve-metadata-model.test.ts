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
    test("#when resolving #then strips to providerID and modelID only", () => {
      const extended = { providerID: "openai", modelID: "gpt-5.4", variant: "high", temperature: 0.7 } as const

      const result = resolveMetadataModel(extended, undefined)

      expect(result).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    })
  })
})
