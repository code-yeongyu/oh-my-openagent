import { describe, expect, test } from "bun:test"
import {
  DEFAULT_AUDIT_LOOP_DURATION_MS,
  DEFAULT_AUDIT_LOOP_MAX_ITERATIONS,
  extractRawLoopArgs,
  parseLoopCommandArgs,
} from "./command-args"

describe("ralph-loop command args parser", () => {
  test("extractRawLoopArgs strips command prefix", () => {
    expect(extractRawLoopArgs('/audit-loop "task" --max-duration=3h', "audit-loop")).toBe(
      '"task" --max-duration=3h'
    )
  })

  test("parseLoopCommandArgs parses duration and standard flags", () => {
    const parsed = parseLoopCommandArgs(
      '"Improve UI" --max-iterations=50 --completion-promise=DONE --max-duration=3h'
    )

    expect(parsed.prompt).toBe("Improve UI")
    expect(parsed.maxIterations).toBe(50)
    expect(parsed.completionPromise).toBe("DONE")
    expect(parsed.hasExplicitCompletionPromise).toBe(true)
    expect(parsed.maxDurationMs).toBe(3 * 60 * 60 * 1000)
  })

  test("parseLoopCommandArgs applies default audit duration", () => {
    const parsed = parseLoopCommandArgs('"Improve UI"', { mode: "audit-loop" })
    expect(parsed.maxDurationMs).toBe(DEFAULT_AUDIT_LOOP_DURATION_MS)
    expect(parsed.maxIterations).toBe(DEFAULT_AUDIT_LOOP_MAX_ITERATIONS)
    expect(parsed.hasExplicitCompletionPromise).toBe(false)
  })

  test("parseLoopCommandArgs throws on invalid duration format", () => {
    expect(() => parseLoopCommandArgs('"Task" --max-duration=3hours')).toThrow(
      "Invalid --max-duration value"
    )
  })
})
