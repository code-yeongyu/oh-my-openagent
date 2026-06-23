import { afterEach, describe, expect, test } from "bun:test"

import type { HookBalance } from "./hook-entity-types"
import { computeTransitionV2 } from "./transition-engine-v2"
import type { AmmissibilitaState } from "./multi-plane-types"
import type { TransitionThresholds } from "../../config/schema/epistemic-v6"

const DEFAULT_THRESHOLDS: TransitionThresholds = {
  advancement_min_strength: 1,
  retrocession_min_strength: 2,
  expulsion_min_strength: 3,
  reopening_min_strength: 2,
}

const thresholds: TransitionThresholds = { ...DEFAULT_THRESHOLDS }

const makeBalance = (overrides: Partial<HookBalance>): HookBalance => ({
  target: "accept(a)",
  positiveCount: 0,
  negativeCount: 0,
  positiveStrengthSum: 0,
  negativeStrengthSum: 0,
  netForce: 0,
  direction: "neutral",
  ...overrides,
})

const expectTransition = (
  from: AmmissibilitaState,
  balance: HookBalance,
  to: AmmissibilitaState,
  transitioned = true,
) => {
  const result = computeTransitionV2(from, balance, thresholds)

  expect(result.from).toBe(from)
  expect(result.to).toBe(to)
  expect(result.transitioned).toBe(transitioned)

  return result
}

afterEach(() => {
  Object.assign(thresholds, DEFAULT_THRESHOLDS)
})

describe("computeTransitionV2", () => {
  describe("#given advancement by positive hook force", () => {
    test("#when possibile receives weak HP #then it advances to non_escluso", () => {
      expectTransition("possibile", makeBalance({ direction: "retention", positiveCount: 1, positiveStrengthSum: 1, netForce: 1 }), "non_escluso")
    })

    test("#when non_escluso receives weak HP #then it advances to da_verificare", () => {
      expectTransition("non_escluso", makeBalance({ direction: "retention", positiveCount: 1, positiveStrengthSum: 1, netForce: 1 }), "da_verificare")
    })

    test("#when da_verificare receives weak HP #then it advances to plausibile", () => {
      expectTransition("da_verificare", makeBalance({ direction: "retention", positiveCount: 1, positiveStrengthSum: 1, netForce: 1 }), "plausibile")
    })

    test("#when plausibile receives HP #then it does not advance beyond max", () => {
      const result = expectTransition("plausibile", makeBalance({ direction: "retention", positiveCount: 1, positiveStrengthSum: 1, netForce: 1 }), "plausibile", false)

      expect(result.reason).toContain("no advancement")
    })
  })

  describe("#given retrocession by moderate negative hook force", () => {
    test("#when plausibile receives medium HN #then it retrocedes to da_verificare", () => {
      expectTransition("plausibile", makeBalance({ direction: "expulsion", negativeCount: 1, negativeStrengthSum: 2, netForce: -2 }), "da_verificare")
    })

    test("#when da_verificare receives medium HN #then it retrocedes to non_escluso", () => {
      expectTransition("da_verificare", makeBalance({ direction: "expulsion", negativeCount: 1, negativeStrengthSum: 2, netForce: -2 }), "non_escluso")
    })

    test("#when non_escluso receives medium HN #then it retrocedes to escluso_operativamente", () => {
      expectTransition("non_escluso", makeBalance({ direction: "expulsion", negativeCount: 1, negativeStrengthSum: 2, netForce: -2 }), "escluso_operativamente")
    })
  })

  describe("#given expulsion by strong negative hook force", () => {
    test("#when possible states receive strong HN #then they are expelled operationally", () => {
      expectTransition("possibile", makeBalance({ direction: "expulsion", negativeCount: 1, negativeStrengthSum: 3, netForce: -3 }), "escluso_operativamente")
    })

    test("#when escluso_operativamente receives strong HN #then it becomes escluso", () => {
      expectTransition("escluso_operativamente", makeBalance({ direction: "expulsion", negativeCount: 1, negativeStrengthSum: 3, netForce: -3 }), "escluso")
    })

    test("#when escluso receives HN #then it remains terminal", () => {
      const result = expectTransition("escluso", makeBalance({ direction: "expulsion", negativeCount: 1, negativeStrengthSum: 3, netForce: -3 }), "escluso", false)

      expect(result.reason).toBe("already escluso")
    })
  })

  describe("#given reopening by positive force on excluded states", () => {
    test("#when escluso_operativamente receives medium HP #then it reopens to non_escluso", () => {
      expectTransition("escluso_operativamente", makeBalance({ direction: "retention", positiveCount: 1, positiveStrengthSum: 2, netForce: 2 }), "non_escluso")
    })

    test("#when escluso receives medium HP #then it reopens to possibile", () => {
      expectTransition("escluso", makeBalance({ direction: "retention", positiveCount: 1, positiveStrengthSum: 2, netForce: 2 }), "possibile")
    })
  })

  describe("#given neutral or insufficient force", () => {
    test("#when balance is neutral #then no transition occurs", () => {
      const result = expectTransition("da_verificare", makeBalance({ direction: "neutral" }), "da_verificare", false)

      expect(result.reason).toBe("insufficient hook force for transition")
    })

    test("#when force stays below thresholds #then no transition occurs", () => {
      const result = expectTransition("non_escluso", makeBalance({ direction: "retention", positiveCount: 1, positiveStrengthSum: 0, netForce: 0 }), "non_escluso", false)

      expect(result.reason).toBe("insufficient hook force for transition")
    })
  })
})
