import { describe, expect, test } from "bun:test"

import { categoryGateModels } from "../../category/builtins"
import { listTaskCategories } from "./categories"

function requiredAnnotation(name: string): string {
  const gateModels = categoryGateModels(name)
  if (gateModels === undefined) throw new Error(`builtin category ${name} is not model-gated`)
  return `(requires ${gateModels.join(" or ")})`
}

function entryFor(name: string, config: Parameters<typeof listTaskCategories>[0]) {
  return listTaskCategories(config).find((entry) => entry.name === name)
}

describe("gated category listing", () => {
  describe("#given a builtin-only gated category", () => {
    test("#when the categories are listed #then architect carries its required model annotation", () => {
      // given / when
      const entry = entryFor("architect", {})

      // then
      expect(entry?.description).toContain("(requires claude-fable-5-1)")
    })

    test("#when the categories are listed #then ultrabrain carries its required model annotation", () => {
      // given / when
      const entry = entryFor("ultrabrain", {})

      // then
      expect(entry?.description).toContain(requiredAnnotation("ultrabrain"))
    })

    test("#when the categories are listed #then each deep lane carries its own required model annotation", () => {
      // given / when
      const low = entryFor("deep-low", {})
      const high = entryFor("deep-high", {})

      // then
      expect(low?.description).toContain("(requires gpt-6-sol-fast or gpt-6-sol)")
      expect(low?.description).toContain(requiredAnnotation("deep-low"))
      expect(low?.description).not.toContain("gpt-5.6-sol")
      expect(high?.description).toContain("(requires gpt-6-astra)")
      expect(high?.description).toContain(requiredAnnotation("deep-high"))
    })
  })

  describe("#given a gated category configured in omo.json", () => {
    test("#when the categories are listed #then the annotation is dropped because the gate is bypassed", () => {
      // given / when
      const entry = entryFor("architect", { categories: { architect: { model: "kimi-coding/k3" } } })

      // then
      expect(entry?.description).not.toContain("requires")
    })

    test("#when omo.json only overrides the description #then the user text is listed verbatim", () => {
      // given / when
      const entry = entryFor("architect", { categories: { architect: { description: "House architect" } } })

      // then
      expect(entry?.description).toBe("House architect")
    })
  })

  describe("#given an ungated builtin category", () => {
    test("#when the categories are listed #then no annotation is added", () => {
      // given / when
      const entry = entryFor("quick", {})

      // then
      expect(entry?.description).toBeDefined()
      expect(entry?.description).not.toContain("requires")
    })
  })
})
