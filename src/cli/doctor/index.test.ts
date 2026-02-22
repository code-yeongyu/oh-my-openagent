import { describe, it, expect, mock, beforeEach } from "bun:test"
import type { DoctorResult } from "./types"
import { runDoctorWithTests } from "./index"

const runDoctorMock = mock(async (): Promise<DoctorResult> => ({
  results: [],
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    skipped: 0,
    duration: 0,
  },
  exitCode: 0,
}))

const runTestsMock = mock(async () => ({
  total: 3,
  passed: 3,
  failed: 0,
  skipped: 0,
  duration: 50,
  failureDetails: [],
}))

describe("doctor", () => {
  beforeEach(() => {
    runDoctorMock.mockClear()
    runTestsMock.mockClear()
  })

  it("returns doctor exit code when test mode is disabled", async () => {
    runDoctorMock.mockResolvedValueOnce({
      results: [],
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        warnings: 0,
        skipped: 0,
        duration: 1,
      },
      exitCode: 0,
    })

    const exitCode = await runDoctorWithTests(
      { verbose: true },
      {
        runDoctorFn: runDoctorMock,
        runTestsFn: runTestsMock,
        logFn: mock(() => {}),
      }
    )

    expect(runDoctorMock).toHaveBeenCalledTimes(1)
    expect(runTestsMock).not.toHaveBeenCalled()
    expect(exitCode).toBe(0)
  })

  it("runs unified test runner when test mode is enabled", async () => {
    const exitCode = await runDoctorWithTests(
      { test: true },
      {
        runDoctorFn: runDoctorMock,
        runTestsFn: runTestsMock,
        logFn: mock(() => {}),
      }
    )

    expect(runDoctorMock).toHaveBeenCalledTimes(1)
    expect(runTestsMock).toHaveBeenCalledTimes(1)
    expect(exitCode).toBe(0)
  })

  it("returns failure when test mode reports failed tests", async () => {
    runTestsMock.mockResolvedValueOnce({
      total: 4,
      passed: 3,
      failed: 1,
      skipped: 0,
      duration: 42,
      failureDetails: ["fail: expected true to be false"],
    })

    const exitCode = await runDoctorWithTests(
      { test: true },
      {
        runDoctorFn: runDoctorMock,
        runTestsFn: runTestsMock,
        logFn: mock(() => {}),
      }
    )

    expect(exitCode).toBe(1)
  })
})
