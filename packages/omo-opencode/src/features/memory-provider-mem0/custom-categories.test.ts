import { describe, expect, it } from "bun:test"
import {
  buildCustomCategories,
  SUPER_AGENT_CATEGORIES,
  suggestCategoryForMemoryType,
} from "./custom-categories"

describe("buildCustomCategories", () => {
  it("#given list of configs #when built #then returns name strings", () => {
    const result = buildCustomCategories([
      { name: "alpha" },
      { name: "beta", description: "desc" },
    ])
    expect(result).toEqual(["alpha", "beta"])
  })

  it("#given empty list #when built #then returns empty array", () => {
    expect(buildCustomCategories([])).toEqual([])
  })
})

describe("suggestCategoryForMemoryType", () => {
  it("#given exact match #when queried #then returns category", () => {
    const cats = ["decision", "bugfix", "feature"]
    expect(suggestCategoryForMemoryType("decision", cats)).toBe("decision")
  })

  it("#given partial match #when queried #then returns category containing type", () => {
    const cats = ["architectural-decision", "bugfix"]
    expect(suggestCategoryForMemoryType("decision", cats)).toBe("architectural-decision")
  })

  it("#given no match #when queried #then returns undefined", () => {
    const cats = ["alpha", "beta"]
    expect(suggestCategoryForMemoryType("unknown", cats)).toBeUndefined()
  })

  it("#given case mismatch #when queried #then still matches", () => {
    const cats = ["Decision"]
    expect(suggestCategoryForMemoryType("DECISION", cats)).toBe("Decision")
  })
})

describe("SUPER_AGENT_CATEGORIES", () => {
  it("#given preset #when inspected #then contains decision category", () => {
    const names = SUPER_AGENT_CATEGORIES.map((c) => c.name)
    expect(names).toContain("decision")
  })

  it("#given preset #when checked #then each entry has a name", () => {
    for (const cat of SUPER_AGENT_CATEGORIES) {
      expect(typeof cat.name).toBe("string")
      expect(cat.name.length).toBeGreaterThan(0)
    }
  })
})
