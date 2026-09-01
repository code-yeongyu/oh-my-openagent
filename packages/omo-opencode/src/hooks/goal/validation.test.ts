import { describe, expect, test } from "bun:test"
import { InvalidObjectiveError, validateObjective } from "./validation"

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
