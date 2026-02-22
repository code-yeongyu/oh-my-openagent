import type { DoctorOptions, DoctorResult, CheckDefinition, CheckResult, DoctorSummary } from "./types"
import { getAllCheckDefinitions, gatherSystemInfo, gatherToolsSummary } from "./checks"
import { EXIT_CODES } from "./constants"
import { formatDoctorOutput, formatJsonOutput } from "./formatter"

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

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const start = performance.now()

  const allChecks = getAllCheckDefinitions()
  const [results, systemInfo, tools] = await Promise.all([
    Promise.all(allChecks.map(runCheck)),
    gatherSystemInfo(),
    gatherToolsSummary(),
  ])

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
