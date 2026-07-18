import { describe, expect, test } from "bun:test"
import { checkObjective, InvalidObjectiveError, MAX_OBJECTIVE_LENGTH, validateObjective } from "./validation"

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
    const longObjective = "x".repeat(MAX_OBJECTIVE_LENGTH + 1)

    expect(() => validateObjective(longObjective)).toThrow(InvalidObjectiveError)
    expect(() => validateObjective(longObjective)).toThrow("exceeds maximum length")
  })

  test("accepts objective at max length", () => {
    const objective = "x".repeat(MAX_OBJECTIVE_LENGTH)

    const result = validateObjective(objective)

    expect(result).toBe(objective)
  })
})

describe("checkObjective", () => {
  test("returns ok with trimmed objective for valid input", () => {
    const result = checkObjective("  Ship the dashboard  ")

    expect(result).toEqual({ ok: true, objective: "Ship the dashboard" })
  })

  test("returns not-ok for empty objective without throwing", () => {
    const result = checkObjective("   ")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("cannot be empty")
  })

  test("returns not-ok for objective exceeding max length without throwing", () => {
    const result = checkObjective("x".repeat(MAX_OBJECTIVE_LENGTH + 1))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("exceeds maximum length")
  })

  test("returns ok for objective at max length", () => {
    const result = checkObjective("x".repeat(MAX_OBJECTIVE_LENGTH))

    expect(result.ok).toBe(true)
  })
})
