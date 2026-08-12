import { describe, it, expect } from "bun:test"

describe("person slug (IC-14)", () => {
  const limits = { maxEntries: 40, maxEntryChars: 200 }

  describe("#given a display name for slug derivation", () => {
    it("#then sanitizePersonSlug reuses sanitizeToSlug rules", async () => {
      const { sanitizePersonSlug } = await import("./format")

      expect(sanitizePersonSlug("Yeongyu Park")).toBe("yeongyu-park")
      expect(sanitizePersonSlug("  spaced  ")).toBe("spaced")
      expect(sanitizePersonSlug("Hello!@#World")).toBe("hello-world")
      expect(sanitizePersonSlug("a".repeat(50))).toHaveLength(40)
    })
  })

  describe("#given the reserved slug 'human'", () => {
    it("#then isReservedSlug returns true for 'human'", async () => {
      const { isReservedSlug } = await import("./format")

      expect(isReservedSlug("human")).toBe(true)
      expect(isReservedSlug("yeongyu")).toBe(false)
    })
  })

  describe("#given a slug collision needing a numeric suffix", () => {
    it("#then resolveSlugCollision appends -2, -3, etc.", async () => {
      const { resolveSlugCollision } = await import("./format")

      const existing = new Set(["yeongyu", "yeongyu-2"])
      expect(resolveSlugCollision("yeongyu", existing)).toBe("yeongyu-3")

      const single = new Set(["yeongyu"])
      expect(resolveSlugCollision("yeongyu", single)).toBe("yeongyu-2")

      const partial = new Set(["yeongyu-2", "yeongyu-3"])
      expect(resolveSlugCollision("yeongyu", partial)).toBe("yeongyu")

      const empty = new Set<string>()
      expect(resolveSlugCollision("yeongyu", empty)).toBe("yeongyu")
    })
  })
})
