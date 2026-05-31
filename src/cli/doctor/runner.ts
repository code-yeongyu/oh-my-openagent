import type { DoctorOptions, DoctorResult, CheckDefinition, CheckResult, DoctorSummary } from "./types"
import { getAllCheckDefinitions, gatherSystemInfo, gatherToolsSummary } from "./checks"
import { EXIT_CODES } from "./constants"
import { formatDoctorOutput, formatJsonOutput } from "./formatter"

const DOCTOR_TIMEOUT_MS = 30_000

class DoctorTimeoutError extends Error {
  constructor() {
    super("Doctor timed out")
    this.name = "DoctorTimeoutError"
  }
}

export async function runCheck(check: CheckDefinition): Promise<CheckResult> {
  const start = performance.now()
  try {
    const result = await check.check()
    result.duration = Math.round(performance.now() - start)
    return result
  } catch (err) {
    return {
      name: check.name,
      status: "fail",
      message: err instanceof Error ? err.message : "Unknown error",
      issues: [{ title: check.name, description: String(err), severity: "error" }],
      duration: Math.round(performance.now() - start),
    }
  }
}

export function calculateSummary(results: CheckResult[], duration: number): DoctorSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    warnings: results.filter((r) => r.status === "warn").length,
    skipped: results.filter((r) => r.status === "skip").length,
    duration: Math.round(duration),
  }
}

export function determineExitCode(results: CheckResult[]): number {
  return results.some((r) => r.status === "fail") ? EXIT_CODES.FAILURE : EXIT_CODES.SUCCESS
}

function buildTimeoutResult(start: number, options: DoctorOptions): DoctorResult {
  const timeoutResult: DoctorResult = {
    results: [{ name: "Timeout", status: "fail", message: "Doctor timed out after 30s", issues: [{ title: "Doctor timeout", description: "Checks did not complete within 30s. A subprocess may be hanging.", severity: "error" }] }],
    systemInfo: { opencodeVersion: null, opencodePath: null, pluginVersion: null, loadedVersion: null, bunVersion: null, configPath: null, configValid: false, isLocalDev: false },
    tools: { lspServers: [], astGrepCli: false, astGrepNapi: false, commentChecker: false, ghCli: { installed: false, authenticated: false, username: null }, mcpBuiltin: [], mcpUser: [] },
    summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0, duration: Math.round(performance.now() - start) },
    exitCode: EXIT_CODES.FAILURE,
  }

  if (options.json) {
    console.log(formatJsonOutput(timeoutResult))
  } else {
    console.error("\nDoctor timed out after 30s. A subprocess may be hanging.")
    console.error("Try running with --verbose to identify the stuck check.\n")
  }

  return timeoutResult
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const start = performance.now()

  const allChecks = getAllCheckDefinitions()

  const checksPromise = Promise.all([
    Promise.all(allChecks.map(runCheck)),
    gatherSystemInfo(),
    gatherToolsSummary(),
  ])

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DoctorTimeoutError()), DOCTOR_TIMEOUT_MS)
  })

  let results: CheckResult[]
  let systemInfo: Awaited<ReturnType<typeof gatherSystemInfo>>
  let tools: Awaited<ReturnType<typeof gatherToolsSummary>>

  try {
    ;[results, systemInfo, tools] = await Promise.race([checksPromise, timeoutPromise])
  } catch (error) {
    clearTimeout(timer)
    if (error instanceof DoctorTimeoutError) {
      return buildTimeoutResult(start, options)
    }
    throw error
  }

  clearTimeout(timer)

  const duration = performance.now() - start
  const summary = calculateSummary(results, duration)
  const exitCode = determineExitCode(results)

  const doctorResult: DoctorResult = {
    results,
    systemInfo,
    tools,
    summary,
    exitCode,
  }

  if (options.json) {
    console.log(formatJsonOutput(doctorResult))
  } else {
    console.log(formatDoctorOutput(doctorResult, options.mode))
  }

  return doctorResult
}
