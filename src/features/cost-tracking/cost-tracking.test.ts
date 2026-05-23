import { describe, it, expect, beforeEach } from "bun:test"
import {
  calculateCost,
  getModelPrice,
  setCustomPrice,
  formatCost,
  getAllPrices,
} from "./pricing"
import {
  insertCostEntry,
  getSessionCost,
  getTotalCostSince,
  getCostByAgent,
  getCostByModel,
  clearCostData,
} from "./storage"
import { getCostSummary, checkBudgets, setBudget, formatCostReport } from "./reports"
import { CostEntry, CostBudget } from "./types"

describe("Cost Tracking", () => {
  beforeEach(() => {
    clearCostData()
  })

  describe("#given known pricing data", () => {
    it("should get price for known model", () => {
      // given
      const price = getModelPrice("claude-sonnet-4-20250514")

      // then
      expect(price.provider).toBe("anthropic")
      expect(price.inputPerMillionTokens).toBe(3.0)
      expect(price.outputPerMillionTokens).toBe(15.0)
    })

    it("should return generic price for unknown model", () => {
      // given
      const price = getModelPrice("unknown-model-v42")

      // then
      expect(price.provider).toBe("unknown")
    })

    it("should allow custom price override", () => {
      // given
      setCustomPrice("my-model", { inputPerMillionTokens: 0.5, outputPerMillionTokens: 2.0, currency: "USD", provider: "custom" })

      // when
      const price = getModelPrice("my-model")

      // then
      expect(price.provider).toBe("custom")
    })

    it("should calculate cost correctly", () => {
      // given
      const cost = calculateCost("claude-sonnet-4-20250514", 1000000, 500000)

      // then
      const expected = 3.0 + (0.5 * 15.0) // 1M input at $3 + 500K output at $15
      expect(cost).toBeCloseTo(expected, 4)
    })

    it("should calculate zero cost for zero tokens", () => {
      // given
      const cost = calculateCost("claude-sonnet-4-20250514", 0, 0)

      // then
      expect(cost).toBe(0)
    })

    it("should format small costs in cents", () => {
      // given
      const formatted = formatCost(0.00123)

      // then
      expect(formatted).toContain("¢")
    })

    it("should format larger costs in dollars", () => {
      // given
      const formatted = formatCost(0.05)

      // then
      expect(formatted).toContain("$")
    })
  })

  describe("#given cost entries in storage", () => {
    it("should store and retrieve a cost entry", () => {
      // given
      const entry: CostEntry = {
        id: "test-1",
        sessionId: "session-1",
        agentName: "sisyphus",
        modelUsed: "claude-sonnet-4",
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.0105,
        toolName: "delegate",
        category: "quick",
        timestamp: new Date(),
      }

      // when
      insertCostEntry(entry)

      // then
      expect(getSessionCost("session-1")).toBeCloseTo(0.0105, 4)
    })

    it("should aggregate session cost from multiple entries", () => {
      // given
      insertCostEntry({ id: "t1", sessionId: "s1", agentName: "a", modelUsed: "m", inputTokens: 100, outputTokens: 50, costUsd: 0.005, toolName: "t", category: "c", timestamp: new Date() })
      insertCostEntry({ id: "t2", sessionId: "s1", agentName: "a", modelUsed: "m", inputTokens: 200, outputTokens: 100, costUsd: 0.01, toolName: "t", category: "c", timestamp: new Date() })

      // when
      const total = getSessionCost("s1")

      // then
      expect(total).toBeCloseTo(0.015, 4)
    })

    it("should return cost by agent", () => {
      // given
      const now = Date.now()
      insertCostEntry({ id: "t1", sessionId: "s1", agentName: "sisyphus", modelUsed: "m", inputTokens: 100, outputTokens: 50, costUsd: 0.01, toolName: "t", category: "c", timestamp: new Date(now) })
      insertCostEntry({ id: "t2", sessionId: "s1", agentName: "oracle", modelUsed: "m", inputTokens: 200, outputTokens: 100, costUsd: 0.02, toolName: "t", category: "c", timestamp: new Date(now) })

      // when
      const byAgent = getCostByAgent(now - 60000)

      // then
      expect(byAgent["sisyphus"]).toBeCloseTo(0.01, 4)
      expect(byAgent["oracle"]).toBeCloseTo(0.02, 4)
    })

    it("should return cost by model", () => {
      // given
      const now = Date.now()
      insertCostEntry({ id: "t1", sessionId: "s1", agentName: "a", modelUsed: "claude-sonnet-4", inputTokens: 100, outputTokens: 50, costUsd: 0.01, toolName: "t", category: "c", timestamp: new Date(now) })
      insertCostEntry({ id: "t2", sessionId: "s1", agentName: "a", modelUsed: "gpt-4o", inputTokens: 200, outputTokens: 100, costUsd: 0.02, toolName: "t", category: "c", timestamp: new Date(now) })

      // when
      const byModel = getCostByModel(now - 60000)

      // then
      expect(byModel["claude-sonnet-4"]).toBeCloseTo(0.01, 4)
      expect(byModel["gpt-4o"]).toBeCloseTo(0.02, 4)
    })

    it("should get cost summary", () => {
      // given
      insertCostEntry({ id: "t1", sessionId: "s1", agentName: "sisyphus", modelUsed: "claude-sonnet-4", inputTokens: 100, outputTokens: 50, costUsd: 0.01, toolName: "delegate", category: "quick", timestamp: new Date() })

      // when
      const summary = getCostSummary("all")

      // then
      expect(summary.totalCostUsd).toBeGreaterThan(0)
      expect(Object.keys(summary.costByAgent)).toContain("sisyphus")
      expect(Object.keys(summary.costByModel)).toContain("claude-sonnet-4")
    })

    it("should format cost report", () => {
      // given
      insertCostEntry({ id: "t1", sessionId: "s1", agentName: "sisyphus", modelUsed: "claude-sonnet-4", inputTokens: 100, outputTokens: 50, costUsd: 0.01, toolName: "delegate", category: "quick", timestamp: new Date() })

      // when
      const summary = getCostSummary("all")
      const formatted = formatCostReport(summary)

      // then
      expect(formatted).toContain("Cost Report")
      expect(formatted).toContain("sisyphus")
      expect(formatted).toContain("claude-sonnet-4")
    })
  })

  describe("#given budget alerts", () => {
    it("should set a budget", () => {
      // given
      const budget: CostBudget = {
        id: "budget-1",
        name: "Daily Limit",
        limitUsd: 5.0,
        period: "daily",
        currentSpendUsd: 0,
        alertThreshold: 80,
        enabled: true,
      }

      // when
      setBudget(budget)

      // then
      expect(budget.id).toBe("budget-1")
    })
  })
})
