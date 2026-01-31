/**
 * Final Audit Hook Tests
 *
 * Tests for running high-cost checks only at Stop phase
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  FinalAuditHook,
  createFinalAuditHook,
  type AuditConfig,
  type AuditResult,
} from "./final-audit-hook"

describe("FinalAuditHook", () => {
  let hook: FinalAuditHook

  beforeEach(() => {
    hook = createFinalAuditHook()
  })

  describe("configuration", () => {
    it("should have LSP diagnostics enabled by default", () => {
      const config = hook.getConfig()
      expect(config.runLspDiagnostics).toBe(true)
    })

    it("should have typecheck disabled by default (optional)", () => {
      const config = hook.getConfig()
      expect(config.runTypecheck).toBe(false)
    })

    it("should have tests disabled by default (optional)", () => {
      const config = hook.getConfig()
      expect(config.runTests).toBe(false)
    })

    it("should allow enabling all checks", () => {
      hook.setConfig({
        runLspDiagnostics: true,
        runTypecheck: true,
        runTests: true,
      })

      const config = hook.getConfig()
      expect(config.runLspDiagnostics).toBe(true)
      expect(config.runTypecheck).toBe(true)
      expect(config.runTests).toBe(true)
    })
  })

  describe("LSP diagnostics", () => {
    //#given Stop phase triggered
    //#when running final audit
    //#then should run LSP diagnostics
    it("should run LSP diagnostics on stop", async () => {
      hook.setMockDiagnostics([])
      const result = await hook.runAudit()

      expect(result.lspDiagnostics).toBeDefined()
      expect(result.lspDiagnostics?.errorCount).toBe(0)
    })

    it("should report LSP errors in result", async () => {
      hook.setMockDiagnostics([
        { file: "src/index.ts", message: "Type error", severity: "error" },
        { file: "src/utils.ts", message: "Unused variable", severity: "warning" },
      ])

      const result = await hook.runAudit()

      expect(result.lspDiagnostics?.errorCount).toBe(1)
      expect(result.lspDiagnostics?.warningCount).toBe(1)
    })
  })

  describe("optional typecheck", () => {
    //#given typecheck enabled in config
    //#when running final audit
    //#then should run typecheck
    it("should run typecheck when enabled", async () => {
      hook.setConfig({ runTypecheck: true })
      hook.setMockTypecheckResult({ success: true, errors: [] })

      const result = await hook.runAudit()

      expect(result.typecheck).toBeDefined()
      expect(result.typecheck?.success).toBe(true)
    })

    it("should skip typecheck when disabled", async () => {
      hook.setConfig({ runTypecheck: false })

      const result = await hook.runAudit()

      expect(result.typecheck).toBeUndefined()
    })
  })

  describe("optional tests", () => {
    //#given tests enabled in config
    //#when running final audit
    //#then should run test suite
    it("should run tests when enabled", async () => {
      hook.setConfig({ runTests: true })
      hook.setMockTestResult({ passed: 10, failed: 0, total: 10 })

      const result = await hook.runAudit()

      expect(result.tests).toBeDefined()
      expect(result.tests?.passed).toBe(10)
    })

    it("should skip tests when disabled", async () => {
      hook.setConfig({ runTests: false })

      const result = await hook.runAudit()

      expect(result.tests).toBeUndefined()
    })
  })

  describe("audit report generation", () => {
    //#given audit results available
    //#when generating report
    //#then should format as final report output
    it("should generate formatted report", async () => {
      hook.setMockDiagnostics([])
      const result = await hook.runAudit()
      const report = hook.generateReport(result)

      expect(report).toContain("Final Audit Report")
      expect(report).toContain("LSP Diagnostics")
    })

    it("should include all enabled check results", async () => {
      hook.setConfig({ runLspDiagnostics: true, runTypecheck: true, runTests: true })
      hook.setMockDiagnostics([])
      hook.setMockTypecheckResult({ success: true, errors: [] })
      hook.setMockTestResult({ passed: 5, failed: 0, total: 5 })

      const result = await hook.runAudit()
      const report = hook.generateReport(result)

      expect(report).toContain("LSP Diagnostics")
      expect(report).toContain("Type Check")
      expect(report).toContain("Tests")
    })
  })

  describe("overall status", () => {
    it("should return success when all checks pass", async () => {
      hook.setMockDiagnostics([])
      const result = await hook.runAudit()

      expect(result.overallSuccess).toBe(true)
    })

    it("should return failure when LSP has errors", async () => {
      hook.setMockDiagnostics([
        { file: "src/index.ts", message: "Type error", severity: "error" },
      ])

      const result = await hook.runAudit()

      expect(result.overallSuccess).toBe(false)
    })
  })
})
