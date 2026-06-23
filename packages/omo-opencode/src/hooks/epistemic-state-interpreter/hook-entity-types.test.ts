import { describe, expect, test } from "bun:test"

import {
  HOOK_STRENGTH_VALUES,
  type EpistemicFactors,
  type EpistemicHook,
  type HookBalance,
  type PragmaticFactors,
} from "./hook-entity-types"

describe("hook-entity-types", () => {
  describe("given epistemic factors", () => {
    test("when assigned with 0-1 values then all fields are available", () => {
      const factors: EpistemicFactors = {
        supporto_empirico: 0.2,
        compatibilita_strutturale: 0.4,
        potenziale_esplicativo: 0.6,
        valore_verifica: 0.8,
        maturita: 1,
      }

      expect(factors).toEqual({
        supporto_empirico: 0.2,
        compatibilita_strutturale: 0.4,
        potenziale_esplicativo: 0.6,
        valore_verifica: 0.8,
        maturita: 1,
      })
    })
  })

  describe("given pragmatic factors", () => {
    test("when assigned with 0-1 values then all fields are available", () => {
      const factors: PragmaticFactors = {
        beneficio_potenziale: 0.9,
        urgenza: 0.7,
        costo_verifica: 0.5,
        rischio: 0.3,
      }

      expect(factors.rischio).toBe(0.3)
      expect(factors.costo_verifica).toBe(0.5)
    })
  })

  describe("given a positive hook entity", () => {
    test("when created then positive polarity is preserved", () => {
      const hook: EpistemicHook = {
        id: "h1",
        target: "accept(a)",
        polarity: "positivo",
        strength: "forte",
        factors: {
          epistemici: {
            supporto_empirico: 0.8,
            compatibilita_strutturale: 0.7,
            potenziale_esplicativo: 0.9,
            valore_verifica: 0.4,
            maturita: 0.6,
          },
          pragmatici: {
            beneficio_potenziale: 0.9,
            urgenza: 0.6,
            costo_verifica: 0.3,
            rischio: 0.2,
          },
        },
        rationale: "positive evidence supports retention",
        timestamp: 1,
        sessionId: "s1",
      }

      expect(hook.polarity).toBe("positivo")
      expect(hook.strength).toBe("forte")
    })
  })

  describe("given a negative hook entity", () => {
    test("when created then negative polarity is preserved", () => {
      const hook: EpistemicHook = {
        id: "h2",
        target: "accept(b)",
        polarity: "negativo",
        strength: "medio",
        factors: {
          epistemici: {
            supporto_empirico: 0.4,
            compatibilita_strutturale: 0.5,
            potenziale_esplicativo: 0.6,
            valore_verifica: 0.7,
            maturita: 0.3,
          },
          pragmatici: {
            beneficio_potenziale: 0.5,
            urgenza: 0.8,
            costo_verifica: 0.6,
            rischio: 0.9,
          },
        },
        rationale: "counterevidence pushes expulsion",
        timestamp: 2,
        sessionId: "s2",
      }

      expect(hook.polarity).toBe("negativo")
      expect(hook.target).toBe("accept(b)")
    })
  })

  describe("given hook balance with positive net force", () => {
    test("when direction is evaluated then it remains retention", () => {
      const balance: HookBalance = {
        target: "accept(a)",
        positiveCount: 2,
        negativeCount: 1,
        positiveStrengthSum: 5,
        negativeStrengthSum: 2,
        netForce: 3,
        direction: "retention",
      }

      expect(balance.direction).toBe("retention")
    })
  })

  describe("given hook balance with negative net force", () => {
    test("when direction is evaluated then it remains expulsion", () => {
      const balance: HookBalance = {
        target: "accept(b)",
        positiveCount: 1,
        negativeCount: 2,
        positiveStrengthSum: 1,
        negativeStrengthSum: 4,
        netForce: -3,
        direction: "expulsion",
      }

      expect(balance.direction).toBe("expulsion")
    })
  })

  describe("given hook balance with zero net force", () => {
    test("when direction is evaluated then it remains neutral", () => {
      const balance: HookBalance = {
        target: "accept(c)",
        positiveCount: 1,
        negativeCount: 1,
        positiveStrengthSum: 2,
        negativeStrengthSum: 2,
        netForce: 0,
        direction: "neutral",
      }

      expect(balance.direction).toBe("neutral")
    })
  })

  describe("given hook strength values", () => {
    test("when read then the numeric mapping is correct", () => {
      expect(HOOK_STRENGTH_VALUES).toEqual({
        debole: 1,
        medio: 2,
        forte: 3,
      })
    })
  })
})
