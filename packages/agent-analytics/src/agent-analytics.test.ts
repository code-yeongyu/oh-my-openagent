import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import {
  recordMetric,
  getAgentSummary,
  getAllAgentSummaries,
  getTrends,
  getOverallStats,
  clearMetrics,
  closeAnalyticsDb,
} from "./storage"
import { captureToolCall, captureDelegation, captureSessionComplete } from "./collector"
import { generateReport, formatReport } from "./reports"
import type { AgentMetricEvent } from "./types"

describe("agent-analytics", () => {
  beforeEach(() => {
    clearMetrics("all")
  })

  afterEach(() => {
    closeAnalyticsDb()
  })

  describe("#given no metrics", () => {
    it("#then getAllAgentSummaries returns empty array", () => {
      const summaries = getAllAgentSummaries("7d")
      expect(summaries).toEqual([])
    })

    it("#then getOverallStats returns zeros", () => {
      const stats = getOverallStats("7d")
      expect(stats.totalEvents).toBe(0)
      expect(stats.overallSuccessRate).toBe(0)
      expect(stats.overallAvgDurationMs).toBe(0)
    })
  })

  describe("#given recorded metrics", () => {
    beforeEach(() => {
      const baseEvent: Omit<AgentMetricEvent, "id" | "timestamp" | "durationMs"> = {
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "orchestration",
        eventType: "tool_call",
        toolName: "delegate_task",
        success: true,
        tokenCount: 100,
      }

      recordMetric({
        ...baseEvent,
        id: "1",
        timestamp: new Date(),
        durationMs: 1000,
      })

      recordMetric({
        ...baseEvent,
        id: "2",
        timestamp: new Date(),
        durationMs: 2000,
        success: false,
        errorType: "timeout",
        tokenCount: 0,
      })

      recordMetric({
        ...baseEvent,
        id: "3",
        timestamp: new Date(),
        durationMs: 1500,
        agentName: "oracle",
        tokenCount: 200,
      })
    })

    it("#then getAllAgentSummaries returns correct data", () => {
      const summaries = getAllAgentSummaries("7d")
      expect(summaries).toHaveLength(2)

      const sisyphus = summaries.find((s) => s.agentName === "sisyphus")
      expect(sisyphus).toBeDefined()
      expect(sisyphus!.totalCalls).toBe(2)
      expect(sisyphus!.successfulCalls).toBe(1)
      expect(sisyphus!.failedCalls).toBe(1)
      expect(sisyphus!.successRate).toBe(0.5)
      expect(sisyphus!.avgDurationMs).toBe(1500)
      expect(sisyphus!.totalTokens).toBe(100)
    })

    it("#then getAgentSummary returns correct data for specific agent", () => {
      const summary = getAgentSummary("oracle", "7d")
      expect(summary).toBeDefined()
      expect(summary!.totalCalls).toBe(1)
      expect(summary!.successfulCalls).toBe(1)
      expect(summary!.totalTokens).toBe(200)
    })

    it("#then getOverallStats returns aggregated data", () => {
      const stats = getOverallStats("7d")
      expect(stats.totalEvents).toBe(3)
      expect(stats.overallSuccessRate).toBeCloseTo(2 / 3, 2)
    })

    it("#then generateReport produces valid report", () => {
      const report = generateReport("7d")
      expect(report.summaries).toHaveLength(2)
      expect(report.overallSuccessRate).toBeCloseTo(2 / 3, 2)
      expect(report.trends).toHaveLength(1)
    })

    it("#then formatReport produces markdown output", () => {
      const report = generateReport("7d")
      const formatted = formatReport(report)
      expect(formatted).toContain("# Agent Performance Analytics Report")
      expect(formatted).toContain("sisyphus")
      expect(formatted).toContain("oracle")
    })
  })

  describe("#given capture helpers", () => {
    it("#then captureToolCall records metric with correct duration", () => {
      const startTime = Date.now() - 500
      captureToolCall({
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "orchestration",
        toolName: "delegate_task",
        startTime,
        success: true,
        tokenCount: 50,
      })

      const summary = getAgentSummary("sisyphus", "7d")
      expect(summary).toBeDefined()
      expect(summary!.totalCalls).toBe(1)
      expect(summary!.avgDurationMs).toBeGreaterThanOrEqual(500)
    })

    it("#then captureDelegation records delegation metric", () => {
      captureDelegation({
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "orchestration",
        targetAgent: "oracle",
        startTime: Date.now() - 1000,
        success: true,
      })

      const summary = getAgentSummary("sisyphus", "7d")
      expect(summary).toBeDefined()
      expect(summary!.totalCalls).toBe(1)
    })

    it("#then captureSessionComplete records session metric", () => {
      captureSessionComplete({
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "orchestration",
        durationMs: 5000,
        success: true,
        tokenCount: 1000,
      })

      const summary = getAgentSummary("sisyphus", "7d")
      expect(summary).toBeDefined()
      expect(summary!.totalCalls).toBe(1)
    })
  })

  describe("#given time range filtering", () => {
    it("#then old metrics are excluded from 24h range", () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000)
      recordMetric({
        id: "old-1",
        timestamp: oldDate,
        sessionId: "session-old",
        agentName: "sisyphus",
        category: "orchestration",
        eventType: "tool_call",
        durationMs: 1000,
        success: true,
      })

      const recentDate = new Date()
      recordMetric({
        id: "recent-1",
        timestamp: recentDate,
        sessionId: "session-recent",
        agentName: "sisyphus",
        category: "orchestration",
        eventType: "tool_call",
        durationMs: 1000,
        success: true,
      })

      const summaries24h = getAllAgentSummaries("24h")
      expect(summaries24h).toHaveLength(1)
      expect(summaries24h[0].totalCalls).toBe(1)

      const summariesAll = getAllAgentSummaries("all")
      expect(summariesAll).toHaveLength(1)
      expect(summariesAll[0].totalCalls).toBe(2)
    })
  })
})