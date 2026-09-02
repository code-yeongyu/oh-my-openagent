import { describe, expect, test } from "bun:test"

import {
  OPENAI_ONLY_AGENT_RECOMMENDATIONS,
  OPENAI_ONLY_CATEGORY_RECOMMENDATIONS,
  OPENAI_ONLY_RECOMMENDED_MODEL_IDS,
} from "./openai-only-recommendations"

describe("OPENAI_ONLY_CATEGORY_RECOMMENDATIONS", () => {
  test("#given the maintained catalog #when read #then it matches the OpenCode installer policy", () => {
    // given / when
    const categories = OPENAI_ONLY_CATEGORY_RECOMMENDATIONS

    // then
    expect(categories.artistry).toEqual({ modelId: "gpt-5.6-sol", variant: "xhigh" })
    expect(categories.writing).toEqual({ modelId: "gpt-5.6-sol", variant: "medium" })
    expect(categories["visual-engineering"]).toEqual({ modelId: "gpt-5.6-sol", variant: "high" })
    expect(categories.quick).toEqual({ modelId: "gpt-5.6-luna-fast" })
    expect(Object.keys(categories).sort()).toEqual(["artistry", "quick", "visual-engineering", "writing"])
  })
})

describe("OPENAI_ONLY_AGENT_RECOMMENDATIONS", () => {
  test("#given the maintained catalog #when read #then curated research agents pin luna-fast low", () => {
    // given / when
    const agents = OPENAI_ONLY_AGENT_RECOMMENDATIONS

    // then
    expect(agents.explore).toEqual({ modelId: "gpt-5.6-luna-fast", variant: "low" })
    expect(agents.librarian).toEqual({ modelId: "gpt-5.6-luna-fast", variant: "low" })
    expect(Object.keys(agents).sort()).toEqual(["explore", "librarian"])
  })
})

describe("architect exclusion", () => {
  test("#given both catalogs #when inspected #then architect is absent so its required-model gate stays authoritative", () => {
    // given / when / then
    expect(Object.hasOwn(OPENAI_ONLY_CATEGORY_RECOMMENDATIONS, "architect")).toBe(false)
    expect(Object.hasOwn(OPENAI_ONLY_AGENT_RECOMMENDATIONS, "architect")).toBe(false)
  })
})

describe("OPENAI_ONLY_RECOMMENDED_MODEL_IDS", () => {
  test("#given both catalogs #when derived #then the known-id set is exactly the union of recommended ids", () => {
    // given / when
    const ids = OPENAI_ONLY_RECOMMENDED_MODEL_IDS

    // then
    expect([...ids].sort()).toEqual(["gpt-5.6-luna-fast", "gpt-5.6-sol"])
  })
})
