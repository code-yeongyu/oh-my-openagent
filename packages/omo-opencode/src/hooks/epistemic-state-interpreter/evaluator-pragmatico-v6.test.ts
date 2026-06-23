import { describe, expect, test } from "bun:test"

import type { PragmaticWeights } from "../../config/schema/epistemic-v6"
import { evaluatePragmatico, type PragmaticoInput } from "./evaluator-pragmatico-v6"

const DEFAULT_WEIGHTS: PragmaticWeights = {
  peso_proprio: 0.65,
  peso_controparte: 0.35,
}

const SYMMETRIC_WEIGHTS: PragmaticWeights = {
  peso_proprio: 0.5,
  peso_controparte: 0.5,
}

function createInput(overrides: Partial<PragmaticoInput> = {}): PragmaticoInput {
  return {
    conclusion: "accept",
    proofChainKind: "mixed",
    extensionMembership: { inCount: 1, totalCount: 2 },
    competingConclusionCount: 0,
    hasStrongAttackers: false,
    weights: DEFAULT_WEIGHTS,
    ...overrides,
  }
}

function expectThreeDecimals(value: number): void {
  expect(value).toBe(Math.round(value * 1000) / 1000)
}

describe("evaluatePragmatico", () => {
  test("returns a high score for strong proof with full extension support", () => {
    const result = evaluatePragmatico(
      createInput({
        proofChainKind: "mixed",
        extensionMembership: { inCount: 4, totalCount: 4 },
      }),
    )

    expect(result.score).toBe(0.883)
  })

  test("returns a low score for weak proof with no extension support", () => {
    const result = evaluatePragmatico(
      createInput({
        proofChainKind: "unknown",
        extensionMembership: { inCount: 0, totalCount: 4 },
        competingConclusionCount: 5,
        hasStrongAttackers: true,
      }),
    )

    expect(result.score).toBe(0)
  })

  test("reduces beneficio_proprio when strong attackers are present", () => {
    const withoutAttackers = evaluatePragmatico(createInput())
    const withAttackers = evaluatePragmatico(createInput({ hasStrongAttackers: true }))

    expect(withoutAttackers.beneficio_proprio).toBe(0.68)
    expect(withAttackers.beneficio_proprio).toBe(0.62)
    expect(withAttackers.beneficio_proprio).toBeLessThan(withoutAttackers.beneficio_proprio)
  })

  test("reduces beneficio_controparte when many conclusions compete", () => {
    const withoutCompetition = evaluatePragmatico(createInput())
    const withCompetition = evaluatePragmatico(createInput({ competingConclusionCount: 5 }))

    expect(withoutCompetition.beneficio_controparte).toBe(0.7)
    expect(withCompetition.beneficio_controparte).toBe(0.5)
    expect(withCompetition.beneficio_controparte).toBeLessThan(withoutCompetition.beneficio_controparte)
  })

  test("uses the default asymmetric weights", () => {
    const result = evaluatePragmatico(createInput({ competingConclusionCount: 4 }))

    expect(result.score).toBe(0.437)
  })

  test("supports symmetric custom weights", () => {
    const result = evaluatePragmatico(
      createInput({
        competingConclusionCount: 4,
        weights: SYMMETRIC_WEIGHTS,
      }),
    )

    expect(result.score).toBe(0.402)
  })

  test("keeps the score bounded between 0 and 1", () => {
    const low = evaluatePragmatico(
      createInput({
        proofChainKind: "unknown",
        extensionMembership: { inCount: 0, totalCount: 4 },
        competingConclusionCount: 5,
        hasStrongAttackers: true,
      }),
    )
    const high = evaluatePragmatico(
      createInput({
        proofChainKind: "strict",
        extensionMembership: { inCount: 4, totalCount: 4 },
      }),
    )

    expect(low.score).toBeGreaterThanOrEqual(0)
    expect(high.score).toBeLessThanOrEqual(1)
  })

  test("rounds all numeric outputs to three decimals", () => {
    const result = evaluatePragmatico(
      createInput({
        proofChainKind: "unknown",
        extensionMembership: { inCount: 1, totalCount: 3 },
        competingConclusionCount: 2,
        hasStrongAttackers: true,
      }),
    )

    expectThreeDecimals(result.score)
    expectThreeDecimals(result.beneficio_proprio)
    expectThreeDecimals(result.beneficio_controparte)
    expectThreeDecimals(result.costo_proprio)
    expectThreeDecimals(result.costo_controparte)
  })

  test("treats zero total extensions as an extension ratio of 0", () => {
    const result = evaluatePragmatico(
      createInput({
        extensionMembership: { inCount: 0, totalCount: 0 },
      }),
    )

    expect(result.beneficio_proprio).toBe(0.48)
    expect(result.beneficio_controparte).toBe(0.4)
    expect(result.score).toBe(0.178)
  })

  test("uses a competition factor of 1 when there are no competing conclusions", () => {
    const result = evaluatePragmatico(createInput())

    expect(result.beneficio_controparte).toBe(0.7)
  })

  test("returns a near-maximum score for strict proof with full support and no attackers", () => {
    const result = evaluatePragmatico(
      createInput({
        proofChainKind: "strict",
        extensionMembership: { inCount: 5, totalCount: 5 },
      }),
    )

    expect(result.score).toBe(1)
  })

  test("reflects the input weights exactly in pesatura", () => {
    const weights: PragmaticWeights = {
      peso_proprio: 0.8,
      peso_controparte: 0.2,
    }

    const result = evaluatePragmatico(createInput({ weights }))

    expect(result.pesatura).toEqual({
      proprio: 0.8,
      controparte: 0.2,
    })
  })
})
