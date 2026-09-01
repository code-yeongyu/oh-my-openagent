/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import {
  buildCategorySkillsDelegationGuide,
  buildNonClaudePlannerSection,
  buildParallelDelegationSection,
  buildUltraworkSection,
  type AvailableAgent,
  type AvailableCategory,
  type AvailableSkill,
} from "./dynamic-agent-prompt-builder"

describe("buildCategorySkillsDelegationGuide", () => {
  it("returns empty output only when both inputs are empty", () => {
    expect(buildCategorySkillsDelegationGuide([], [])).toBe("")
  })

  it("propagates category metadata and skill source branches", () => {
    const categories: AvailableCategory[] = [
      { name: "SENTINEL_CATEGORY_A", description: "SENTINEL_CATEGORY_DESCRIPTION_A" },
      { name: "SENTINEL_CATEGORY_B", description: "SENTINEL_CATEGORY_DESCRIPTION_B" },
    ]
    const skills: AvailableSkill[] = [
      { name: "SENTINEL_PLUGIN_SKILL", description: "unused", location: "plugin" },
      { name: "SENTINEL_USER_SKILL", description: "unused", location: "user" },
      { name: "SENTINEL_PROJECT_SKILL", description: "unused", location: "project" },
    ]

    const result = buildCategorySkillsDelegationGuide(categories, skills)

    for (const category of categories) {
      expect(result).toContain(category.name)
      expect(result).toContain(category.description)
    }
    expect(result).toContain("SENTINEL_PLUGIN_SKILL")
    expect(result).toContain("SENTINEL_USER_SKILL (user)")
    expect(result).toContain("SENTINEL_PROJECT_SKILL (project)")
  })
})

describe("buildUltraworkSection", () => {
  it("propagates category, skill, and agent inputs through their rendering branches", () => {
    const categories: AvailableCategory[] = [
      { name: "SENTINEL_CATEGORY", description: "SENTINEL_CATEGORY_DESCRIPTION" },
    ]
    const skills: AvailableSkill[] = [
      { name: "SENTINEL_PLUGIN_SKILL", description: "SENTINEL_PLUGIN_DESCRIPTION", location: "plugin" },
      { name: "SENTINEL_USER_SKILL", description: "SENTINEL_USER_DESCRIPTION", location: "user" },
    ]
    const agents: AvailableAgent[] = [
      {
        name: "SENTINEL_AGENT",
        description: "SENTINEL_AGENT_DESCRIPTION",
        metadata: { category: "utility", cost: "CHEAP", triggers: [] },
      },
    ]

    const result = buildUltraworkSection(agents, categories, skills)

    for (const value of [
      categories[0]?.name,
      categories[0]?.description,
      skills[0]?.name,
      skills[0]?.description,
      skills[1]?.name,
      skills[1]?.description,
      agents[0]?.name,
      agents[0]?.description,
    ]) {
      expect(result).toContain(value ?? "unreachable-sentinel")
    }
  })
})

describe("buildParallelDelegationSection", () => {
  const deepCategory: AvailableCategory = { name: "deep", description: "SENTINEL_DEEP" }
  const highCategory: AvailableCategory = { name: "unspecified-high", description: "SENTINEL_HIGH" }
  const otherCategory: AvailableCategory = { name: "quick", description: "SENTINEL_QUICK" }

  it("enables only the non-Claude delegation-category branches", () => {
    const deepResult = buildParallelDelegationSection("google/gemini-3.1-pro", [deepCategory])
    const highResult = buildParallelDelegationSection("openai/gpt-5.4", [highCategory])

    const claudeResult = buildParallelDelegationSection("anthropic/CLAUDE-opus-4-7", [deepCategory])
    const unrelatedCategoryResult = buildParallelDelegationSection("openai/gpt-5.4", [otherCategory])

    expect(deepResult).toBe(highResult)
    expect(deepResult).not.toBe(claudeResult)
    expect(deepResult).not.toBe(unrelatedCategoryResult)
    expect(claudeResult).toBe("")
    expect(unrelatedCategoryResult).toBe("")
  })
})

describe("buildNonClaudePlannerSection", () => {
  it("selects the planner branch from the model family", () => {
    const geminiResult = buildNonClaudePlannerSection("google/gemini-3.1-pro")
    const gptResult = buildNonClaudePlannerSection("openai/gpt-5.4")

    const claudeResult = buildNonClaudePlannerSection("anthropic/CLAUDE-sonnet-4-6")

    expect(geminiResult).toBe(gptResult)
    expect(geminiResult).not.toBe(claudeResult)
    expect(claudeResult).toBe("")
  })
})
