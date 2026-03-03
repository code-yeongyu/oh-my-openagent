import { beforeEach, describe, expect, it } from "bun:test"

import {
  DEFAULT_COMPRESSION_CONFIG,
  getGlobalCompressionConfig,
  setGlobalCompressionConfig,
} from "./config-store"

describe("toon-compression/config-store", () => {
  beforeEach(() => {})

  describe("#given DEFAULT_COMPRESSION_CONFIG", () => {
    it("#then has correct default values", () => {
      expect(DEFAULT_COMPRESSION_CONFIG.enabled).toBe(false)
      expect(DEFAULT_COMPRESSION_CONFIG.threshold).toBe(5000)
    })
  })

  describe("#given getGlobalCompressionConfig", () => {
    it("#then returns default config when not initialized", () => {
      const config = getGlobalCompressionConfig()
      expect(config).toEqual(DEFAULT_COMPRESSION_CONFIG)
    })

    it("#then returns set config after initialization", () => {
      const customConfig = { enabled: true, threshold: 1000 }
      setGlobalCompressionConfig(customConfig)

      const config = getGlobalCompressionConfig()
      expect(config).toEqual(customConfig)
    })

    it("#then returns updated config after re-initialization", () => {
      const firstConfig = { enabled: true, threshold: 2000 }
      setGlobalCompressionConfig(firstConfig)
      expect(getGlobalCompressionConfig()).toEqual(firstConfig)

      const secondConfig = { enabled: false, threshold: 8000, maxEncodingSize: 50000 }
      setGlobalCompressionConfig(secondConfig)
      expect(getGlobalCompressionConfig()).toEqual(secondConfig)
    })
  })
})
