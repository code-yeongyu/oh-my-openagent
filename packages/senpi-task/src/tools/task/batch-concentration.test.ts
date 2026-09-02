import { describe, expect, test } from "bun:test"

import type { ResolvedModelRecord } from "../../state"
import { lintProviderConcentration, observeStartedItem, PROVIDER_CONCENTRATION_THRESHOLD } from "./batch-concentration"
import type { ConcentrationObservation } from "./batch-concentration"
import type { ResolvedSpawnItem } from "./types"

function resolvedModel(provider: string, modelId: string): ResolvedModelRecord {
  return { provider, model_id: modelId, display: `${provider}/${modelId}`, source: "category" }
}

function categoryItem(category: string): ResolvedSpawnItem {
  return { kind: "category", category, prompt: "work the wave item", load_skills: [] }
}

function subagentItem(subagentType: string): ResolvedSpawnItem {
  return { kind: "subagent_type", subagentType, prompt: "work the wave item", load_skills: [] }
}

function observationsFor(
  observe: () => ConcentrationObservation | undefined,
  count: number,
): readonly ConcentrationObservation[] {
  return Array.from({ length: count }, observe).flatMap((entry) => (entry === undefined ? [] : [entry]))
}

describe("observeStartedItem", () => {
  test("#given a category item with a resolved model #when observed #then the observation carries both facts", () => {
    const observation = observeStartedItem(categoryItem("visual-engineering"), resolvedModel("anthropic", "claude-opus-5"))

    expect(observation).toEqual({ category: "visual-engineering", resolvedModel: resolvedModel("anthropic", "claude-opus-5") })
  })

  test("#given an explicit subagent item or a missing resolved model #when observed #then no observation is produced", () => {
    expect(observeStartedItem(subagentItem("explore"), resolvedModel("anthropic", "claude-opus-5"))).toBeUndefined()
    expect(observeStartedItem(categoryItem("visual-engineering"), undefined)).toBeUndefined()
  })
})

describe("lintProviderConcentration", () => {
  test("#given the issue threshold #when read #then it is 4 same-category tasks on one provider model", () => {
    expect(PROVIDER_CONCENTRATION_THRESHOLD).toBe(4)
  })

  test("#given four visual-engineering tasks resolving to one provider model #when linted #then the warning names the category, the count, and the model", () => {
    const observations = observationsFor(
      () => observeStartedItem(categoryItem("visual-engineering"), resolvedModel("anthropic", "claude-opus-5")),
      4,
    )

    const warning = lintProviderConcentration(observations)

    expect(warning).toContain("Provider concentration warning")
    expect(warning).toContain('category "visual-engineering"')
    expect(warning).toContain("4 tasks")
    expect(warning).toContain("anthropic/claude-opus-5")
  })

  test("#given three tasks on one provider model #when linted #then no warning fires below the threshold", () => {
    const observations = observationsFor(
      () => observeStartedItem(categoryItem("visual-engineering"), resolvedModel("anthropic", "claude-opus-5")),
      3,
    )

    expect(lintProviderConcentration(observations)).toBeUndefined()
  })

  test("#given threshold-count tasks split across two models #when linted #then no single model reaches concentration", () => {
    const observations = [
      ...observationsFor(
        () => observeStartedItem(categoryItem("visual-engineering"), resolvedModel("anthropic", "claude-opus-5")),
        2,
      ),
      ...observationsFor(
        () => observeStartedItem(categoryItem("visual-engineering"), resolvedModel("google", "gemini-flash")),
        2,
      ),
    ]

    expect(lintProviderConcentration(observations)).toBeUndefined()
  })

  test("#given threshold-count tasks on one model across different categories #when linted #then no single category reaches concentration", () => {
    const observations = [
      ...observationsFor(
        () => observeStartedItem(categoryItem("visual-engineering"), resolvedModel("anthropic", "claude-opus-5")),
        2,
      ),
      ...observationsFor(
        () => observeStartedItem(categoryItem("artistry"), resolvedModel("anthropic", "claude-opus-5")),
        2,
      ),
    ]

    expect(lintProviderConcentration(observations)).toBeUndefined()
  })

  test("#given observations without category or model facts #when linted #then they are ignored instead of crashing", () => {
    expect(lintProviderConcentration([])).toBeUndefined()
    expect(lintProviderConcentration([{ category: "visual-engineering" }, { resolvedModel: resolvedModel("anthropic", "claude-opus-5") }])).toBeUndefined()
  })
})
