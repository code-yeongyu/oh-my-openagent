import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test"

const encodeMock = mock((value: unknown) => `toon:${JSON.stringify(value)}`)
const logMock = mock(() => {})

mock.module("@toon-format/toon", () => ({
  encode: encodeMock,
}))

mock.module("../logger", () => ({
  log: logMock,
}))

import { compressForLLM, isUniformArray, shouldCompress } from "./compressor"
import { resetGlobalCompressionConfig, setGlobalCompressionConfig } from "./config-store"
import { safeCompress } from "./fallback"

const enabledConfig = { enabled: true, threshold: 100 }
const disabledConfig = { enabled: false, threshold: 100 }

function createUniformRows(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    name: `item-${index}`,
    status: index % 2 === 0 ? "ok" : "warn",
  }))
}

describe("toon-compression/compressor", () => {
  beforeEach(() => {
    encodeMock.mockReset()
    encodeMock.mockImplementation((value: unknown) => `toon:${JSON.stringify(value)}`)
    logMock.mockReset()
    resetGlobalCompressionConfig()
  })

  describe("#given isUniformArray", () => {
    it("#then returns true for object arrays with matching keys", () => {
      expect(isUniformArray(createUniformRows())).toBe(true)
    })

    it("#then returns false for non-object values", () => {
      expect(isUniformArray([1, 2, 3])).toBe(false)
    })

    it("#then returns false for mismatched keys", () => {
      expect(isUniformArray([{ id: 1, name: "a" }, { id: 2, title: "b" }])).toBe(false)
    })

    it("#then returns false for single item arrays", () => {
      expect(isUniformArray([{ id: 1, name: "a" }])).toBe(false)
    })
  })

  describe("#given shouldCompress", () => {
    it("#then returns true for large uniform arrays above threshold", () => {
      const rows = createUniformRows(8)
      expect(shouldCompress(rows, 40)).toBe(true)
    })

    it("#then returns false for payloads below threshold", () => {
      expect(shouldCompress(createUniformRows(6), 10_000)).toBe(false)
    })

    it("#then returns false for non-uniform arrays", () => {
      const rows = [{ id: 1, name: "a" }, { id: 2, title: "b" }, { id: 3, name: "c" }, { id: 4, name: "d" }, { id: 5, name: "e" }]
      expect(shouldCompress(rows, 10)).toBe(false)
    })

    it("#then returns false for non-array objects", () => {
      const value = { sessions: createUniformRows(10) }
      expect(shouldCompress(value, 10)).toBe(false)
    })

    it("#then returns false for error-like messages", () => {
      expect(shouldCompress("Error: request failed at line 2", 10)).toBe(false)
    })

    it("#then returns false for binary-like strings", () => {
      const binaryLike = "a".repeat(256)
      expect(shouldCompress(binaryLike, 10)).toBe(false)
    })

    it("#then returns false for single-item arrays", () => {
      expect(shouldCompress([{ id: 1, name: "only" }], 10)).toBe(false)
    })
  })

  describe("#given compressForLLM", () => {
    it("#then returns non-compressed payload when disabled", () => {
      const rows = createUniformRows(8)
      const result = compressForLLM(rows, disabledConfig, "test-disabled")

      expect(result).toBe(JSON.stringify(rows))
      expect(encodeMock).not.toHaveBeenCalled()
    })

    it("#then returns non-compressed payload when shouldCompress is false", () => {
      const shortRows = createUniformRows(4)
      const result = compressForLLM(shortRows, enabledConfig, "test-short")

      expect(result).toBe(JSON.stringify(shortRows))
      expect(encodeMock).not.toHaveBeenCalled()
    })

    it("#then compresses large uniform arrays", () => {
      const rows = createUniformRows(8)
      const result = compressForLLM(rows, { enabled: true, threshold: 10 }, "test-compress")

      expect(result).toBe(`toon:${JSON.stringify(rows)}`)
      expect(encodeMock).toHaveBeenCalledTimes(1)
    })

    it("#then logs useCase in trigger message", () => {
      const rows = createUniformRows(8)
      compressForLLM(rows, { enabled: true, threshold: 10 }, "my-custom-use-case")

      expect(logMock).toHaveBeenCalled()
      const logCall = logMock.mock.calls.find((call) =>
        typeof call[0] === "string" && call[0].includes("[my-custom-use-case]")
      )
      expect(logCall).toBeDefined()
    })
  })

  describe("#given safeCompress", () => {
    it("#then falls back to JSON when encode throws", () => {
      setGlobalCompressionConfig({ enabled: true, threshold: 10 })
      const rows = createUniformRows(8)
      encodeMock.mockImplementation(() => {
        throw new Error("encoder failure")
      })

      const result = safeCompress(rows, "test-fallback")
      expect(result).toBe(JSON.stringify(rows))
    })

    it("#then falls back to JSON when compression exceeds timeout", () => {
      setGlobalCompressionConfig({ enabled: true, threshold: 10 })
      const rows = createUniformRows(8)
      const nowSpy = spyOn(Date, "now")

      nowSpy.mockReturnValueOnce(100)
      nowSpy.mockReturnValueOnce(170)

      const result = safeCompress(rows, "test-timeout")
      expect(result).toBe(JSON.stringify(rows))

      nowSpy.mockRestore()
    })

    it("#then keeps plain error text uncompressed", () => {
      setGlobalCompressionConfig(enabledConfig)
      const message = "Error: unable to parse response"
      const result = safeCompress(message, "test-error-text")

      expect(result).toBe(message)
      expect(encodeMock).not.toHaveBeenCalled()
    })
  })
})
