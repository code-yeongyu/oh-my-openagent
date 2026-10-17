import { describe, expect, test } from "bun:test"

import { canonicalHarnessName, canonicalizeLegacyHarnessBlocks, hasLegacyHarnessBlocks } from "./legacy-harness-names"

describe("canonicalHarnessName", () => {
  test("#given the retired senpi harness id #when canonicalized #then it becomes native", () => {
    expect(canonicalHarnessName("senpi")).toBe("native")
  })

  test("#given a live harness id #when canonicalized #then it is returned unchanged", () => {
    for (const id of ["native", "opencode", "codex", "omo"]) {
      expect(canonicalHarnessName(id)).toBe(id)
    }
  })
})

describe("canonicalizeLegacyHarnessBlocks", () => {
  test("#given a [senpi] block at the root and inside a profile #when canonicalized #then both are renamed and reported", () => {
    // given
    const document = {
      categories: { quick: { model: "a/b" } },
      "[senpi]": { categories: { quick: { reasoning: "high" } } },
      "[opencode]": { categories: { quick: { model: "e/f" } } },
      profiles: {
        kimi: {
          "[senpi]": { model_profile: "kimi" },
        },
      },
    }

    // when
    const result = canonicalizeLegacyHarnessBlocks(document)

    // then
    expect(result.document).toEqual({
      categories: { quick: { model: "a/b" } },
      "[native]": { categories: { quick: { reasoning: "high" } } },
      "[opencode]": { categories: { quick: { model: "e/f" } } },
      profiles: {
        kimi: {
          "[native]": { model_profile: "kimi" },
        },
      },
    })
    expect(result.renames).toEqual([
      { canonical: "[native]", dropped: false, legacy: "[senpi]", path: "[senpi]" },
      { canonical: "[native]", dropped: false, legacy: "[senpi]", path: "profiles.kimi.[senpi]" },
    ])
  })

  test("#given both [native] and [senpi] at the same level #when canonicalized #then native wins and the legacy block is reported as dropped", () => {
    // given
    const document = {
      "[native]": { model_profile: "canonical" },
      "[senpi]": { model_profile: "legacy" },
    }

    // when
    const result = canonicalizeLegacyHarnessBlocks(document)

    // then
    expect(result.document).toEqual({ "[native]": { model_profile: "canonical" } })
    expect(result.renames).toEqual([{ canonical: "[native]", dropped: true, legacy: "[senpi]", path: "[senpi]" }])
  })

  test("#given a document that never names the legacy harness #when canonicalized #then it is returned unchanged with nothing reported", () => {
    // given
    const document = {
      categories: { quick: { model: "a/b" } },
      "[native]": { model_profile: "kimi" },
      profiles: { kimi: { "[codex]": { model_profile: "kimi" } } },
    }

    // when
    const result = canonicalizeLegacyHarnessBlocks(document)

    // then
    expect(result.document).toEqual(document)
    expect(result.renames).toEqual([])
    expect(hasLegacyHarnessBlocks(document)).toBe(false)
  })

  test("#given a config carrying the legacy harness block #when asked #then it reports the legacy spelling", () => {
    expect(hasLegacyHarnessBlocks({ "[senpi]": { model_profile: "kimi" } })).toBe(true)
    expect(hasLegacyHarnessBlocks({ profiles: { kimi: { "[senpi]": { model_profile: "kimi" } } } })).toBe(true)
  })
})
