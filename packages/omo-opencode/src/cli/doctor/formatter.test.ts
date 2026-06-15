import { describe, expect, it } from "bun:test"
import { stripAnsi } from "./framework/format-shared"
import type { DoctorResult } from "./framework/types"

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
      lspServers: [
        { id: "typescript", extensions: [".ts", ".tsx", ".js", ".jsx"] },
        { id: "pyright", extensions: [".py", ".pyi"] },
      ],
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

function createDoctorResultWithDetails(): DoctorResult {
  const base = createDoctorResult()
  base.results = [
    ...base.results,
    {
      name: "Models",
      status: "pass",
      message: "2 agents, 1 category, 0 overrides",
      details: ["Available models: openai/gpt-5.4", "Agent sisyphus -> openai/gpt-5.4"],
      issues: [],
    },
  ]
  base.summary.total = 3
  base.summary.passed = 2
  return base
}

function createCodexDoctorResult(): DoctorResult {
  const base = createDoctorResult()
  base.target = "codex"
  base.codex = {
    codexPath: "/usr/local/bin/codex",
    codexSource: "cli",
    codexAppId: null,
    marketplaceName: "sisyphuslabs",
    pluginName: "omo",
    pluginVersion: "4.7.5",
    pluginVersionStamped: true,
    installerVersion: "4.7.5",
    packageName: "lazycodex-ai",
    packageVersion: "4.7.5",
    pluginRoot: "/tmp/omo",
    configPath: "/tmp/config.toml",
    config: {
      exists: true,
      marketplaceConfigured: true,
      pluginEnabled: true,
      pluginsFeatureEnabled: true,
      pluginHooksFeatureEnabled: true,
    },
    linkedBins: ["omo", "omo-rules"],
    agents: ["plan"],
  }
  return base
}

describe("formatDoctorOutput", () => {
  describe("#given default mode", () => {
    it("shows System OK when no issues", async () => {
      //#given
      const result = createDoctorResult()
      const { formatDoctorOutput } = await import(`./framework/formatter?default-ok-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "default"))

      //#then
      expect(output).toContain("System OK (opencode 1.0.200 · oh-my-openagent 3.4.0)")
    })

    it("shows issue count and details when issues exist", async () => {
      //#given
      const result = createDoctorResultWithIssues()
      const { formatDoctorOutput } = await import(`./framework/formatter?default-issues-${Date.now()}`)

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
      const { formatDoctorOutput } = await import(`./framework/formatter?status-ver-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "status"))

      //#then
      expect(output).toContain("1.0.200 · 3.4.0 · Bun 1.2.0")
    })

    it("renders tool and MCP info", async () => {
      //#given
      const result = createDoctorResult()
      const { formatDoctorOutput } = await import(`./framework/formatter?status-tools-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "status"))

      //#then
      expect(output).toContain("LSP")
      expect(output).toContain("context7")
    })

    it("renders Codex plugin status for Codex target", async () => {
      //#given
      const result = createCodexDoctorResult()
      const { formatDoctorOutput } = await import(`./framework/formatter?status-codex-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "status"))

      //#then
      expect(output).toContain("Codex")
      expect(output).toContain("/usr/local/bin/codex")
      expect(output).toContain("Plugin     omo@4.7.5")
      expect(output).toContain("Package    lazycodex-ai@4.7.5")
      expect(output).toContain("Bins       omo · omo-rules")
      expect(output).not.toContain("opencode")
    })
  })

  describe("#given verbose mode", () => {
    it("includes all section headers", async () => {
      //#given
      const result = createDoctorResult()
      const { formatDoctorOutput } = await import(`./framework/formatter?verbose-headers-${Date.now()}`)

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
      const { formatDoctorOutput } = await import(`./framework/formatter?verbose-summary-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "verbose"))

      //#then
      expect(output).toContain("1 passed")
      expect(output).toContain("0 failed")
      expect(output).toContain("1 warnings")
    })

    it("renders check details sections such as Models", async () => {
      //#given
      const result = createDoctorResultWithDetails()
      const { formatDoctorOutput } = await import(`./framework/formatter?verbose-details-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "verbose"))

      //#then
      expect(output).toContain("Models")
      expect(output).toContain("Available models: openai/gpt-5.4")
      expect(output).toContain("Agent sisyphus -> openai/gpt-5.4")
    })

    it("renders Codex sections for Codex target", async () => {
      //#given
      const result = createCodexDoctorResult()
      const { formatDoctorOutput } = await import(`./framework/formatter?verbose-codex-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "verbose"))

      //#then
      expect(output).toContain("Codex Information")
      expect(output).toContain("marketplace sisyphuslabs")
      expect(output).toContain("plugin     omo@4.7.5")
      expect(output).toContain("package    lazycodex-ai@4.7.5")
      expect(output).not.toContain("OpenCode")
    })

    it("marks Codex marketplace as failing when config is missing the marketplace", async () => {
      //#given
      const result = createCodexDoctorResult()
      if (result.codex) {
        result.codex = {
          ...result.codex,
          config: { ...result.codex.config, marketplaceConfigured: false },
        }
      }
      const { formatDoctorOutput } = await import(`./framework/formatter?verbose-codex-marketplace-${Date.now()}`)

      //#when
      const output = stripAnsi(formatDoctorOutput(result, "verbose"))

      //#then
      expect(output).toContain("✗ marketplace sisyphuslabs")
    })
  })

  describe("formatJsonOutput", () => {
    it("returns valid JSON", async () => {
      //#given
      const result = createDoctorResult()
      const { formatJsonOutput } = await import(`./framework/formatter?json-valid-${Date.now()}`)

      //#when
      const output = formatJsonOutput(result)

      //#then
      expect(() => JSON.parse(output)).not.toThrow()
    })

    it("preserves all result fields", async () => {
      //#given
      const result = createDoctorResult()
      const { formatJsonOutput } = await import(`./framework/formatter?json-fields-${Date.now()}`)

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
