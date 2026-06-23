import { describe, expect, test } from "bun:test"

import type { TransitionThresholds } from "../../config/schema/epistemic-v6"
import { computeTransitionV2 } from "./transition-engine-v2"

const THRESHOLDS: TransitionThresholds = {
  advancement_min_strength: 1,
  retrocession_min_strength: 2,
  expulsion_min_strength: 3,
  reopening_min_strength: 2,
}

function makeBalance(positiveSum: number, negativeSum: number) {
  const netForce = positiveSum - negativeSum
  return {
    target: "test",
    positiveCount: positiveSum > 0 ? 1 : 0,
    negativeCount: negativeSum > 0 ? 1 : 0,
    positiveStrengthSum: positiveSum,
    negativeStrengthSum: negativeSum,
    netForce,
    direction:
      netForce > 0 ? ("retention" as const) : netForce < 0 ? ("expulsion" as const) : ("neutral" as const),
  }
}

describe("computeTransitionV2 jump transitions", () => {
  describe("#given positive advancement strength", () => {
    describe("#when transitioning", () => {
      test("#then possibile with strength 1 steps to non_escluso", () => {
        expect(computeTransitionV2("possibile", makeBalance(1, 0), THRESHOLDS).to).toBe("non_escluso")
      })

      test("#then possibile with strength 2 jumps to da_verificare", () => {
        expect(computeTransitionV2("possibile", makeBalance(2, 0), THRESHOLDS).to).toBe("da_verificare")
      })

      test("#then possibile with strength 3 jumps to plausibile", () => {
        expect(computeTransitionV2("possibile", makeBalance(3, 0), THRESHOLDS).to).toBe("plausibile")
      })

      test("#then non_escluso with strength 2 jumps to plausibile", () => {
        expect(computeTransitionV2("non_escluso", makeBalance(2, 0), THRESHOLDS).to).toBe("plausibile")
      })

      test("#then non_escluso with strength 1 steps to da_verificare", () => {
        expect(computeTransitionV2("non_escluso", makeBalance(1, 0), THRESHOLDS).to).toBe("da_verificare")
      })

      test("#then da_verificare with any positive strength goes to plausibile", () => {
        expect(computeTransitionV2("da_verificare", makeBalance(1, 0), THRESHOLDS).to).toBe("plausibile")
      })
    })
  })

  describe("#given Piano B plausibility", () => {
    describe("#when transitioning", () => {
      test("#then retention from da_verificare promotes directly to plausibile", () => {
        expect(computeTransitionV2("da_verificare", makeBalance(1, 0), THRESHOLDS, true).to).toBe("plausibile")
      })

      test("#then retention from possibile promotes to da_verificare", () => {
        expect(computeTransitionV2("possibile", makeBalance(1, 0), THRESHOLDS, true).to).toBe("da_verificare")
      })

      test("#then neutral balance does not trigger Piano B promotion", () => {
        const result = computeTransitionV2("da_verificare", makeBalance(0, 0), THRESHOLDS, true)

        expect(result.transitioned).toBe(false)
        expect(result.to).toBe("da_verificare")
      })

      test("#then expulsion balance does not trigger Piano B promotion", () => {
        const result = computeTransitionV2("da_verificare", makeBalance(0, 1), THRESHOLDS, true)

        expect(result.transitioned).toBe(false)
        expect(result.to).toBe("da_verificare")
      })

      test("#then pianoBPlausibile false keeps the normal path", () => {
        expect(computeTransitionV2("possibile", makeBalance(1, 0), THRESHOLDS, false).to).toBe("non_escluso")
      })
    })
  })
})
