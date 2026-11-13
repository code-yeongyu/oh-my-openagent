import { describe, expect, test } from "bun:test"

import { categoryShadowedAgentNames } from "./category-shadow"

describe("categoryShadowedAgentNames", () => {
  test("#given a chain set under a retired alias key #when a category uses the canonical name #then it is still reported", () => {
    // given: omo.json agents are mapped by their key as written, so a chain under the old reviewer
    // name never reaches the canonical agent, which still runs its default chain.
    const config = {
      categories: { "omo-native-code-reviewer": { model: "a/b" } },
      agents: { "omo-senpi-code-reviewer": { model: "x/y" } },
    }

    // when
    const names = categoryShadowedAgentNames(config)

    // then
    expect(names).toEqual(["omo-native-code-reviewer"])
  })

  test("#given the canonical agent sets its own model #when a category uses its name #then it is not reported", () => {
    // given
    const config = {
      categories: { "omo-native-code-reviewer": { model: "a/b" } },
      agents: { "omo-native-code-reviewer": { model: "x/y" } },
    }

    // when
    const names = categoryShadowedAgentNames(config)

    // then
    expect(names).toEqual([])
  })
})
