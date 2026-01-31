/**
 * Test Executor for TDD Guard
 *
 * Executes tests to verify RED phase has failing tests.
 * Supports multiple test runners with auto-detection.
 */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { TestExecutionResult, TestExecutionConfig } from "./types"

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Detect the test command based on project files
 */
export function detectTestCommand(cwd: string): string | null {
  // Check for bun
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bunfig.toml"))) {
    return "bun test"
  }

  // Check for pnpm
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm test"
  }

  // Check for yarn
  if (existsSync(join(cwd, "yarn.lock"))) {
    return "yarn test"
  }

  // Check for npm (package.json with test script)
  const packageJsonPath = join(cwd, "package.json")
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = require(packageJsonPath)
      if (packageJson.scripts?.test) {
        return "npm test"
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check for Python pytest
  if (existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "pyproject.toml"))) {
    return "pytest"
  }

  // Check for Go
  if (existsSync(join(cwd, "go.mod"))) {
    return "go test ./..."
  }

  return null
}

/**
 * Execute tests and check if any are failing
 *
 * @param config - Test execution configuration
 * @returns Test execution result
 */
export function executeTests(config: TestExecutionConfig): TestExecutionResult {
  // If real execution is disabled, return conservative result
  if (!config.enableRealExecution) {
    return {
      hasFailingTests: false,
      timedOut: false,
      noTestsFound: false,
      error: "Real test execution is disabled",
    }
  }

  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS
  const testCommand = config.testCommand || detectTestCommand(config.cwd)

  if (!testCommand) {
    return {
      hasFailingTests: false,
      timedOut: false,
      noTestsFound: true,
      error: "No test command detected",
    }
  }

  const startTime = Date.now()

  try {
    // Parse command into executable and args
    const parts = testCommand.split(" ")
    const command = parts[0]
    const args = parts.slice(1)

    // Execute test command synchronously with timeout
    const result = spawnSync(command, args, {
      cwd: config.cwd,
      timeout: timeoutMs,
      shell: true,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })

    const executionTimeMs = Date.now() - startTime

    // Check if timed out
    if (result.signal === "SIGTERM" || result.signal === "SIGKILL") {
      return {
        hasFailingTests: true, // Conservative: assume failing on timeout
        timedOut: true,
        noTestsFound: false,
        executionTimeMs,
      }
    }

    // Check exit code - non-zero means tests failed
    const hasFailingTests = result.status !== 0

    // Check for "no tests found" patterns in output
    const output = (result.stdout || "") + (result.stderr || "")
    const noTestsPatterns = [
      /no tests? (found|to run)/i,
      /0 tests?/i,
      /no test files/i,
    ]
    const noTestsFound = noTestsPatterns.some((pattern) => pattern.test(output))

    return {
      hasFailingTests: noTestsFound ? false : hasFailingTests,
      timedOut: false,
      noTestsFound,
      executionTimeMs,
    }
  } catch (error) {
    return {
      hasFailingTests: true, // Conservative: assume failing on error
      timedOut: false,
      noTestsFound: false,
      error: error instanceof Error ? error.message : String(error),
      executionTimeMs: Date.now() - startTime,
    }
  }
}

/**
 * Check if there are failing tests for a specific file
 *
 * @param filePath - Path to the source file being edited
 * @param config - Test execution configuration
 * @returns Whether there are failing tests
 */
export async function hasFailingTestForFile(
  filePath: string,
  config: TestExecutionConfig
): Promise<boolean> {
  // For now, run all tests - in the future, could run only related tests
  const result = executeTests(config)

  // Return true if there are failing tests (allows edit)
  // Return false if all tests pass (blocks edit - need to write failing test first)
  return result.hasFailingTests
}
