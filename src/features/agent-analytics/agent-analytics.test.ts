import { describe, it, expect, beforeEach } from "bun:test"
import {
  getAgentSummary,
  getAllAgentSummaries,
  getOverallStats,
  getTrends,
  generateReport,
  formatReport,
  formatAgentSummary,
  clearMetrics,
} from "./reports"
import { recordMetric } from "./collector"
import { getAnalyticsDb } from "./storage"

describe("Agent Analytics", () => {
  beforeEach(() => {
    clearMetrics("all")
  })

  describe("#given a clean database", () => {
    it("should record a metric", () => {
      // given
      const metric = {
        id: "metric-1",
        timestamp: new Date(),
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call" as const,
        toolName: "delegate",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
      }

      // when
      recordMetric(metric)

      // then
      const db = getAnalyticsDb()
      const result = db.query("SELECT * FROM agent_metrics").all()
      expect(result.length).toBe(1)
      expect(result[0].agent_name).toBe("sisyphus")
      expect(result[0].tool_name).toBe("delegate")
      expect(result[0].success).toBe(1)
    })

    it("should get agent summary", () => {
      // given
      recordMetric({
        id: "metric-1",
        timestamp: new Date(),
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
      })

      // when
      const summary = getAgentSummary("sisyphus", "all")

      // then
      expect(summary).not.toBeNull()
      expect(summary!.totalEvents).toBe(1)
      expect(summary!.successRate).toBe(100)
      expect(summary!.avgDurationMs).toBe(1500)
      expect(summary!.totalTokens).toBe(100)
    })

    it("should get all agent summaries", () => {
      // given
      recordMetric({
        id: "metric-1",
        timestamp: new Date(),
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
      })

      recordMetric({
        id: "metric-2",
        timestamp: new Date(),
        sessionId: "session-2",
        agentName: "oracle",
        category: "research",
        eventType: "tool_call",
        toolName: "search",
        durationMs: 2000,
        tokenCount: 200,
        success: true,
      })

      // when
      const summaries = getAllAgentSummaries("all")

      // then
      expect(summaries.length).toBe(2)
    })

    it("should get overall stats", () => {
      // given
      recordMetric({
        id: "metric-1",
        timestamp: new Date(),
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
      })

      // when
      const stats = getOverallStats("all")

      // then
      expect(stats.totalEvents).toBe(1)
      expect(stats.overallSuccessRate).toBe(100)
    })

    it("should calculate trends correctly", () => {
      // given
      const now = new Date()
      const yesterday = new Date(now.getTime() - 86400000)

      recordMetric({
        id: "metric-1",
        timestamp: yesterday,
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 2000,
        tokenCount: 100,
        success: true,
      })

      recordMetric({
        id: "metric-2",
        timestamp: now,
        sessionId: "session-2",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 1000,
        tokenCount: 100,
        success: true,
      })

      // when
      const trends = getTrends("sisyphus", 7)

      // then
      expect(trends.length).toBeGreaterThan(0)
    })

    it("should handle failed executions", () => {
      // given
      recordMetric({
        id: "metric-1",
        timestamp: new Date(),
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 1500,
        tokenCount: 100,
        success: false,
        errorType: "timeout",
      })

      // when
      const summary = getAgentSummary("sisyphus", "all")

      // then
      expect(summary).not.toBeNull()
      expect(summary!.totalEvents).toBe(1)
      expect(summary!.successRate).toBe(0)
    })

    it("should generate report", () => {
      // given
      recordMetric({
        id: "metric-1",
        timestamp: new Date(),
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
      })

      // when
      const report = generateReport("all")

      // then
      expect(report.overallStats.totalEvents).toBe(1)
      expect(report.agentSummaries.length).toBe(1)
    })

    it("should format report", () => {
      // given
      recordMetric({
        id: "metric-1",
        timestamp: new Date(),
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
      })

      const report = generateReport("all")

      // when
      const formatted = formatReport(report)

      // then
      expect(formatted).toContain("Agent Performance Analytics Report")
      expect(formatted).toContain("sisyphus")
    })

    it("should format agent summary", () => {
      // given
      recordMetric({
        id: "metric-1",
        timestamp: new Date(),
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
      })

      const summary = getAgentSummary("sisyphus", "all")!

      // when
      const formatted = formatAgentSummary(summary)

      // then
      expect(formatted).toContain("Agent: sisyphus")
      expect(formatted).toContain("Total Events: 1")
    })

    it("should clear all metrics", () => {
      // given
      recordMetric({
        id: "metric-1",
        timestamp: new Date(),
        sessionId: "session-1",
        agentName: "sisyphus",
        category: "quick",
        eventType: "tool_call",
        toolName: "delegate",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
      })

      // when
      clearMetrics("all")

      // then
      const db = getAnalyticsDb()
      const result = db.query("SELECT * FROM agent_metrics").all()
      expect(result.length).toBe(0)
    })
  })
})
