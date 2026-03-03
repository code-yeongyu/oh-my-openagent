import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test"

const encodeMock = mock((value: unknown) => `toon:${JSON.stringify(value)}`)

mock.module("@toon-format/toon", () => ({
  encode: encodeMock,
}))

import { isUniformArray, shouldCompress } from "./compressor"
import { safeCompress } from "./fallback"

const enabledConfig = { enabled: true, threshold: 100 }

describe("toon-compression/edge-cases", () => {
  beforeEach(() => {
    encodeMock.mockReset()
    encodeMock.mockImplementation((value: unknown) => `toon:${JSON.stringify(value)}`)
  })

  describe("#given empty array", () => {
    it("#then shouldCompress returns false", () => {
      expect(shouldCompress([], 10)).toBe(false)
    })

    it("#then isUniformArray returns false", () => {
      expect(isUniformArray([])).toBe(false)
    })

    it("#then safeCompress returns empty array JSON", () => {
      const result = safeCompress([], enabledConfig, "test-edge-cases")
      expect(result).toBe("[]")
      expect(encodeMock).not.toHaveBeenCalled()
    })
  })

  describe("#given single-item array", () => {
    it("#then shouldCompress returns false", () => {
      expect(shouldCompress([{ id: 1, name: "only" }], 10)).toBe(false)
    })

    it("#then isUniformArray returns false", () => {
      expect(isUniformArray([{ id: 1, name: "only" }])).toBe(false)
    })

    it("#then safeCompress returns JSON without compression", () => {
      const single = [{ id: 1, name: "only" }]
      const result = safeCompress(single, enabledConfig, "test-edge-cases")
      expect(result).toBe(JSON.stringify(single))
      expect(encodeMock).not.toHaveBeenCalled()
    })
  })

  describe("#given array with null/undefined mixed", () => {
    it("#then isUniformArray returns false when null present", () => {
      const mixed = [{ id: 1 }, null, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
      expect(isUniformArray(mixed)).toBe(false)
    })

    it("#then isUniformArray returns false when undefined present", () => {
      const mixed = [{ id: 1 }, undefined, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
      expect(isUniformArray(mixed)).toBe(false)
    })

    it("#then shouldCompress returns false for array with null", () => {
      const mixed = [{ id: 1 }, null, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
      expect(shouldCompress(mixed, 10)).toBe(false)
    })

    it("#then safeCompress falls back to JSON for array with null", () => {
      const mixed = [{ id: 1 }, null, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
      const result = safeCompress(mixed, enabledConfig, "test-edge-cases")
      expect(result).toBe(JSON.stringify(mixed))
    })
  })

  describe("#given mixed-type array", () => {
    it("#then isUniformArray returns false for object/string/number mix", () => {
      const mixed = [{ a: 1 }, "string", 42, { a: 2 }, { a: 3 }, { a: 4 }]
      expect(isUniformArray(mixed)).toBe(false)
    })

    it("#then shouldCompress returns false for mixed types", () => {
      const mixed = [{ a: 1 }, "string", 42, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }]
      expect(shouldCompress(mixed, 10)).toBe(false)
    })

    it("#then safeCompress returns JSON without compression", () => {
      const mixed = [{ a: 1 }, "string", 42, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }]
      const result = safeCompress(mixed, enabledConfig, "test-edge-cases")
      expect(result).toBe(JSON.stringify(mixed))
      expect(encodeMock).not.toHaveBeenCalled()
    })
  })

  describe("#given circular reference", () => {
    it("#then safeCompress falls back to String() representation", () => {
      const circular: { self?: unknown } = {}
      circular.self = circular

      const result = safeCompress(circular, enabledConfig, "test-edge-cases")
      expect(result).toBe("[object Object]")
      expect(encodeMock).not.toHaveBeenCalled()
    })

    it("#then safeCompress handles circular in array gracefully", () => {
      const item: { id: number; ref?: unknown } = { id: 1 }
      item.ref = item

      const items = [item, { id: 2, ref: null }, { id: 3, ref: null }, { id: 4, ref: null }, { id: 5, ref: null }]
      const result = safeCompress(items, enabledConfig, "test-edge-cases")

      // JSON.stringify throws on circular, so fallback to String()
      expect(result).toBe(String(items))
    })
  })

  describe("#given very large payload", () => {
    it("#then shouldCompress returns true for large uniform array", () => {
      const large = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        data: "x".repeat(100),
      }))

      expect(shouldCompress(large, 100)).toBe(true)
    })

    it("#then safeCompress compresses large uniform array", () => {
      const large = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        value: i * 2,
      }))

      const result = safeCompress(large, { enabled: true, threshold: 10 }, "test-edge-cases")
      expect(result).toContain("toon:")
      expect(encodeMock).toHaveBeenCalledTimes(1)
    })

    it("#then timeout triggers fallback when compression too slow", () => {
      const large = Array.from({ length: 100 }, (_, i) => ({ id: i, value: i }))

      // Make Date.now return values that exceed timeout (50ms)
      const nowSpy = spyOn(Date, "now")
      nowSpy.mockReturnValueOnce(100) // start
      nowSpy.mockReturnValueOnce(200) // end - 100ms > 50ms timeout

      const result = safeCompress(large, { enabled: true, threshold: 10 }, "test-edge-cases")
      expect(result).toBe(JSON.stringify(large))

      nowSpy.mockRestore()
    })
  })

  describe("#given unicode/emoji in values", () => {
    it("#then shouldCompress returns true for uniform array with unicode", () => {
      const items = [
        { id: 1, name: "日本語テスト" },
        { id: 2, name: "中文测试" },
        { id: 3, name: "한국어" },
        { id: 4, name: "العربية" },
        { id: 5, name: "עברית" },
        { id: 6, name: "日本語" },
      ]

      expect(shouldCompress(items, 10)).toBe(true)
    })

    it("#then shouldCompress returns true for uniform array with emoji", () => {
      const items = [
        { id: 1, emoji: "🎉🎊🎁" },
        { id: 2, emoji: "🚀💻🔥" },
        { id: 3, emoji: "👍👏🙌" },
        { id: 4, emoji: "❤️💔💕" },
        { id: 5, emoji: "🌟⭐✨" },
        { id: 6, emoji: "🎮🎲🎯" },
      ]

      expect(shouldCompress(items, 10)).toBe(true)
    })

    it("#then safeCompress preserves unicode in output", () => {
      const items = [
        { id: 1, label: "日本語" },
        { id: 2, label: "中文" },
        { id: 3, label: "한국어" },
        { id: 4, label: "العربية" },
        { id: 5, label: "עברית" },
        { id: 6, label: "русский" },
      ]

      const result = safeCompress(items, { enabled: true, threshold: 10 }, "test-edge-cases")
      expect(result).toContain("日本語")
      expect(result).toContain("中文")
      expect(result).toContain("한국어")
    })

    it("#then safeCompress preserves emoji in output", () => {
      const items = [
        { id: 1, icon: "🎉" },
        { id: 2, icon: "🚀" },
        { id: 3, icon: "💻" },
        { id: 4, icon: "🔥" },
        { id: 5, icon: "👍" },
        { id: 6, icon: "❤️" },
      ]

      const result = safeCompress(items, { enabled: true, threshold: 10 }, "test-edge-cases")
      expect(result).toContain("🎉")
      expect(result).toContain("🚀")
    })
  })

  describe("#given sparse array", () => {
    it("#then isUniformArray returns false for sparse array", () => {
      const sparse: Array<{ id: number }> = []
      sparse[0] = { id: 1 }
      sparse[5] = { id: 2 }
      sparse[10] = { id: 3 }
      // sparse.length = 11, but only 3 elements exist

      expect(isUniformArray(sparse)).toBe(false)
    })

    it("#then shouldCompress returns false for sparse array", () => {
      const sparse: Array<{ id: number }> = []
      sparse[0] = { id: 1 }
      sparse[1] = { id: 2 }
      sparse[2] = { id: 3 }
      sparse[10] = { id: 4 }
      sparse[11] = { id: 5 }
      sparse[12] = { id: 6 }
      // sparse.length = 13, but has holes

      expect(shouldCompress(sparse, 10)).toBe(false)
    })

    it("#then safeCompress handles sparse array with JSON fallback", () => {
      const sparse: Array<{ id: number } | undefined> = []
      sparse[0] = { id: 1 }
      sparse[5] = { id: 2 }
      sparse[10] = { id: 3 }

      const result = safeCompress(sparse, enabledConfig, "test-edge-cases")
      // JSON.stringify converts sparse to array with nulls
      expect(result).toContain("null")
    })
  })

  describe("#given unstringifiable objects", () => {
    it("#then safeCompress returns [unserializable] for circular Object.create(null)", () => {
      // Object.create(null) has no toString, and circular ref makes JSON.stringify throw
      const nullProto: { self?: unknown } = Object.create(null)
      nullProto.self = nullProto

      const result = safeCompress(nullProto, enabledConfig, "test-edge-cases")
      expect(result).toBe("[unserializable]")
    })

    it("#then safeCompress returns [unserializable] for circular object with throwing toString", () => {
      // Circular ref makes JSON.stringify throw, throwing toString makes String() throw
      const throwing: { self?: unknown; toString(): string } = {
        toString() {
          throw new Error("Cannot stringify")
        },
      }
      throwing.self = throwing

      const result = safeCompress(throwing, enabledConfig, "test-edge-cases")
      expect(result).toBe("[unserializable]")
    })
  })
})
