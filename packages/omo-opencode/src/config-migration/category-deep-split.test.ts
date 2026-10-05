import { describe, expect, test } from "bun:test"

import { CATEGORY_DEEP_SPLIT_MIGRATION_ID, transformCategoryDeepSplit } from "./category-deep-split"

describe("transformCategoryDeepSplit", () => {
  test("#given a config naming deep as a key and as a value #when transformed #then every reference is canonicalized and reported", () => {
    // given
    const document = {
      categories: { deep: { model: "openai/gpt-6-astra", reasoning: "high" } },
      "[senpi]": { memory: { reflection: { category: "deep" } } },
      teams: { r: { members: [{ name: "one", kind: "category", category: "deep", prompt: "go" }] } },
    }

    // when
    const result = transformCategoryDeepSplit(document)

    // then
    expect(result.document).toEqual({
      categories: { "deep-low": { model: "openai/gpt-6-astra", reasoning: "high" } },
      "[senpi]": { memory: { reflection: { category: "deep-low" } } },
      teams: { r: { members: [{ name: "one", kind: "category", category: "deep-low", prompt: "go" }] } },
    })
    expect(result.diagnostics).toEqual([
      "categories.deep renamed to deep-low",
      "[senpi].memory.reflection.category renamed to deep-low",
      "teams.r.members.0.category renamed to deep-low",
    ])
  })

  test("#given both deep and deep-low #when transformed #then the canonical entry survives and the drop is reported", () => {
    // given
    const document = { categories: { deep: { model: "legacy/model" }, "deep-low": { model: "canonical/model" } } }

    // when
    const result = transformCategoryDeepSplit(document)

    // then
    expect(result.document).toEqual({ categories: { "deep-low": { model: "canonical/model" } } })
    expect(result.diagnostics).toEqual(["categories.deep removed: deep-low is already configured"])
  })

  test("#given a config that never named deep #when transformed #then the document is unchanged with no diagnostics", () => {
    // given
    const document = { categories: { "deep-high": { model: "openai/gpt-6-astra" } }, task: { default_concurrency: 4 } }

    // when
    const result = transformCategoryDeepSplit(document)

    // then
    expect(result.document).toEqual(document)
    expect(result.diagnostics).toEqual([])
  })

  test("#given the migration id #then it stays the shipped stable value", () => {
    expect(CATEGORY_DEEP_SPLIT_MIGRATION_ID).toBe("2026-09-category-deep-split")
  })
})
