import { describe, expect, it } from "bun:test"
import { formatDefault } from "./format-default"
import { stripAnsi } from "./format-shared"
import type { DoctorResult } from "./types"

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
      lspInstalled: 0,
      lspTotal: 0,
      astGrepCli: false,
      astGrepNapi: false,
      commentChecker: false,
      ghCli: { installed: false, authenticated: false, username: null },
      mcpBuiltin: [],
      mcpUser: [],
    },
    summary: { total: 2, passed: 2, failed: 0, warnings: 0, skipped: 0, duration: 10 },
    exitCode: 0,
  }
}

describe("formatDefault", () => {
  it("prints a single System OK line when no issues exist", () => {
    //#given
    const result = createBaseResult()

    //#when
    const output = stripAnsi(formatDefault(result))

    //#then
    expect(output).toContain("System OK (opencode 1.0.200")
    expect(output).not.toContain("found:")
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
})
