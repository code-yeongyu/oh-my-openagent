/**
 * MCP Health Checker Tests
 *
 * Tests for async health checking and degradation of remote MCP services
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  McpHealthChecker,
  createMcpHealthChecker,
  McpStatus,
  type McpHealthResult,
} from "./health-checker"

describe("McpHealthChecker", () => {
  let checker: McpHealthChecker

  beforeEach(() => {
    checker = createMcpHealthChecker()
  })

  describe("health check", () => {
    //#given remote MCP is available
    //#when checking health
    //#then should return healthy status
    it("should detect available MCP", async () => {
      checker.setMockHealth("mcp-1", true)
      const result = await checker.checkHealth("mcp-1")

      expect(result.status).toBe(McpStatus.HEALTHY)
    })

    //#given remote MCP is unavailable
    //#when checking health
    //#then should mark as degraded
    it("should detect unavailable MCP", async () => {
      checker.setMockHealth("mcp-1", false)
      const result = await checker.checkHealth("mcp-1")

      expect(result.status).toBe(McpStatus.DEGRADED)
    })
  })

  describe("async startup check", () => {
    //#given multiple MCPs configured
    //#when starting up
    //#then should check all MCPs asynchronously
    it("should check all MCPs on startup", async () => {
      checker.setMockHealth("mcp-1", true)
      checker.setMockHealth("mcp-2", false)
      checker.setMockHealth("mcp-3", true)

      await checker.checkAllOnStartup(["mcp-1", "mcp-2", "mcp-3"])

      expect(checker.getStatus("mcp-1")).toBe(McpStatus.HEALTHY)
      expect(checker.getStatus("mcp-2")).toBe(McpStatus.DEGRADED)
      expect(checker.getStatus("mcp-3")).toBe(McpStatus.HEALTHY)
    })
  })

  describe("degraded MCP handling", () => {
    it("should auto-mark unavailable MCPs as degraded", async () => {
      checker.setMockHealth("broken-mcp", false)
      await checker.checkHealth("broken-mcp")

      const degraded = checker.getDegradedMcps()
      expect(degraded).toContain("broken-mcp")
    })

    it("should log degradation reason", async () => {
      const logs: string[] = []
      checker.setLogger((msg: string) => logs.push(msg))
      checker.setMockHealth("broken-mcp", false, "Connection refused")

      await checker.checkHealth("broken-mcp")

      expect(logs.some((l) => l.includes("broken-mcp"))).toBe(true)
      expect(logs.some((l) => l.includes("Connection refused"))).toBe(true)
    })
  })

  describe("health status API", () => {
    //#given health check completed
    //#when querying status
    //#then should return current status
    it("should provide health status query API", async () => {
      checker.setMockHealth("mcp-1", true)
      await checker.checkHealth("mcp-1")

      const status = checker.getStatus("mcp-1")
      expect(status).toBe(McpStatus.HEALTHY)
    })

    it("should return unknown for unchecked MCPs", () => {
      const status = checker.getStatus("unknown-mcp")
      expect(status).toBe(McpStatus.UNKNOWN)
    })
  })

  describe("health report", () => {
    it("should generate health report", async () => {
      checker.setMockHealth("healthy-mcp", true)
      checker.setMockHealth("broken-mcp", false)
      await checker.checkAllOnStartup(["healthy-mcp", "broken-mcp"])

      const report = checker.generateReport()

      expect(report).toContain("healthy-mcp")
      expect(report).toContain("broken-mcp")
      expect(report).toContain("HEALTHY")
      expect(report).toContain("DEGRADED")
    })
  })

  describe("recovery detection", () => {
    it("should detect MCP recovery", async () => {
      checker.setMockHealth("recovering-mcp", false)
      await checker.checkHealth("recovering-mcp")
      expect(checker.getStatus("recovering-mcp")).toBe(McpStatus.DEGRADED)

      checker.setMockHealth("recovering-mcp", true)
      await checker.checkHealth("recovering-mcp")
      expect(checker.getStatus("recovering-mcp")).toBe(McpStatus.HEALTHY)
    })
  })
})
