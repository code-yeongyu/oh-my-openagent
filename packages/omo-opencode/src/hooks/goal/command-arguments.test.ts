import { describe, expect, test } from "bun:test"
import { parseGoalCommand } from "./command-arguments"

describe("parseGoalCommand", () => {
  test("empty input shows current goal", () => {
    const result = parseGoalCommand("")

    expect(result).toEqual({ kind: "show" })
  })

  test("whitespace-only input shows current goal", () => {
    const result = parseGoalCommand("   ")

    expect(result).toEqual({ kind: "show" })
  })

  test("pause pauses the goal", () => {
    const result = parseGoalCommand("pause")

    expect(result).toEqual({ kind: "setStatus", status: "paused" })
  })

  test("PAUSE is case-insensitive", () => {
    const result = parseGoalCommand("PAUSE")

    expect(result).toEqual({ kind: "setStatus", status: "paused" })
  })

  test("resume resumes the goal", () => {
    const result = parseGoalCommand("resume")

    expect(result).toEqual({ kind: "setStatus", status: "active" })
  })

  test("clear clears the goal", () => {
    const result = parseGoalCommand("clear")

    expect(result).toEqual({ kind: "clear" })
  })

  test("any other input sets the objective", () => {
    const result = parseGoalCommand("Ship the dashboard")

    expect(result).toEqual({ kind: "setObjective", objective: "Ship the dashboard" })
  })

  test("objective preserves whitespace and case", () => {
    const result = parseGoalCommand("  Fix the flaky login test  ")

    expect(result).toEqual({ kind: "setObjective", objective: "Fix the flaky login test" })
  })
})
