import { describe, expect, test } from "bun:test"

import { wildcardNicknameSet } from "./nickname-model-patterns"

describe("wildcardNicknameSet", () => {
  test("#given matching wildcard languages where one strictly contains another #when selecting #then the narrower language wins", () => {
    expect(wildcardNicknameSet({ "vendor/*": "broad", "vendor/model*": "narrow" }, "vendor/model-v2")).toBe(
      "narrow",
    )
  })

  test("#given incomparable rules whose configured model matches form strict subsets #when selecting #then the rule covering fewer configured IDs wins", () => {
    expect(
      wildcardNicknameSet(
        { "a*/model-*": "provider", "a-*/m*": "model" },
        "a-x/model-v2",
        { configuredModelIds: new Set(["a-x/model-v2", "ax/model-v3"]) },
      ),
    ).toBe("model")
  })

  test("#given incomparable rules with equal configured matches #when selecting #then the rule with more literal characters wins", () => {
    expect(
      wildcardNicknameSet(
        { "vendor/*alpha": "suffix", "vendor/model-*": "prefix" },
        "vendor/model-alpha",
        { configuredModelIds: new Set(["vendor/model-alpha"]) },
      ),
    ).toBe("prefix")
  })

  test("#given tied rules for one pool #when selecting #then the pool is returned without a conflict", () => {
    const conflicts: unknown[] = []

    const selected = wildcardNicknameSet(
      { "vendor/*-alpha": "shared", "vendor/model-*": "shared" },
      "vendor/model-alpha",
      { configuredModelIds: new Set(["vendor/model-alpha"]), onConflict: (conflict) => conflicts.push(conflict) },
    )

    expect(selected).toBe("shared")
    expect(conflicts).toEqual([])
  })

  test("#given tied pools and an applicable agent mapping to an unrelated pool #when selecting #then the mapping wins without warning", () => {
    const conflicts: unknown[] = []

    const selected = wildcardNicknameSet(
      { "vendor/*-alpha": "suffix", "vendor/model-*": "prefix" },
      "vendor/model-alpha",
      {
        configuredModelIds: new Set(["vendor/model-alpha"]),
        preferredSet: "unrelated",
        defaultSet: "suffix",
        onConflict: (conflict) => conflicts.push(conflict),
      },
    )

    expect(selected).toBe("unrelated")
    expect(conflicts).toEqual([])
  })

  test("#given tied pools with no mapping #when selecting #then the default pool wins only when tied", () => {
    expect(
      wildcardNicknameSet(
        { "vendor/*-alpha": "suffix", "vendor/model-*": "prefix" },
        "vendor/model-alpha",
        { configuredModelIds: new Set(["vendor/model-alpha"]), defaultSet: "prefix" },
      ),
    ).toBe("prefix")
  })

  test("#given unresolved tied pools #when selecting #then the alphabetical rule wins and reports the conflict", () => {
    const conflicts: unknown[] = []

    const selected = wildcardNicknameSet(
      { "vendor/*-alpha": "suffix", "vendor/model-*": "prefix" },
      "vendor/model-alpha",
      {
        configuredModelIds: new Set(["vendor/model-alpha"]),
        defaultSet: "unrelated",
        onConflict: (conflict) => conflicts.push(conflict),
      },
    )

    expect(selected).toBe("suffix")
    expect(conflicts).toEqual([
      {
        modelId: "vendor/model-alpha",
        rules: [
          { key: "vendor/*-alpha", set: "suffix" },
          { key: "vendor/model-*", set: "prefix" },
        ],
        chosenKey: "vendor/*-alpha",
        chosenSet: "suffix",
      },
    ])
  })

  test("#given a model-only selector with different case #when matching #then provider-agnostic case-insensitive semantics remain", () => {
    expect(wildcardNicknameSet({ "GPT-*": "fast" }, "vendor/gpt-6")).toBe("fast")
  })

  test("#given a provider-scoped selector #when another provider has the same model ID #then it does not match the other provider", () => {
    expect(
      wildcardNicknameSet({ "vendor/GPT-*": "vendor", "other/GPT-*": "other" }, "vendor/gpt-6"),
    ).toBe("vendor")
  })
})
