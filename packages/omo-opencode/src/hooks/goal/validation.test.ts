import { describe, expect, test } from "bun:test"
import { InvalidObjectiveError, MAX_OBJECTIVE_LENGTH, truncateObjective, validateObjective } from "./validation"

describe("validateObjective", () => {
  test("returns trimmed objective for valid input", () => {
    const result = validateObjective("  Ship the dashboard  ")

    expect(result).toBe("Ship the dashboard")
  })

  test("throws for empty objective", () => {
    expect(() => validateObjective("")).toThrow(InvalidObjectiveError)
    expect(() => validateObjective("")).toThrow("Objective cannot be empty")
  })

  test("throws for whitespace-only objective", () => {
    expect(() => validateObjective("   ")).toThrow(InvalidObjectiveError)
  })

  test("throws for objective exceeding max length", () => {
    const longObjective = "x".repeat(2001)

    expect(() => validateObjective(longObjective)).toThrow(InvalidObjectiveError)
    expect(() => validateObjective(longObjective)).toThrow("exceeds maximum length")
  })

  test("accepts objective at max length", () => {
    const objective = "x".repeat(2000)

    const result = validateObjective(objective)

    expect(result).toBe(objective)
  })
})

describe("truncateObjective", () => {
  test("returns trimmed objective unchanged when within the cap", () => {
    const result = truncateObjective("  Ship the dashboard  ")

    expect(result).toBe("Ship the dashboard")
  })

  test("clamps an over-limit objective to the max length", () => {
    const longObjective = "Fix the login bug. ".repeat(200)

    const result = truncateObjective(longObjective)

    expect(result.length).toBe(MAX_OBJECTIVE_LENGTH)
    expect(result.startsWith("Fix the login bug.")).toBe(true)
  })

  test("keeps an objective at exactly the cap unchanged", () => {
    const objective = "x".repeat(MAX_OBJECTIVE_LENGTH)

    expect(truncateObjective(objective)).toBe(objective)
  })

  test("result of truncating an over-limit objective passes validateObjective", () => {
    const longObjective = "y".repeat(5000)

    expect(() => validateObjective(truncateObjective(longObjective))).not.toThrow()
  })
})
