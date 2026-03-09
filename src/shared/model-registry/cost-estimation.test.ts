import { describe, it, expect } from "bun:test"
import { estimateModelCost, compareModelCosts } from "./cost-estimation"

describe("Cost Estimation", () => {
  describe("#given estimateModelCost function", () => {
    describe("#when looking up claude-opus-4-6", () => {
      it("#then returns cost estimate with expensive label", () => {
        const estimate = estimateModelCost("claude-opus-4-6")
        expect(estimate).toBeDefined()
        expect(estimate?.model).toBe("claude-opus-4-6")
        expect(estimate?.inputPer1MTokens).toBeGreaterThan(0)
        expect(estimate?.outputPer1MTokens).toBeGreaterThan(0)
        expect(estimate?.label).toBe("expensive")
      })
    })

    describe("#when looking up claude-haiku-4-5", () => {
      it("#then returns cost estimate with cheap label", () => {
        const estimate = estimateModelCost("claude-haiku-4-5")
        expect(estimate).toBeDefined()
        expect(estimate?.model).toBe("claude-haiku-4-5")
        expect(estimate?.inputPer1MTokens).toBeGreaterThan(0)
        expect(estimate?.outputPer1MTokens).toBeGreaterThan(0)
        expect(estimate?.label).toBe("cheap")
      })
    })

    describe("#when looking up gpt-5.4", () => {
      it("#then returns cost estimate with very-expensive label", () => {
        const estimate = estimateModelCost("gpt-5.4")
        expect(estimate).toBeDefined()
        expect(estimate?.model).toBe("gpt-5.4")
        expect(estimate?.label).toBe("very-expensive")
      })
    })

    describe("#when looking up gpt-5-nano", () => {
      it("#then returns cost estimate with cheap label", () => {
        const estimate = estimateModelCost("gpt-5-nano")
        expect(estimate).toBeDefined()
        expect(estimate?.model).toBe("gpt-5-nano")
        expect(estimate?.label).toBe("cheap")
      })
    })

    describe("#when looking up nonexistent model", () => {
      it("#then returns undefined", () => {
        const estimate = estimateModelCost("nonexistent-model-xyz")
        expect(estimate).toBeUndefined()
      })
    })

    describe("#when looking up gemini-3-flash", () => {
      it("#then returns cost estimate with very-cheap label", () => {
        const estimate = estimateModelCost("gemini-3-flash")
        expect(estimate).toBeDefined()
        expect(estimate?.model).toBe("gemini-3-flash")
        expect(estimate?.label).toBe("very-cheap")
      })
    })

    describe("#when looking up free model", () => {
      it("#then returns cost estimate with free label", () => {
        const estimate = estimateModelCost("minimax-m2.5-free")
        expect(estimate).toBeDefined()
        expect(estimate?.model).toBe("minimax-m2.5-free")
        expect(estimate?.label).toBe("free")
      })
    })
  })

  describe("#given compareModelCosts function", () => {
    describe("#when comparing multiple models", () => {
      it("#then returns array sorted by cost cheapest first", () => {
        const models = ["claude-opus-4-6", "claude-haiku-4-5", "gpt-5.4"]
        const sorted = compareModelCosts(models)
        expect(sorted.length).toBe(3)
        expect(sorted[0].model).toBe("claude-haiku-4-5")
        expect(sorted[sorted.length - 1].model).toBe("gpt-5.4")
      })
    })

    describe("#when comparing with nonexistent models", () => {
      it("#then filters out undefined results", () => {
        const models = ["claude-haiku-4-5", "nonexistent", "gpt-5-nano"]
        const sorted = compareModelCosts(models)
        expect(sorted.length).toBe(2)
        expect(sorted.every(e => e !== undefined)).toBe(true)
      })
    })

    describe("#when comparing empty array", () => {
      it("#then returns empty array", () => {
        const sorted = compareModelCosts([])
        expect(sorted.length).toBe(0)
      })
    })

    describe("#when comparing single model", () => {
      it("#then returns array with one element", () => {
        const sorted = compareModelCosts(["claude-haiku-4-5"])
        expect(sorted.length).toBe(1)
        expect(sorted[0].model).toBe("claude-haiku-4-5")
      })
    })

    describe("#when comparing models with same cost", () => {
      it("#then maintains stable sort order", () => {
        const models = ["claude-haiku-4-5", "gpt-5-nano"]
        const sorted = compareModelCosts(models)
        expect(sorted.length).toBe(2)
        expect(sorted[0].label).toBe("cheap")
        expect(sorted[1].label).toBe("cheap")
      })
    })
  })

  describe("#given cost label thresholds", () => {
    describe("#when input cost is $0", () => {
      it("#then label is free", () => {
        const estimate = estimateModelCost("minimax-m2.5-free")
        expect(estimate?.label).toBe("free")
      })
    })

    describe("#when input cost is between $0 and $0.5", () => {
      it("#then label is very-cheap", () => {
        const estimate = estimateModelCost("gemini-3-flash")
        expect(estimate?.label).toBe("very-cheap")
      })
    })

    describe("#when input cost is between $0.5 and $2", () => {
      it("#then label is cheap", () => {
        const estimate = estimateModelCost("claude-haiku-4-5")
        expect(estimate?.label).toBe("cheap")
      })
    })

    describe("#when input cost is between $2 and $10", () => {
      it("#then label is moderate", () => {
        const estimate = estimateModelCost("claude-sonnet-4-6")
        expect(estimate?.label).toBe("moderate")
      })
    })

    describe("#when input cost is between $10 and $30", () => {
      it("#then label is expensive", () => {
        const estimate = estimateModelCost("claude-opus-4-6")
        expect(estimate?.label).toBe("expensive")
      })
    })

    describe("#when input cost is $30 or more", () => {
      it("#then label is very-expensive", () => {
        const estimate = estimateModelCost("gpt-5.4")
        expect(estimate?.label).toBe("very-expensive")
      })
    })
  })
})
