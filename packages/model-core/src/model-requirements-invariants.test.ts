import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

const expectedAgents = [
  "sisyphus",
  "hephaestus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "prometheus",
  "metis",
  "momus",
  "atlas",
  "sisyphus-junior",
] as const

const expectedCategories = [
  "visual-engineering",
  "ultrabrain",
  "deep",
  "artistry",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing",
] as const

describe("model requirement global invariants", () => {
  test("all builtin agents have non-empty fallback chains with valid entries", () => {
    // given
    const definedAgents = Object.keys(AGENT_MODEL_REQUIREMENTS)

    // when / then
    expect(definedAgents).toHaveLength(expectedAgents.length)
    for (const agent of expectedAgents) {
      const requirement = AGENT_MODEL_REQUIREMENTS[agent]
      expect(requirement.fallbackChain).toBeArray()
      expect(requirement.fallbackChain.length).toBeGreaterThan(0)

      for (const entry of requirement.fallbackChain) {
        expect(entry.providers).toBeArray()
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(typeof entry.model).toBe("string")
        expect(entry.model.length).toBeGreaterThan(0)
      }
    }
  })

  test("all categories have non-empty fallback chains with valid entries", () => {
    // given
    const definedCategories = Object.keys(CATEGORY_MODEL_REQUIREMENTS)

    // when / then
    expect(definedCategories).toHaveLength(expectedCategories.length)
    for (const category of expectedCategories) {
      const requirement = CATEGORY_MODEL_REQUIREMENTS[category]
      expect(requirement.fallbackChain).toBeArray()
      expect(requirement.fallbackChain.length).toBeGreaterThan(0)

      for (const entry of requirement.fallbackChain) {
        expect(entry.providers).toBeArray()
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(typeof entry.model).toBe("string")
        expect(entry.model.length).toBeGreaterThan(0)
      }
    }
  })

  test("fallback chain model ids do not include provider prefixes", () => {
    // given
    const allRequirements = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ]

    // when / then
    for (const requirement of allRequirements) {
      for (const entry of requirement.fallbackChain) {
        expect(entry.model).not.toContain("/")
      }
    }
  })

  test("builtin Kimi fallback entries use kimi-k3 instead of retired K2 ids", () => {
    // given
    const allEntries = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ].flatMap((requirement) => requirement.fallbackChain)

    // when
    const retiredKimiEntries = allEntries.filter((entry) =>
      ["k2p5", "kimi-k2.5", "kimi-k2.6"].includes(entry.model),
    )
    const kimiEntries = allEntries.filter((entry) => entry.model === "kimi-k3")

    // then
    expect(retiredKimiEntries).toEqual([])
    expect(kimiEntries.length).toBeGreaterThan(0)
  })

  test("gpt-5.5 fallback entries use the current plain model id and include OpenAI", () => {
    // given
    const allEntries = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ].flatMap((requirement) => requirement.fallbackChain)

    // when
    const currentEntries = allEntries.filter((entry) => entry.model === "gpt-5.5")

    // then
    expect(currentEntries.length).toBeGreaterThan(0)
    for (const entry of currentEntries) {
      expect(entry.model).toBe("gpt-5.5")
      expect(entry.providers).toContain("openai")
    }
  })
})
