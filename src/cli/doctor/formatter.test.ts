import { afterEach, describe, expect, it, mock } from "bun:test"
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

describe("formatter", () => {
  afterEach(() => {
    mock.restore()
  })

  describe("formatDoctorOutput", () => {
    it("dispatches to default formatter for default mode", async () => {
      //#given
      const formatDefaultMock = mock(() => "default-output")
      const formatStatusMock = mock(() => "status-output")
      const formatVerboseMock = mock(() => "verbose-output")
      mock.module("./format-default", () => ({ formatDefault: formatDefaultMock }))
      mock.module("./format-status", () => ({ formatStatus: formatStatusMock }))
      mock.module("./format-verbose", () => ({ formatVerbose: formatVerboseMock }))
      const { formatDoctorOutput } = await import(`./formatter?default=${Date.now()}`)

      //#when
      const output = formatDoctorOutput(createDoctorResult(), "default")

      //#then
      expect(output).toBe("default-output")
      expect(formatDefaultMock).toHaveBeenCalledTimes(1)
      expect(formatStatusMock).toHaveBeenCalledTimes(0)
      expect(formatVerboseMock).toHaveBeenCalledTimes(0)
    })

    it("dispatches to status formatter for status mode", async () => {
      //#given
      const formatDefaultMock = mock(() => "default-output")
      const formatStatusMock = mock(() => "status-output")
      const formatVerboseMock = mock(() => "verbose-output")
      mock.module("./format-default", () => ({ formatDefault: formatDefaultMock }))
      mock.module("./format-status", () => ({ formatStatus: formatStatusMock }))
      mock.module("./format-verbose", () => ({ formatVerbose: formatVerboseMock }))
      const { formatDoctorOutput } = await import(`./formatter?status=${Date.now()}`)

      //#when
      const output = formatDoctorOutput(createDoctorResult(), "status")

      //#then
      expect(output).toBe("status-output")
      expect(formatDefaultMock).toHaveBeenCalledTimes(0)
      expect(formatStatusMock).toHaveBeenCalledTimes(1)
      expect(formatVerboseMock).toHaveBeenCalledTimes(0)
    })

    it("dispatches to verbose formatter for verbose mode", async () => {
      //#given
      const formatDefaultMock = mock(() => "default-output")
      const formatStatusMock = mock(() => "status-output")
      const formatVerboseMock = mock(() => "verbose-output")
      mock.module("./format-default", () => ({ formatDefault: formatDefaultMock }))
      mock.module("./format-status", () => ({ formatStatus: formatStatusMock }))
      mock.module("./format-verbose", () => ({ formatVerbose: formatVerboseMock }))
      const { formatDoctorOutput } = await import(`./formatter?verbose=${Date.now()}`)

      //#when
      const output = formatDoctorOutput(createDoctorResult(), "verbose")

      //#then
      expect(output).toBe("verbose-output")
      expect(formatDefaultMock).toHaveBeenCalledTimes(0)
      expect(formatStatusMock).toHaveBeenCalledTimes(0)
      expect(formatVerboseMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("formatJsonOutput", () => {
    it("returns valid JSON payload", async () => {
      //#given
      const { formatJsonOutput } = await import(`./formatter?json=${Date.now()}`)
      const result = createDoctorResult()

      //#when
      const output = formatJsonOutput(result)
      const parsed = JSON.parse(output) as DoctorResult

      //#then
      expect(parsed.summary.total).toBe(2)
      expect(parsed.systemInfo.pluginVersion).toBe("3.4.0")
      expect(parsed.tools.ghCli.username).toBe("yeongyu")
      expect(parsed.exitCode).toBe(0)
    })
  })
})
