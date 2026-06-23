import { describe, expect, it } from "bun:test"
import {
  buildCriteriaPayload,
  CRITERIA_PRESETS,
  CriteriaRetrievalError,
  normalizeCriteriaWeights,
  validateCriteriaConfig,
  validateCriterion,
} from "./criteria-retrieval"

describe("validateCriterion", () => {
  it("#given valid criterion #when validated #then passes", () => {
    expect(() =>
      validateCriterion({
        name: "accuracy",
        description: "prefer accurate facts",
        weight: 5,
      }),
    ).not.toThrow()
  })

  it("#given missing name #when validated #then throws", () => {
    expect(() =>
      validateCriterion({ name: "", description: "x", weight: 1 }),
    ).toThrow(CriteriaRetrievalError)
  })

  it("#given missing description #when validated #then throws", () => {
    expect(() =>
      validateCriterion({ name: "x", description: "", weight: 1 }),
    ).toThrow(/description/)
  })

  it("#given weight > 10 #when validated #then throws", () => {
    expect(() =>
      validateCriterion({ name: "x", description: "y", weight: 11 }),
    ).toThrow(/weight/)
  })

  it("#given weight < 0 #when validated #then throws", () => {
    expect(() =>
      validateCriterion({ name: "x", description: "y", weight: -1 }),
    ).toThrow(/weight/)
  })

  it("#given infinite weight #when validated #then throws", () => {
    expect(() =>
      validateCriterion({ name: "x", description: "y", weight: Infinity }),
    ).toThrow(/finite/)
  })
})

describe("validateCriteriaConfig", () => {
  it("#given valid config #when validated #then passes", () => {
    expect(() =>
      validateCriteriaConfig({
        criteria: [{ name: "x", description: "y", weight: 1 }],
      }),
    ).not.toThrow()
  })

  it("#given empty array #when validated #then throws", () => {
    expect(() =>
      validateCriteriaConfig({ criteria: [] }),
    ).toThrow(/empty/)
  })

  it("#given duplicate names #when validated #then throws", () => {
    expect(() =>
      validateCriteriaConfig({
        criteria: [
          { name: "accuracy", description: "a", weight: 1 },
          { name: "Accuracy", description: "b", weight: 2 },
        ],
      }),
    ).toThrow(/Duplicate/)
  })

  it("#given over 20 criteria #when validated #then throws", () => {
    const criteria = Array.from({ length: 21 }, (_, i) => ({
      name: `c${i}`,
      description: "d",
      weight: 1,
    }))
    expect(() => validateCriteriaConfig({ criteria })).toThrow(/Too many/)
  })
})

describe("buildCriteriaPayload", () => {
  it("#given valid config #when built #then trims and returns array", () => {
    const payload = buildCriteriaPayload({
      criteria: [
        { name: "  accuracy  ", description: "  fact  ", weight: 3 },
      ],
    })
    expect(payload).toHaveLength(1)
    expect(payload[0]?.name).toBe("accuracy")
    expect(payload[0]?.description).toBe("fact")
    expect(payload[0]?.weight).toBe(3)
  })
})

describe("normalizeCriteriaWeights", () => {
  it("#given weights summing to 10 #when normalized #then each divided by 10", () => {
    const normalized = normalizeCriteriaWeights([
      { name: "a", description: "x", weight: 5 },
      { name: "b", description: "y", weight: 5 },
    ])
    expect(normalized[0]?.weight).toBe(0.5)
    expect(normalized[1]?.weight).toBe(0.5)
  })

  it("#given all zero weights #when normalized #then equal distribution", () => {
    const normalized = normalizeCriteriaWeights([
      { name: "a", description: "x", weight: 0 },
      { name: "b", description: "y", weight: 0 },
      { name: "c", description: "z", weight: 0 },
    ])
    expect(normalized[0]?.weight).toBeCloseTo(1 / 3)
  })
})

describe("CRITERIA_PRESETS", () => {
  it("#given technical_priority preset #when loaded #then has 3 criteria", () => {
    const preset = CRITERIA_PRESETS.technical_priority
    expect(preset?.criteria).toHaveLength(3)
  })

  it("#given preference_priority preset #when built as payload #then validates", () => {
    expect(() =>
      buildCriteriaPayload(
        CRITERIA_PRESETS.preference_priority ?? { criteria: [] },
      ),
    ).not.toThrow()
  })
})
