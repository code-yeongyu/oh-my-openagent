import { describe, expect, it } from "bun:test"
import { stripAnsi } from "./format-shared"
import type { DoctorResult } from "./types"

function createDoctorResult(): DoctorResult {
  return {
    results: [
      { name: "System", status: "pass", message: "ok", issues: [] },
      { name: "Configuration", status: "warn", message: "warn", issues: [] },
    ],
    systemInfo: {
      opencodeVersion: "1.0.200",
      opencodePath: "/usr/local/bin/opencode",
      pluginVersion: "3.4.0",
      loadedVersion: "3.4.0",
      bunVersion: "1.2.0",
      configPath: "/tmp/opencode.jsonc",
      configValid: true,
      isLocalDev: false,
    },
    tools: {
      lspInstalled: 2,
      lspTotal: 4,
      astGrepCli: true,
      astGrepNapi: false,
      commentChecker: true,
      ghCli: { installed: true, authenticated: true, username: "yeongyu" },
      mcpBuiltin: ["context7", "grep_app"],
      mcpUser: ["custom"],
    },
    summary: {
      total: 2,
      passed: 1,
      failed: 0,
      warnings: 1,
      skipped: 0,
      duration: 12,
    },
    exitCode: 0,
  }
}

function createDoctorResultWithIssues(): DoctorResult {
  const base = createDoctorResult()
  base.results[1].issues = [
    { title: "Config issue", description: "Bad config", severity: "error" as const, fix: "Fix it" },
    { title: "Tool warning", description: "Missing tool", severity: "warning" as const },
  ]
  base.summary.failed = 1
  base.summary.warnings = 1
  return base
}

describe("formatDoctorOutput", () => {
  describe("#given default mode", () => {
    it("shows System OK when no issues", async () => {
      //#given
      const result = createDoctorResult()
      const { formatDoctorOutput } = await import(`./formatter?default-ok-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "default"))

      //#then
      expect(output).toContain("System OK (opencode 1.0.200 · oh-my-opencode 3.4.0)")
    })

    it("shows issue count and details when issues exist", async () => {
      //#given
      const result = createDoctorResultWithIssues()
      const { formatDoctorOutput } = await import(`./formatter?default-issues-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "default"))

      //#then
      expect(output).toContain("issues found:")
      expect(output).toContain("1. Config issue")
      expect(output).toContain("2. Tool warning")
    })
  })

  describe("#given status mode", () => {
    it("renders system version line", async () => {
      //#given
      const result = createDoctorResult()
      const { formatDoctorOutput } = await import(`./formatter?status-ver-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "status"))

      //#then
      expect(output).toContain("1.0.200 · 3.4.0 · Bun 1.2.0")
    })

    it("renders tool and MCP info", async () => {
      //#given
      const result = createDoctorResult()
      const { formatDoctorOutput } = await import(`./formatter?status-tools-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "status"))

      //#then
      expect(output).toContain("LSP 2/4")
      expect(output).toContain("context7")
    })
  })

  describe("#given verbose mode", () => {
    it("includes all section headers", async () => {
      //#given
      const result = createDoctorResult()
      const { formatDoctorOutput } = await import(`./formatter?verbose-headers-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "verbose"))

      //#then
      expect(output).toContain("System Information")
      expect(output).toContain("Configuration")
      expect(output).toContain("Tools")
      expect(output).toContain("MCPs")
      expect(output).toContain("Summary")
    })

    it("shows check summary counts", async () => {
      //#given
      const result = createDoctorResult()
      const { formatDoctorOutput } = await import(`./formatter?verbose-summary-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "verbose"))

      //#then
      expect(output).toContain("1 passed")
      expect(output).toContain("0 failed")
      expect(output).toContain("1 warnings")
    })
  })

  describe("formatJsonOutput", () => {
    it("returns valid JSON", async () => {
      //#given
      const result = createDoctorResult()
      const { formatJsonOutput } = await import(`./formatter?json-valid-${Date.now()}`)

      //#when
      const output = formatJsonOutput(result)

      //#then
      expect(() => JSON.parse(output)).not.toThrow()
    })

    it("preserves all result fields", async () => {
      //#given
      const result = createDoctorResult()
      const { formatJsonOutput } = await import(`./formatter?json-fields-${Date.now()}`)

      //#when
      const output = formatJsonOutput(result)
      const parsed = JSON.parse(output) as DoctorResult

      //#then
      expect(parsed.summary.total).toBe(2)
      expect(parsed.systemInfo.pluginVersion).toBe("3.4.0")
      expect(parsed.exitCode).toBe(0)
    })
  })
})
