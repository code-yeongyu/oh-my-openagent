import { describe, expect, test } from "bun:test"
import { mergeUniqueStrings, mergeUniqueStringsCaseInsensitive } from "./config-merge"

describe("mergeUniqueStrings", () => {
  test("#given repeated strings #when merging #then first occurrence order is preserved", () => {
    // when
    const result = mergeUniqueStrings(["a", "b"], ["b", "c"])

    // then
    expect(result).toEqual(["a", "b", "c"])
  })
})

describe("mergeUniqueStringsCaseInsensitive", () => {
  test("#given repeated strings with different casing #when merging #then first casing wins", () => {
    // when
    const result = mergeUniqueStringsCaseInsensitive(["GitHub-Copilot"], ["github-copilot", "vercel"])

    // then
    expect(result).toEqual(["GitHub-Copilot", "vercel"])
  })
})
