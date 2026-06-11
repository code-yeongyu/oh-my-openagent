import { describe, expect, it } from "bun:test"
import { calculateExpression } from "./tools"

describe("calculateExpression", () => {
  it("respects operator precedence and parentheses", () => {
    // given
    const expression = "2 * (3 + 4) - 5"

    // when
    const result = calculateExpression(expression)

    // then
    expect(result).toBe(9)
  })

  it("rejects unsupported characters", () => {
    // given
    const expression = "process.exit()"

    // when
    const result = () => calculateExpression(expression)

    // then
    expect(result).toThrow("unsupported character")
  })
})
