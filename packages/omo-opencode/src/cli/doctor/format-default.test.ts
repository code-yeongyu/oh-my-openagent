import { describe, expect, it } from "bun:test"
import { formatDefault } from "./framework/format-default"
import { stripAnsi } from "./framework/format-shared"
import type { CodexDoctorSummary, DoctorResult } from "./framework/types"

function createBaseResult(): DoctorResult {
  return {
    results: [
      { name: "System", status: "pass", message: "ok", issues: [] },
      { name: "Configuration", status: "pass", message: "ok", issues: [] },
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
      lspServers: [],
      astGrepCli: false,
      commentChecker: false,
      ghCli: { installed: false, authenticated: false, username: null },
      mcpBuiltin: [],
      mcpUser: [],
    },
    summary: { total: 2, passed: 2, failed: 0, warnings: 0, skipped: 0, duration: 10 },
    exitCode: 0,
    latestVersion: null,
  }
}

function createCodexSummary(): CodexDoctorSummary {
  return {
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
      companionPluginEnabled: false,
      companionLifecycleHookStateEvents: [],
    },
    linkedBins: ["omo"],
    agents: ["plan"],
  }
}

describe("formatDefault", () => {
  it("prints the OpenCode edition, installed, latest, and update command when no issues exist", () => {
    //#given
    const result = createBaseResult()
    result.latestVersion = "3.5.0"

    //#when
    const output = stripAnsi(formatDefault(result))

    //#then
    expect(output).toContain("System OK · Edition: OpenCode · Installed: 3.4.0 · Latest: 3.5.0")
    expect(output).toContain("Update: bunx oh-my-openagent install")
    expect(output).not.toContain("found:")
  })

  it("prints 'could not check' for Latest when the OpenCode registry lookup failed", () => {
    //#given
    const result = createBaseResult()
    result.latestVersion = null

    //#when
    const output = stripAnsi(formatDefault(result))

    //#then
    expect(output).toContain("System OK · Edition: OpenCode · Installed: 3.4.0 · Latest: could not check")
    expect(output).toContain("Update: bunx oh-my-openagent install")
  })

  it("prints numbered issue list when issues exist", () => {
    //#given
    const result = createBaseResult()
    result.results = [
      {
        name: "System",
        status: "fail",
        message: "failed",
        issues: [
          {
            title: "OpenCode binary not found",
            description: "Install OpenCode",
            fix: "Install from https://opencode.ai/docs",
            severity: "error",
          },
          {
            title: "Loaded plugin is outdated",
            description: "Loaded 3.0.0, latest 3.4.0",
            severity: "warning",
          },
        ],
      },
    ]

    //#when
    const output = stripAnsi(formatDefault(result))

    //#then
    expect(output).toContain("2 issues found:")
    expect(output).toContain("1. OpenCode binary not found")
    expect(output).toContain("2. Loaded plugin is outdated")
  })

  it("prints the Codex edition, installed, latest, and update command for Codex doctor results", () => {
    //#given
    const result = createBaseResult()
    result.target = "codex"
    result.codex = createCodexSummary()
    result.latestVersion = "4.8.0"

    //#when
    const output = stripAnsi(formatDefault(result))

    //#then
    expect(output).toContain("LazyCodex OK · Edition: Codex · Installed: 4.7.5 · Latest: 4.8.0")
    expect(output).toContain("Update: npx lazycodex-ai install --no-tui --codex-autonomous")
    expect(output).not.toContain("opencode")
  })

  it("prints 'could not check' for Latest when the Codex registry lookup failed", () => {
    //#given
    const result = createBaseResult()
    result.target = "codex"
    result.codex = createCodexSummary()
    result.latestVersion = null

    //#when
    const output = stripAnsi(formatDefault(result))

    //#then
    expect(output).toContain("LazyCodex OK · Edition: Codex · Installed: 4.7.5 · Latest: could not check")
    expect(output).toContain("Update: npx lazycodex-ai install --no-tui --codex-autonomous")
  })
})
