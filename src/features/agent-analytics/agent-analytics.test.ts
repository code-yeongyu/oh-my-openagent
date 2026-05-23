import { describe, it, expect, beforeEach } from "bun:test"
import {
  recordMetric,
  getAgentMetrics,
  getToolMetrics,
  getCategoryMetrics,
  getTrends,
  clearMetrics,
} from "./reports"
import { getAnalyticsDb } from "./storage"

describe("Agent Analytics", () => {
  beforeEach(() => {
    clearMetrics("all")
  })

  describe("#given a clean database", () => {
    it("should record a tool execution metric", () => {
      // given
      const metric = {
        agentName: "sisyphus",
        toolName: "delegate",
        category: "quick",
        sessionId: "session-1",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
        modelUsed: "kimi-k2.6",
      }

      // when
      recordMetric(metric)

      // then
      const db = getAnalyticsDb()
      const result = db.query("SELECT * FROM tool_executions").all()
      expect(result.length).toBe(1)
      expect(result[0].agent_name).toBe("sisyphus")
      expect(result[0].tool_name).toBe("delegate")
      expect(result[0].success).toBe(1)
    })

    it("should get agent metrics", () => {
      // given
      recordMetric({
        agentName: "sisyphus",
        toolName: "delegate",
        category: "quick",
        sessionId: "session-1",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
        modelUsed: "kimi-k2.6",
      })

      // when
      const metrics = getAgentMetrics("sisyphus")

      // then
      expect(metrics.totalExecutions).toBe(1)
      expect(metrics.successRate).toBe(1)
      expect(metrics.averageDurationMs).toBe(1500)
      expect(metrics.totalTokens).toBe(100)
    })

    it("should get tool metrics", () => {
      // given
      recordMetric({
        agentName: "sisyphus",
        toolName: "delegate",
        category: "quick",
        sessionId: "session-1",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
        modelUsed: "kimi-k2.6",
      })

      // when
      const metrics = getToolMetrics("delegate")

      // then
      expect(metrics.totalExecutions).toBe(1)
      expect(metrics.successRate).toBe(1)
    })

    it("should get category metrics", () => {
      // given
      recordMetric({
        agentName: "sisyphus",
        toolName: "delegate",
        category: "quick",
        sessionId: "session-1",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
        modelUsed: "kimi-k2.6",
      })

      // when
      const metrics = getCategoryMetrics("quick")

      // then
      expect(metrics.totalExecutions).toBe(1)
      expect(metrics.successRate).toBe(1)
    })

    it("should calculate trends correctly", () => {
      // given
      const now = new Date()
      const yesterday = new Date(now.getTime() - 86400000)

      recordMetric({
        agentName: "sisyphus",
        toolName: "delegate",
        category: "quick",
        sessionId: "session-1",
        durationMs: 2000,
        tokenCount: 100,
        success: true,
        modelUsed: "kimi-k2.6",
        timestamp: yesterday,
      })

      recordMetric({
        agentName: "sisyphus",
        toolName: "delegate",
        category: "quick",
        sessionId: "session-2",
        durationMs: 1000,
        tokenCount: 100,
        success: true,
        modelUsed: "kimi-k2.6",
        timestamp: now,
      })

      // when
      const trends = getTrends("sisyphus", "day")

      // then
      expect(trends.length).toBeGreaterThan(0)
      expect(trends[0].totalExecutions).toBe(1)
      expect(trends[0].successRate).toBe(1)
    })

    it("should handle failed executions", () => {
      // given
      recordMetric({
        agentName: "sisyphus",
        toolName: "delegate",
        category: "quick",
        sessionId: "session-1",
        durationMs: 1500,
        tokenCount: 100,
        success: false,
        errorType: "timeout",
        errorMessage: "Request timed out",
        modelUsed: "kimi-k2.6",
      })

      // when
      const metrics = getAgentMetrics("sisyphus")

      // then
      expect(metrics.totalExecutions).toBe(1)
      expect(metrics.successRate).toBe(0)
      expect(metrics.failureRate).toBe(1)
    })

    it("should clear all metrics", () => {
      // given
      recordMetric({
        agentName: "sisyphus",
        toolName: "delegate",
        category: "quick",
        sessionId: "session-1",
        durationMs: 1500,
        tokenCount: 100,
        success: true,
        modelUsed: "kimi-k2.6",
      })

      // when
      clearMetrics("all")

      // then
      const db = getAnalyticsDb()
      const result = db.query("SELECT * FROM tool_executions").all()
      expect(result.length).toBe(0)
    })
  })
})
