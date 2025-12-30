import { describe, it, expect } from "bun:test"
import {
  formatStatusSymbol,
  formatCheckResult,
  formatCategoryHeader,
  formatSummary,
  formatHeader,
  formatFooter,
  formatJsonOutput,
  formatBox,
  formatHelpSuggestions,
} from "./formatter"
import type { CheckResult, DoctorSummary, DoctorResult } from "./types"

describe("formatter", () => {
  describe("formatStatusSymbol", () => {
    it("returns green check for pass", () => {
      const symbol = formatStatusSymbol("pass")
      expect(symbol).toContain("\u2713")
    })

    it("returns red cross for fail", () => {
      const symbol = formatStatusSymbol("fail")
      expect(symbol).toContain("\u2717")
    })

    it("returns yellow warning for warn", () => {
      const symbol = formatStatusSymbol("warn")
      expect(symbol).toContain("\u26A0")
    })

    it("returns dim circle for skip", () => {
      const symbol = formatStatusSymbol("skip")
      expect(symbol).toContain("\u25CB")
    })
  })

  describe("formatCheckResult", () => {
    it("includes name and message", () => {
      const result: CheckResult = {
        name: "Test Check",
        status: "pass",
        message: "All good",
      }

      const output = formatCheckResult(result, false)

      expect(output).toContain("Test Check")
      expect(output).toContain("All good")
    })

    it("includes details when verbose", () => {
      const result: CheckResult = {
        name: "Test Check",
        status: "pass",
        message: "OK",
        details: ["Detail 1", "Detail 2"],
      }

      const output = formatCheckResult(result, true)

      expect(output).toContain("Detail 1")
      expect(output).toContain("Detail 2")
    })

    it("hides details when not verbose", () => {
      const result: CheckResult = {
        name: "Test Check",
        status: "pass",
        message: "OK",
        details: ["Detail 1"],
      }

      const output = formatCheckResult(result, false)

      expect(output).not.toContain("Detail 1")
    })
  })

  describe("formatCategoryHeader", () => {
    it("formats category name with styling", () => {
      const header = formatCategoryHeader("installation")

      expect(header).toContain("Installation")
    })
  })

  describe("formatSummary", () => {
    it("shows all counts", () => {
      const summary: DoctorSummary = {
        total: 10,
        passed: 7,
        failed: 1,
        warnings: 2,
        skipped: 0,
        duration: 150,
      }

      const output = formatSummary(summary)

      expect(output).toContain("7 passed")
      expect(output).toContain("1 failed")
      expect(output).toContain("2 warnings")
      expect(output).toContain("10 checks")
      expect(output).toContain("150ms")
    })
  })

  describe("formatHeader", () => {
    it("includes doctor branding", () => {
      const header = formatHeader()

      expect(header).toContain("Doctor")
    })
  })

  describe("formatFooter", () => {
    it("shows error message when failures", () => {
      const summary: DoctorSummary = {
        total: 5,
        passed: 4,
        failed: 1,
        warnings: 0,
        skipped: 0,
        duration: 100,
      }

      const footer = formatFooter(summary)

      expect(footer).toContain("Issues detected")
    })

    it("shows warning message when warnings only", () => {
      const summary: DoctorSummary = {
        total: 5,
        passed: 4,
        failed: 0,
        warnings: 1,
        skipped: 0,
        duration: 100,
      }

      const footer = formatFooter(summary)

      expect(footer).toContain("warnings")
    })

    it("shows success message when all pass", () => {
      const summary: DoctorSummary = {
        total: 5,
        passed: 5,
        failed: 0,
        warnings: 0,
        skipped: 0,
        duration: 100,
      }

      const footer = formatFooter(summary)

      expect(footer).toContain("operational")
    })
  })

  describe("formatJsonOutput", () => {
    it("returns valid JSON", () => {
      const result: DoctorResult = {
        results: [{ name: "Test", status: "pass", message: "OK" }],
        summary: { total: 1, passed: 1, failed: 0, warnings: 0, skipped: 0, duration: 50 },
        exitCode: 0,
      }

      const output = formatJsonOutput(result)
      const parsed = JSON.parse(output)

      expect(parsed.results.length).toBe(1)
      expect(parsed.summary.total).toBe(1)
      expect(parsed.exitCode).toBe(0)
    })
  })

  describe("formatBox", () => {
    it("wraps content in box", () => {
      const box = formatBox("Test content")

      expect(box).toContain("Test content")
      expect(box).toContain("\u2500")
    })

    it("includes title when provided", () => {
      const box = formatBox("Content", "My Title")

      expect(box).toContain("My Title")
    })
  })

  describe("formatHelpSuggestions", () => {
    it("extracts suggestions from failed checks", () => {
      const results: CheckResult[] = [
        { name: "Test", status: "fail", message: "Error", details: ["Run: fix-command"] },
        { name: "OK", status: "pass", message: "Good" },
      ]

      const suggestions = formatHelpSuggestions(results)

      expect(suggestions).toContain("Run: fix-command")
    })

    it("returns empty array when no failures", () => {
      const results: CheckResult[] = [
        { name: "OK", status: "pass", message: "Good" },
      ]

      const suggestions = formatHelpSuggestions(results)

      expect(suggestions.length).toBe(0)
    })
  })
})
