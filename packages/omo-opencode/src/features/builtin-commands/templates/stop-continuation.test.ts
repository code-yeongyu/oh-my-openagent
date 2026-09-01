import { describe, expect, test } from "bun:test"
import { STOP_CONTINUATION_TEMPLATE } from "./stop-continuation"

describe("stop-continuation template", () => {
  test("should export a non-empty template string", () => {
    // given - the stop-continuation template

    // when - we access the template

    // then - it should be a non-empty string
    expect(typeof STOP_CONTINUATION_TEMPLATE).toBe("string")
    expect(STOP_CONTINUATION_TEMPLATE.length).toBeGreaterThan(0)
  })

  test("should reference the continuation-enforcer hook by its runtime name", () => {
    // given - the stop-continuation template

    // when - we check the content

    // then - it keys on the stable hook token the runtime registers
    expect(STOP_CONTINUATION_TEMPLATE).toContain("todo-continuation-enforcer")
  })
})
