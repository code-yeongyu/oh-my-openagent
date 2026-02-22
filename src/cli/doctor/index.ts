import type { DoctorOptions } from "./types"
import { runDoctor } from "./runner"
import { runTests } from "../test-runner"
import type { DoctorResult } from "./types"

export interface DoctorDependencies {
  runDoctorFn: (options: DoctorOptions) => Promise<DoctorResult>
  runTestsFn: typeof runTests
  logFn: (message?: string) => void
}

function printTestSummary(
  logFn: (message?: string) => void,
  total: number,
  passed: number,
  failed: number,
  skipped: number,
  duration: number
): void {
  logFn("")
  logFn("Test Runner")
  logFn(`  Total: ${total}`)
  logFn(`  Passed: ${passed}`)
  logFn(`  Failed: ${failed}`)
  logFn(`  Skipped: ${skipped}`)
  logFn(`  Duration: ${duration}ms`)
}

const defaultDependencies: DoctorDependencies = {
  runDoctorFn: runDoctor,
  runTestsFn: runTests,
  logFn: console.log,
}

export async function runDoctorWithTests(
  options: DoctorOptions = {},
  dependencies: DoctorDependencies = defaultDependencies
): Promise<number> {
  const result = await dependencies.runDoctorFn(options)

  if (!options.test) {
    return result.exitCode
  }

  const testResult = await dependencies.runTestsFn({ verbose: options.verbose })

  if (!options.json) {
    printTestSummary(
      dependencies.logFn,
      testResult.total,
      testResult.passed,
      testResult.failed,
      testResult.skipped,
      testResult.duration
    )

    if (testResult.failureDetails.length > 0) {
      dependencies.logFn("")
      dependencies.logFn("Failure Details")
      for (const failure of testResult.failureDetails) {
        dependencies.logFn(`  - ${failure}`)
      }
    }
  }

  if (result.exitCode !== 0 || testResult.failed > 0) {
    return 1
  }

  return 0
}

export async function doctor(options: DoctorOptions = {}): Promise<number> {
  return runDoctorWithTests(options)
}

export * from "./types"
export { runDoctor } from "./runner"
export { formatJsonOutput } from "./formatter"
