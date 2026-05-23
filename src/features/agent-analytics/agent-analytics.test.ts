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

      recordMetric(metric)

      const db = getAnalyticsDb()
      const result = db.query("SELECT * FROM agent_metrics").all()
      expect(result.length).toBe(1)
      expect(result[0].agent_name).toBe("sisyphus")
      expect(result[0].tool_name).toBe("delegate")
      expect(result[0].success).toBe(1)
    })

    it("should get agent summary", () => {
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

      const summary = getAgentSummary("sisyphus", "all")
      expect(summary).not.toBeNull()
      expect(summary!.totalEvents).toBe(1)
      expect(summary!.successRate).toBe(100)
      expect(summary!.avgDurationMs).toBe(1500)
      expect(summary!.totalTokens).toBe(100)
    })

    it("should get all agent summaries", () => {
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

      const summaries = getAllAgentSummaries("all")
      expect(summaries.length).toBe(2)
    })

    it("should get overall stats", () => {
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

      const stats = getOverallStats("all")
      expect(stats.totalEvents).toBe(1)
      expect(stats.overallSuccessRate).toBe(100)
    })

    it("should calculate trends correctly", () => {
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

      const trends = getTrends("sisyphus", 7)
      expect(trends.length).toBeGreaterThan(0)
    })

    it("should handle failed executions", () => {
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

      const summary = getAgentSummary("sisyphus", "all")
      expect(summary).not.toBeNull()
      expect(summary!.totalEvents).toBe(1)
      expect(summary!.successRate).toBe(0)
    })

    it("should generate report", () => {
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
      expect(report.overallStats.totalEvents).toBe(1)
      expect(report.agentSummaries.length).toBe(1)
    })

    it("should format report", () => {
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
      const formatted = formatReport(report)
      expect(formatted).toContain("Agent Performance Analytics Report")
      expect(formatted).toContain("sisyphus")
    })

    it("should format agent summary", () => {
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
      const formatted = formatAgentSummary(summary)
      expect(formatted).toContain("Agent: sisyphus")
      expect(formatted).toContain("Total Events: 1")
    })

    it("should clear all metrics", () => {
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

      clearMetrics("all")

      const db = getAnalyticsDb()
      const result = db.query("SELECT * FROM agent_metrics").all()
      expect(result.length).toBe(0)
    })
  })
})
