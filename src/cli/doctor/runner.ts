import type {
  DoctorOptions,
  DoctorResult,
  CheckDefinition,
  CheckResult,
  DoctorSummary,
  CheckCategory,
} from "./types"
import { getAllCheckDefinitions } from "./checks"
import { EXIT_CODES, CATEGORY_NAMES } from "./constants"
import {
  formatHeader,
  formatCategoryHeader,
  formatCheckResult,
  formatSummary,
  formatFooter,
  formatJsonOutput,
} from "./formatter"

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
  const hasFailures = results.some((r) => r.status === "fail")
  return hasFailures ? EXIT_CODES.FAILURE : EXIT_CODES.SUCCESS
}

export function filterChecksByCategory(
  checks: CheckDefinition[],
  category?: CheckCategory
): CheckDefinition[] {
  if (!category) return checks
  return checks.filter((c) => c.category === category)
}

export function groupChecksByCategory(
  checks: CheckDefinition[]
): Map<CheckCategory, CheckDefinition[]> {
  const groups = new Map<CheckCategory, CheckDefinition[]>()

  for (const check of checks) {
    const existing = groups.get(check.category) ?? []
    existing.push(check)
    groups.set(check.category, existing)
  }

  return groups
}

const CATEGORY_ORDER: CheckCategory[] = [
  "installation",
  "configuration",
  "authentication",
  "dependencies",
  "tools",
  "updates",
]

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const start = performance.now()
  const allChecks = getAllCheckDefinitions()
  const filteredChecks = filterChecksByCategory(allChecks, options.category)
  const groupedChecks = groupChecksByCategory(filteredChecks)

  const results: CheckResult[] = []

  if (!options.json) {
    console.log(formatHeader())
  }

  for (const category of CATEGORY_ORDER) {
    const checks = groupedChecks.get(category)
    if (!checks || checks.length === 0) continue

    if (!options.json) {
      console.log(formatCategoryHeader(category))
    }

    for (const check of checks) {
      const result = await runCheck(check)
      results.push(result)

      if (!options.json) {
        console.log(formatCheckResult(result, options.verbose ?? false))
      }
    }
  }

  const duration = performance.now() - start
  const summary = calculateSummary(results, duration)
  const exitCode = determineExitCode(results)

  const doctorResult: DoctorResult = {
    results,
    summary,
    exitCode,
  }

  if (options.json) {
    console.log(formatJsonOutput(doctorResult))
  } else {
    console.log("")
    console.log(formatSummary(summary))
    console.log(formatFooter(summary))
  }

  return doctorResult
}
