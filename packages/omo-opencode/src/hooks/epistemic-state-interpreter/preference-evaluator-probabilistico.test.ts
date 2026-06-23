import { expect, test } from "bun:test"
import type { EpistemicAnnotation } from "./types"
import {
  evaluateProbabilistico,
  probabilisticoEvaluator,
} from "./preference-evaluator-probabilistico"

test("#given 2 in and 4 total #when evaluating probabilistico #then returns 0.5", () => {
  const score = evaluateProbabilistico(2, 4)

  expect(score).toBe(0.5)
})

test("#given 4 in and 4 total #when evaluating probabilistico #then returns 1.0", () => {
  const score = evaluateProbabilistico(4, 4)

  expect(score).toBe(1)
})

test("#given 0 in and 4 total #when evaluating probabilistico #then returns 0.0", () => {
  const score = evaluateProbabilistico(0, 4)

  expect(score).toBe(0)
})

test("#given 0 in and 0 total #when evaluating probabilistico #then returns 0.0", () => {
  const score = evaluateProbabilistico(0, 0)

  expect(score).toBe(0)
})

test("#given any counts #when evaluating probabilistico #then result is between 0.0 and 1.0", () => {
  const scores = [
    evaluateProbabilistico(0, 1),
    evaluateProbabilistico(1, 2),
    evaluateProbabilistico(2, 4),
    evaluateProbabilistico(4, 4),
    evaluateProbabilistico(0, 0),
  ]

  for (const score of scores) {
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  }
})

test("#given the PreferenceEvaluator interface object #when reading its name #then it exposes probabilistico", () => {
  expect(probabilisticoEvaluator.name).toBe("probabilistico")
})

test("#given the PreferenceEvaluator interface object #when evaluating #then it matches evaluateProbabilistico", () => {
  const annotation = {
    extensionMembership: {
      inCount: 2,
      totalCount: 5,
    },
  } as EpistemicAnnotation

  expect(probabilisticoEvaluator.evaluate(annotation)).toBe(
    evaluateProbabilistico(
      annotation.extensionMembership.inCount,
      annotation.extensionMembership.totalCount,
    ),
  )
})
