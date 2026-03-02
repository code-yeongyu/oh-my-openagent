import { describe, it, expect } from "bun:test"
import { computeDynamicBudget, getPressureZone } from "./dynamic-budget"
import type { ContextGcConfig } from "./types"

describe("dynamic-budget", () => {
  describe("#given getPressureZone", () => {
    describe("#when called with various usage ratios", () => {
      it("#then should classify low pressure (< 30%)", () => {
        expect(getPressureZone(0)).toBe("low")
        expect(getPressureZone(0.15)).toBe("low")
        expect(getPressureZone(0.29)).toBe("low")
      })

      it("#then should classify normal pressure (30-45%)", () => {
        expect(getPressureZone(0.30)).toBe("normal")
        expect(getPressureZone(0.40)).toBe("normal")
        expect(getPressureZone(0.44)).toBe("normal")
      })

      it("#then should classify elevated pressure (45-60%)", () => {
        expect(getPressureZone(0.45)).toBe("elevated")
        expect(getPressureZone(0.55)).toBe("elevated")
        expect(getPressureZone(0.59)).toBe("elevated")
      })

      it("#then should classify high pressure (60-75%)", () => {
        expect(getPressureZone(0.60)).toBe("high")
        expect(getPressureZone(0.70)).toBe("high")
        expect(getPressureZone(0.74)).toBe("high")
      })

      it("#then should classify extreme pressure (75%+)", () => {
        expect(getPressureZone(0.75)).toBe("extreme")
        expect(getPressureZone(0.90)).toBe("extreme")
        expect(getPressureZone(1.0)).toBe("extreme")
      })

      it("#then should clamp out-of-range values", () => {
        expect(getPressureZone(-0.5)).toBe("low")
        expect(getPressureZone(1.5)).toBe("extreme")
      })
    })
  })

  describe("#given computeDynamicBudget with default config", () => {
    describe("#when context usage is low (< 30%)", () => {
      it("#then should expand tier boundaries (more context retained)", () => {
        const budget = computeDynamicBudget(undefined, 0.15)

        expect(budget.hot_turns).toBeGreaterThanOrEqual(3)
        expect(budget.warm_turns).toBeGreaterThan(10)
        expect(budget.cold_turns).toBeGreaterThan(25)
        expect(budget.gone_turns).toBeGreaterThan(40)
      })
    })

    describe("#when context usage is normal (30-45%)", () => {
      it("#then should use default boundaries", () => {
        const budget = computeDynamicBudget(undefined, 0.35)

        expect(budget.hot_turns).toBe(3)
        expect(budget.warm_turns).toBe(10)
        expect(budget.cold_turns).toBe(25)
        expect(budget.gone_turns).toBe(40)
      })
    })

    describe("#when context usage is elevated (45-60%)", () => {
      it("#then should shrink warm/cold/gone boundaries", () => {
        const budget = computeDynamicBudget(undefined, 0.55)

        expect(budget.hot_turns).toBe(3)
        expect(budget.warm_turns).toBeLessThan(10)
        expect(budget.cold_turns).toBeLessThan(25)
        expect(budget.gone_turns).toBeLessThan(40)
      })
    })

    describe("#when context usage is high (60-75%)", () => {
      it("#then should aggressively shrink boundaries", () => {
        const budget = computeDynamicBudget(undefined, 0.70)

        expect(budget.hot_turns).toBeLessThanOrEqual(3)
        expect(budget.warm_turns).toBeLessThan(8)
        expect(budget.cold_turns).toBeLessThan(15)
        expect(budget.gone_turns).toBeLessThan(20)
      })
    })

    describe("#when context usage is extreme (75%+)", () => {
      it("#then should minimize all boundaries", () => {
        const budget = computeDynamicBudget(undefined, 0.90)

        expect(budget.hot_turns).toBeLessThanOrEqual(3)
        expect(budget.warm_turns).toBeLessThanOrEqual(5)
        expect(budget.cold_turns).toBeLessThanOrEqual(10)
        expect(budget.gone_turns).toBeLessThanOrEqual(12)
      })
    })
  })

  describe("#given computeDynamicBudget with custom config", () => {
    describe("#when min_hot_turns is configured", () => {
      it("#then should never go below min_hot_turns even under extreme pressure", () => {
        const config: ContextGcConfig = { min_hot_turns: 5, hot_turns: 5 }

        const budget = computeDynamicBudget(config, 0.95)

        expect(budget.hot_turns).toBeGreaterThanOrEqual(5)
      })
    })

    describe("#when custom base turns are provided", () => {
      it("#then should scale from those base values", () => {
        const config: ContextGcConfig = {
          hot_turns: 5,
          warm_turns: 15,
          cold_turns: 30,
          gone_turns: 50,
        }

        const budget = computeDynamicBudget(config, 0.35)

        expect(budget.hot_turns).toBe(5)
        expect(budget.warm_turns).toBe(15)
        expect(budget.cold_turns).toBe(30)
        expect(budget.gone_turns).toBe(50)
      })
    })
  })

  describe("#given tier ordering invariants", () => {
    describe("#when computed at any pressure level", () => {
      it("#then should always maintain hot < warm < cold < gone", () => {
        const pressures = [0.0, 0.15, 0.35, 0.55, 0.70, 0.85, 0.95, 1.0]

        for (const p of pressures) {
          const budget = computeDynamicBudget(undefined, p)

          expect(budget.hot_turns).toBeLessThan(budget.warm_turns)
          expect(budget.warm_turns).toBeLessThan(budget.cold_turns)
          expect(budget.cold_turns).toBeLessThan(budget.gone_turns)
        }
      })
    })

    describe("#when computed with min_hot_turns at extreme pressure", () => {
      it("#then should still maintain ordering even when min forces hot up", () => {
        const config: ContextGcConfig = { min_hot_turns: 8, hot_turns: 8 }

        const budget = computeDynamicBudget(config, 0.95)

        expect(budget.hot_turns).toBeGreaterThanOrEqual(8)
        expect(budget.hot_turns).toBeLessThan(budget.warm_turns)
        expect(budget.warm_turns).toBeLessThan(budget.cold_turns)
        expect(budget.cold_turns).toBeLessThan(budget.gone_turns)
      })
    })
  })

  describe("#given edge case inputs", () => {
    describe("#when config is undefined", () => {
      it("#then should use defaults and not crash", () => {
        expect(() => computeDynamicBudget(undefined, 0.5)).not.toThrow()
      })
    })

    describe("#when usage ratio is exactly 0", () => {
      it("#then should classify as low pressure", () => {
        const budget = computeDynamicBudget(undefined, 0)

        expect(budget.hot_turns).toBeGreaterThanOrEqual(3)
      })
    })

    describe("#when usage ratio is negative", () => {
      it("#then should clamp to 0 and classify as low", () => {
        const budget = computeDynamicBudget(undefined, -1)

        expect(budget.hot_turns).toBeGreaterThanOrEqual(3)
      })
    })

    describe("#when usage ratio exceeds 1", () => {
      it("#then should clamp to 1 and classify as extreme", () => {
        const budget = computeDynamicBudget(undefined, 2.5)

        expect(budget.hot_turns).toBeLessThanOrEqual(3)
      })
    })
  })
})
