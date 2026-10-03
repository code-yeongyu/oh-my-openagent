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

  test("truncates objective exceeding max length instead of throwing (#8409)", () => {
    const longObjective = "x".repeat(2001)

    const result = validateObjective(longObjective)

    expect(result).toBe("x".repeat(2000))
    expect(result.length).toBe(2000)
  })

  test("accepts objective at max length", () => {
    const objective = "x".repeat(2000)

    const result = validateObjective(objective)

    expect(result).toBe(objective)
  })
})
