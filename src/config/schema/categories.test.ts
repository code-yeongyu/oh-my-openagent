import { describe, expect, it } from "vitest"
import { CategoryConfigSchema } from "./categories"

describe("CategoryConfigSchema", () => {
  describe("model field", () => {
    it("accepts string array model", () => {
      const given = { model: ["haiku-4-5", "sonnet-4-5"] }
      const when = CategoryConfigSchema.parse(given)
      expect(when.model).toEqual(["haiku-4-5", "sonnet-4-5"])
    })

    it("accepts string model", () => {
      const given = { model: "haiku-4-5" }
      const when = CategoryConfigSchema.parse(given)
      expect(when.model).toBe("haiku-4-5")
    })

    it("rejects empty array", () => {
      const given = { model: [] }
      expect(() => CategoryConfigSchema.parse(given)).toThrow()
    })

    it("rejects invalid type in array", () => {
      const given = { model: [123] }
      expect(() => CategoryConfigSchema.parse(given)).toThrow()
    })

    it("accepts duplicate values in array", () => {
      const given = { model: ["a", "a", "b"] }
      const when = CategoryConfigSchema.parse(given)
      expect(when.model).toEqual(["a", "a", "b"])
    })
  })
})
