import { describe, expect, test } from "bun:test"

import { canonicalCategoryName, canonicalizeLegacyCategoryNames, hasLegacyCategoryNames } from "./legacy-category-names"

describe("canonicalCategoryName", () => {
  test("#given the retired deep key #when canonicalized #then it becomes deep-low", () => {
    expect(canonicalCategoryName("deep")).toBe("deep-low")
  })

  test("#given a live category name #when canonicalized #then it is returned unchanged", () => {
    for (const name of ["deep-low", "deep-high", "quick", "ultrabrain", "my-custom-lane"]) {
      expect(canonicalCategoryName(name)).toBe(name)
    }
  })
})

describe("canonicalizeLegacyCategoryNames", () => {
  test("#given deep in every layer a category key can appear #when canonicalized #then each one is renamed and reported", () => {
    // given
    const document = {
      categories: { deep: { model: "a/b" }, quick: { model: "c/d" } },
      "[senpi]": { categories: { deep: { reasoning: "high" } } },
      "[opencode]": { categories: { deep: { model: "e/f" } } },
      "[codex]": { categories: { deep: { model: "g/h" } } },
      profiles: {
        kimi: {
          categories: { deep: { model: "i/j" } },
          "[senpi]": { categories: { deep: { model: "k/l" } } },
        },
      },
    }

    // when
    const result = canonicalizeLegacyCategoryNames(document)

    // then
    expect(result.document).toEqual({
      categories: { "deep-low": { model: "a/b" }, quick: { model: "c/d" } },
      "[senpi]": { categories: { "deep-low": { reasoning: "high" } } },
      "[opencode]": { categories: { "deep-low": { model: "e/f" } } },
      "[codex]": { categories: { "deep-low": { model: "g/h" } } },
      profiles: {
        kimi: {
          categories: { "deep-low": { model: "i/j" } },
          "[senpi]": { categories: { "deep-low": { model: "k/l" } } },
        },
      },
    })
    expect(result.renames.map(({ path }) => path)).toEqual([
      "categories.deep",
      "[senpi].categories.deep",
      "[opencode].categories.deep",
      "[codex].categories.deep",
      "profiles.kimi.categories.deep",
      "profiles.kimi.[senpi].categories.deep",
    ])
  })

  test("#given deep as a category VALUE on a team member or a memory reflection #when canonicalized #then the value is renamed too", () => {
    // given
    const document = {
      teams: {
        reviewers: {
          leadAgentId: "lead",
          members: [
            { name: "one", kind: "category", category: "deep", prompt: "go" },
            { name: "two", kind: "category", category: "quick", prompt: "go" },
          ],
        },
      },
      "[senpi]": { memory: { reflection: { category: "deep" } } },
    }

    // when
    const result = canonicalizeLegacyCategoryNames(document)

    // then
    expect(result.document).toEqual({
      teams: {
        reviewers: {
          leadAgentId: "lead",
          members: [
            { name: "one", kind: "category", category: "deep-low", prompt: "go" },
            { name: "two", kind: "category", category: "quick", prompt: "go" },
          ],
        },
      },
      "[senpi]": { memory: { reflection: { category: "deep-low" } } },
    })
    expect(result.renames.map(({ path }) => path)).toEqual([
      "teams.reviewers.members.0.category",
      "[senpi].memory.reflection.category",
    ])
  })

  test("#given both deep and deep-low configured #when canonicalized #then the canonical entry wins and the legacy one is reported as dropped", () => {
    // given
    const document = { categories: { deep: { model: "legacy/model" }, "deep-low": { model: "canonical/model" } } }

    // when
    const result = canonicalizeLegacyCategoryNames(document)

    // then
    expect(result.document).toEqual({ categories: { "deep-low": { model: "canonical/model" } } })
    expect(result.renames).toEqual([{ canonical: "deep-low", dropped: true, legacy: "deep", path: "categories.deep" }])
  })

  test("#given a config that never names a retired category #when canonicalized #then the document is unchanged and nothing is reported", () => {
    // given
    const document = {
      categories: { "deep-low": { model: "a/b" }, "deep-high": { model: "c/d" } },
      teams: { r: { members: [{ name: "one", kind: "category", category: "deep-high", prompt: "go" }] } },
    }

    // when
    const result = canonicalizeLegacyCategoryNames(document)

    // then
    expect(result.document).toEqual(document)
    expect(result.renames).toEqual([])
    expect(hasLegacyCategoryNames(document)).toBe(false)
  })

  test("#given a prompt_append that merely mentions the word deep #when canonicalized #then free text is never rewritten", () => {
    // given
    const document = { categories: { "deep-low": { prompt_append: "route deep work here; deep means deep" } } }

    // when
    const result = canonicalizeLegacyCategoryNames(document)

    // then
    expect(result.document).toEqual(document)
    expect(result.renames).toEqual([])
  })
})
