import { describe, it, expect } from "bun:test"
import { runTests } from "./test-runner"

describe("test-runner", () => {
  //#given
  const verbose = false

  // NOTE: These tests are skipped because they invoke the full test suite,
  // causing recursive test execution and timeouts on Windows.
  // They should be run manually or in CI with proper isolation.
  it.skip("should run all tests and return aggregated stats", async () => {
    //#when
    const result = await runTests({ verbose })

    //#then
    expect(result).toBeDefined()
    expect(typeof result.passed).toBe("number")
    expect(typeof result.failed).toBe("number")
    expect(typeof result.skipped).toBe("number")
    expect(Array.isArray(result.failureDetails)).toBe(true)
  }, 30000)

  it.skip("should aggregate pass/fail/skip stats correctly", async () => {
    // This is hard to test without mocking bun test or running a controlled environment
    // For now, we ensure the structure is correct
    const result = await runTests({ verbose: false })
    expect(result.total).toBe(result.passed + result.failed + result.skipped)
  }, 30000)

  it.skip("should show failure details when tests fail", async () => {
    // We can't easily force a failure in the whole suite here without breaking CI
    // But we can check that the field exists
    const result = await runTests({ verbose: false })
    expect(result.failureDetails).toBeDefined()
  }, 30000)

  it.skip("should support verbose output", async () => {
    const result = await runTests({ verbose: true })
    expect(result).toBeDefined()
  }, 30000)
})
