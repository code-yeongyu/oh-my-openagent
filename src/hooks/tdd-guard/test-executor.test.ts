/**
 * Test Executor Tests
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { detectTestCommand, executeTests } from "./test-executor"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("Test Executor", () => {
  let testDir: string

  beforeEach(() => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `tdd-guard-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up - retry on Windows due to file lock issues
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors on Windows
      }
    }
  })

  describe("detectTestCommand", () => {
    test("should detect bun test for bun projects", () => {
      // #given - a project with bun.lockb
      writeFileSync(join(testDir, "bun.lockb"), "")

      // #when - detecting test command
      const command = detectTestCommand(testDir)

      // #then - should return bun test
      expect(command).toBe("bun test")
    })

    test("should detect pnpm test for pnpm projects", () => {
      // #given - a project with pnpm-lock.yaml
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "")

      // #when - detecting test command
      const command = detectTestCommand(testDir)

      // #then - should return pnpm test
      expect(command).toBe("pnpm test")
    })

    test("should detect yarn test for yarn projects", () => {
      // #given - a project with yarn.lock
      writeFileSync(join(testDir, "yarn.lock"), "")

      // #when - detecting test command
      const command = detectTestCommand(testDir)

      // #then - should return yarn test
      expect(command).toBe("yarn test")
    })

    test("should detect npm test for npm projects with test script", () => {
      // #given - a project with package.json containing test script
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: { test: "jest" } })
      )

      // #when - detecting test command
      const command = detectTestCommand(testDir)

      // #then - should return npm test
      expect(command).toBe("npm test")
    })

    test("should return null when no test runner is detected", () => {
      // #given - an empty directory

      // #when - detecting test command
      const command = detectTestCommand(testDir)

      // #then - should return null
      expect(command).toBeNull()
    })
  })

  describe("executeTests", () => {
    test("should return false for hasFailingTests when execution is disabled", () => {
      // #given - test execution is disabled
      const config = {
        cwd: testDir,
        enableRealExecution: false,
        timeoutMs: 5000,
      }

      // #when - executing tests
      const result = executeTests(config)

      // #then - should return hasFailingTests=false with error message
      expect(result.hasFailingTests).toBe(false)
      expect(result.error).toBe("Real test execution is disabled")
    })

    test("should return noTestsFound when no test command is detected", () => {
      // #given - an empty directory with real execution enabled
      const config = {
        cwd: testDir,
        enableRealExecution: true,
        timeoutMs: 5000,
      }

      // #when - executing tests
      const result = executeTests(config)

      // #then - should return noTestsFound=true
      expect(result.noTestsFound).toBe(true)
      expect(result.hasFailingTests).toBe(false)
    })

    test("should return hasFailingTests=true when tests fail", () => {
      // #given - a bun project with a failing test
      writeFileSync(join(testDir, "bun.lockb"), "")
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test" }))
      writeFileSync(
        join(testDir, "fail.test.ts"),
        `import { test, expect } from "bun:test";
test("should fail", () => { expect(1).toBe(2); });`
      )

      const config = {
        cwd: testDir,
        enableRealExecution: true,
        timeoutMs: 30000,
      }

      // #when - executing tests
      const result = executeTests(config)

      // #then - should return hasFailingTests=true
      expect(result.hasFailingTests).toBe(true)
      expect(result.timedOut).toBe(false)
    })

    test("should return hasFailingTests=false when all tests pass", () => {
      // #given - a bun project with passing tests
      writeFileSync(join(testDir, "bun.lockb"), "")
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test" }))
      writeFileSync(
        join(testDir, "pass.test.ts"),
        `import { test, expect } from "bun:test";
test("should pass", () => { expect(1).toBe(1); });`
      )

      const config = {
        cwd: testDir,
        enableRealExecution: true,
        timeoutMs: 30000,
      }

      // #when - executing tests
      const result = executeTests(config)

      // #then - should return hasFailingTests=false
      expect(result.hasFailingTests).toBe(false)
      expect(result.timedOut).toBe(false)
    })

    test("should timeout and return hasFailingTests=true (conservative)", () => {
      // #given - a project with a custom slow test command
      const config = {
        cwd: testDir,
        enableRealExecution: true,
        timeoutMs: 100, // Very short timeout
        testCommand: process.platform === "win32" ? "ping -n 5 127.0.0.1" : "sleep 5",
      }

      // #when - executing tests with short timeout
      const result = executeTests(config)

      // #then - should timeout and return hasFailingTests=true (conservative)
      expect(result.timedOut).toBe(true)
      expect(result.hasFailingTests).toBe(true)
    })
  })
})
