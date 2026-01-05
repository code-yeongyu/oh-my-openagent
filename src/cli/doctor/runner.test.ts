import { describe, it, expect, spyOn, afterEach } from "bun:test"
import {
  runCheck,
  calculateSummary,
  determineExitCode,
  filterChecksByCategory,
  groupChecksByCategory,
} from "./runner"
import type { CheckResult, CheckDefinition, CheckCategory } from "./types"

describe("runner", () => {
  describe("runCheck", () => {
    it("returns result from check function", async () => {
      const check: CheckDefinition = {
        id: "test",
        name: "Test Check",
        category: "installation",
        check: async () => ({ name: "Test Check", status: "pass", message: "OK" }),
      }

      const result = await runCheck(check)

      expect(result.name).toBe("Test Check")
      expect(result.status).toBe("pass")
    })

    it("measures duration", async () => {
      const check: CheckDefinition = {
        id: "test",
        name: "Test Check",
        category: "installation",
        check: async () => {
          await new Promise((r) => setTimeout(r, 50))
          return { name: "Test", status: "pass", message: "OK" }
        },
      }

      const result = await runCheck(check)

      expect(result.duration).toBeGreaterThanOrEqual(10)
    })

    it("returns fail on error", async () => {
      const check: CheckDefinition = {
        id: "test",
        name: "Test Check",
        category: "installation",
        check: async () => {
          throw new Error("Test error")
        },
      }

      const result = await runCheck(check)

      expect(result.status).toBe("fail")
      expect(result.message).toContain("Test error")
    })
  })

  describe("calculateSummary", () => {
    it("counts each status correctly", () => {
      const results: CheckResult[] = [
        { name: "1", status: "pass", message: "" },
        { name: "2", status: "pass", message: "" },
        { name: "3", status: "fail", message: "" },
        { name: "4", status: "warn", message: "" },
        { name: "5", status: "skip", message: "" },
      ]

      const summary = calculateSummary(results, 100)

      expect(summary.total).toBe(5)
      expect(summary.passed).toBe(2)
      expect(summary.failed).toBe(1)
      expect(summary.warnings).toBe(1)
      expect(summary.skipped).toBe(1)
      expect(summary.duration).toBe(100)
    })
  })

  describe("determineExitCode", () => {
    it("returns 0 when all pass", () => {
      const results: CheckResult[] = [
        { name: "1", status: "pass", message: "" },
        { name: "2", status: "pass", message: "" },
      ]

      expect(determineExitCode(results)).toBe(0)
    })

    it("returns 0 when only warnings", () => {
      const results: CheckResult[] = [
        { name: "1", status: "pass", message: "" },
        { name: "2", status: "warn", message: "" },
      ]

      expect(determineExitCode(results)).toBe(0)
    })

    it("returns 1 when any failures", () => {
      const results: CheckResult[] = [
        { name: "1", status: "pass", message: "" },
        { name: "2", status: "fail", message: "" },
      ]

      expect(determineExitCode(results)).toBe(1)
    })
  })

  describe("filterChecksByCategory", () => {
    const checks: CheckDefinition[] = [
      { id: "1", name: "Install", category: "installation", check: async () => ({ name: "", status: "pass", message: "" }) },
      { id: "2", name: "Config", category: "configuration", check: async () => ({ name: "", status: "pass", message: "" }) },
      { id: "3", name: "Auth", category: "authentication", check: async () => ({ name: "", status: "pass", message: "" }) },
    ]

    it("returns all checks when no category", () => {
      const filtered = filterChecksByCategory(checks)

      expect(filtered.length).toBe(3)
    })

    it("filters to specific category", () => {
      const filtered = filterChecksByCategory(checks, "installation")

      expect(filtered.length).toBe(1)
      expect(filtered[0].name).toBe("Install")
    })
  })

  describe("groupChecksByCategory", () => {
    const checks: CheckDefinition[] = [
      { id: "1", name: "Install1", category: "installation", check: async () => ({ name: "", status: "pass", message: "" }) },
      { id: "2", name: "Install2", category: "installation", check: async () => ({ name: "", status: "pass", message: "" }) },
      { id: "3", name: "Config", category: "configuration", check: async () => ({ name: "", status: "pass", message: "" }) },
    ]

    it("groups checks by category", () => {
      const groups = groupChecksByCategory(checks)

      expect(groups.get("installation")?.length).toBe(2)
      expect(groups.get("configuration")?.length).toBe(1)
    })

    it("maintains order within categories", () => {
      const groups = groupChecksByCategory(checks)
      const installChecks = groups.get("installation")!

      expect(installChecks[0].name).toBe("Install1")
      expect(installChecks[1].name).toBe("Install2")
    })
  })
})
