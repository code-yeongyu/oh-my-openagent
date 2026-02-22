import { afterEach, describe, expect, it, mock } from "bun:test"
import type { CheckDefinition, CheckResult, DoctorResult, SystemInfo, ToolsSummary } from "./types"

function createSystemInfo(): SystemInfo {
  return {
    opencodeVersion: "1.0.200",
    opencodePath: "/usr/local/bin/opencode",
    pluginVersion: "3.4.0",
    loadedVersion: "3.4.0",
    bunVersion: "1.2.0",
    configPath: "/tmp/opencode.json",
    configValid: true,
    isLocalDev: false,
  }
}

function createTools(): ToolsSummary {
  return {
    lspInstalled: 1,
    lspTotal: 4,
    astGrepCli: true,
    astGrepNapi: false,
    commentChecker: true,
    ghCli: { installed: true, authenticated: true, username: "yeongyu" },
    mcpBuiltin: ["context7"],
    mcpUser: ["custom-mcp"],
  }
}

function createPassResult(name: string): CheckResult {
  return { name, status: "pass", message: "ok", issues: [] }
}

function createDeferred(): {
  promise: Promise<CheckResult>
  resolve: (value: CheckResult) => void
} {
  let resolvePromise: (value: CheckResult) => void = () => {}
  const promise = new Promise<CheckResult>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe("runner", () => {
  afterEach(() => {
    mock.restore()
  })

  describe("runCheck", () => {
    it("returns fail result with issue when check throws", async () => {
      //#given
      const check: CheckDefinition = {
        id: "system",
        name: "System",
        check: async () => {
          throw new Error("boom")
        },
      }
      const { runCheck } = await import(`./runner?run-check-error=${Date.now()}`)

      //#when
      const result = await runCheck(check)

      //#then
      expect(result.status).toBe("fail")
      expect(result.message).toBe("boom")
      expect(result.issues[0]?.title).toBe("System")
      expect(result.issues[0]?.severity).toBe("error")
      expect(typeof result.duration).toBe("number")
    })
  })

  describe("calculateSummary", () => {
    it("counts statuses correctly", async () => {
      //#given
      const { calculateSummary } = await import(`./runner?summary=${Date.now()}`)
      const results: CheckResult[] = [
        { name: "1", status: "pass", message: "", issues: [] },
        { name: "2", status: "pass", message: "", issues: [] },
        { name: "3", status: "fail", message: "", issues: [] },
        { name: "4", status: "warn", message: "", issues: [] },
        { name: "5", status: "skip", message: "", issues: [] },
      ]

      //#when
      const summary = calculateSummary(results, 19.9)

      //#then
      expect(summary.total).toBe(5)
      expect(summary.passed).toBe(2)
      expect(summary.failed).toBe(1)
      expect(summary.warnings).toBe(1)
      expect(summary.skipped).toBe(1)
      expect(summary.duration).toBe(20)
    })
  })

  describe("determineExitCode", () => {
    it("returns zero when no failures exist", async () => {
      //#given
      const { determineExitCode } = await import(`./runner?exit-ok=${Date.now()}`)
      const results: CheckResult[] = [
        { name: "1", status: "pass", message: "", issues: [] },
        { name: "2", status: "warn", message: "", issues: [] },
      ]

      //#when
      const code = determineExitCode(results)

      //#then
      expect(code).toBe(0)
    })

    it("returns one when any failure exists", async () => {
      //#given
      const { determineExitCode } = await import(`./runner?exit-fail=${Date.now()}`)
      const results: CheckResult[] = [
        { name: "1", status: "pass", message: "", issues: [] },
        { name: "2", status: "fail", message: "", issues: [] },
      ]

      //#when
      const code = determineExitCode(results)

      //#then
      expect(code).toBe(1)
    })
  })

  describe("runDoctor", () => {
    it("starts all checks in parallel and returns collected result", async () => {
      //#given
      const startedChecks: string[] = []
      const deferredOne = createDeferred()
      const deferredTwo = createDeferred()
      const deferredThree = createDeferred()
      const deferredFour = createDeferred()

      const checks: CheckDefinition[] = [
        {
          id: "system",
          name: "System",
          check: async () => {
            startedChecks.push("system")
            return deferredOne.promise
          },
        },
        {
          id: "config",
          name: "Configuration",
          check: async () => {
            startedChecks.push("config")
            return deferredTwo.promise
          },
        },
        {
          id: "tools",
          name: "Tools",
          check: async () => {
            startedChecks.push("tools")
            return deferredThree.promise
          },
        },
        {
          id: "models",
          name: "Models",
          check: async () => {
            startedChecks.push("models")
            return deferredFour.promise
          },
        },
      ]

      const expectedResult: DoctorResult = {
        results: [
          createPassResult("System"),
          createPassResult("Configuration"),
          createPassResult("Tools"),
          createPassResult("Models"),
        ],
        systemInfo: createSystemInfo(),
        tools: createTools(),
        summary: {
          total: 4,
          passed: 4,
          failed: 0,
          warnings: 0,
          skipped: 0,
          duration: 0,
        },
        exitCode: 0,
      }

      const formatDoctorOutputMock = mock((result: DoctorResult) => result.summary.total.toString())
      const formatJsonOutputMock = mock((result: DoctorResult) => JSON.stringify(result))

      mock.module("./checks", () => ({
        getAllCheckDefinitions: () => checks,
        gatherSystemInfo: async () => expectedResult.systemInfo,
        gatherToolsSummary: async () => expectedResult.tools,
      }))
      mock.module("./formatter", () => ({
        formatDoctorOutput: formatDoctorOutputMock,
        formatJsonOutput: formatJsonOutputMock,
      }))

      const logSpy = mock(() => {})
      const originalLog = console.log
      console.log = logSpy

      const { runDoctor } = await import(`./runner?parallel=${Date.now()}`)
      const runPromise = runDoctor({ mode: "default" })

      //#when
      await Promise.resolve()
      const startedBeforeResolve = [...startedChecks]
      deferredOne.resolve(createPassResult("System"))
      deferredTwo.resolve(createPassResult("Configuration"))
      deferredThree.resolve(createPassResult("Tools"))
      deferredFour.resolve(createPassResult("Models"))
      const result = await runPromise

      //#then
      console.log = originalLog
      expect(startedBeforeResolve.sort()).toEqual(["config", "models", "system", "tools"])
      expect(result.results.length).toBe(4)
      expect(result.exitCode).toBe(0)
      expect(formatDoctorOutputMock).toHaveBeenCalledTimes(1)
      expect(formatJsonOutputMock).toHaveBeenCalledTimes(0)
    })
  })
})
