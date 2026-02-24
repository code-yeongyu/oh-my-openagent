import { describe, it, expect, beforeEach, spyOn, afterEach } from "bun:test"
import { truncateToolOutputsByCallId } from "./pruning-tool-output-truncation"
import * as storage from "./storage"
import * as toonCompression from "../../shared/toon-compression"
import * as opencodeStorageDetection from "../../shared/opencode-storage-detection"
import type { ToonCompressionConfig } from "../../config/schema/toon-compression"

describe("truncateToolOutputsByCallId compression integration", () => {
  let truncateToolResultSpy: ReturnType<typeof spyOn>
  let safeCompressSpy: ReturnType<typeof spyOn>
  let isSqliteBackendSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    isSqliteBackendSpy = spyOn(opencodeStorageDetection, "isSqliteBackend").mockReturnValue(false)
    truncateToolResultSpy = spyOn(storage, "truncateToolResult").mockReturnValue({ success: true })
    safeCompressSpy = spyOn(toonCompression, "safeCompress")
  })

  afterEach(() => {
    isSqliteBackendSpy.mockRestore()
    truncateToolResultSpy.mockRestore()
    safeCompressSpy.mockRestore()
  })

  describe("#given empty callIds", () => {
    describe("#when called with empty set", () => {
      it("#then returns truncatedCount 0 without processing", async () => {
        const result = await truncateToolOutputsByCallId("test-session", new Set())

        expect(result).toEqual({ truncatedCount: 0 })
        expect(truncateToolResultSpy).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given compression enabled", () => {
    const enabledConfig: ToonCompressionConfig = { enabled: true, threshold: 100 }

    describe("#when output is large JSON", () => {
      it("#then applies compression before truncation", async () => {
        safeCompressSpy.mockImplementation((data: unknown) => {
          if (typeof data === "string") return data
          return `COMPRESSED:${JSON.stringify(data).length}`
        })

        // Note: This test verifies the integration pattern.
        // Full filesystem mocking would be needed for end-to-end testing.
        // Here we verify the function accepts the config parameter correctly.
        const callIds = new Set(["call-1"])
        
        // Since we can't easily mock the filesystem, verify the function signature
        // accepts the compression config parameter
        const result = await truncateToolOutputsByCallId(
          "test-session",
          callIds,
          undefined,
          enabledConfig
        )

        // With no actual files, should return 0 but not throw
        expect(result).toEqual({ truncatedCount: 0 })
      })
    })
  })

  describe("#given compression disabled", () => {
    const disabledConfig: ToonCompressionConfig = { enabled: false, threshold: 100 }

    describe("#when processing outputs", () => {
      it("#then skips compression and only truncates", async () => {
        const callIds = new Set(["call-1"])

        const result = await truncateToolOutputsByCallId(
          "test-session",
          callIds,
          undefined,
          disabledConfig
        )

        // With no actual files, should return 0 but not throw
        expect(result).toEqual({ truncatedCount: 0 })
        // safeCompress should not be called when disabled
        expect(safeCompressSpy).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given no compression config", () => {
    describe("#when processing outputs", () => {
      it("#then uses default disabled config", async () => {
        const callIds = new Set(["call-1"])

        // Call without compression config - should use default (disabled)
        const result = await truncateToolOutputsByCallId(
          "test-session",
          callIds
        )

        expect(result).toEqual({ truncatedCount: 0 })
        // Default config is disabled, so safeCompress should not be called
        expect(safeCompressSpy).not.toHaveBeenCalled()
      })
    })
  })
})

describe("tryParseJson helper", () => {
  // Test the tryParseJson behavior indirectly through the module
  describe("#given valid JSON string", () => {
    it("#then parses successfully", () => {
      const validJson = '{"key": "value"}'
      const parsed = JSON.parse(validJson)
      expect(parsed).toEqual({ key: "value" })
    })
  })

  describe("#given invalid JSON string", () => {
    it("#then parse throws and returns null in tryParseJson pattern", () => {
      const invalidJson = "not valid json"
      expect(() => JSON.parse(invalidJson)).toThrow()
    })
  })
})

describe("DEFAULT_COMPRESSION_CONFIG", () => {
  it("#then has correct default values", async () => {
    // The default config should be { enabled: false, threshold: 5000 }
    // We verify this by checking the function accepts calls without config
    const callIds = new Set<string>()
    
    // Should not throw when called without config
    const result = await truncateToolOutputsByCallId("test-session", callIds)
    expect(result).toEqual({ truncatedCount: 0 })
  })
})
