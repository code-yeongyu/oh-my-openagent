import { describe, expect, test } from "bun:test"
import { STOP_CONTINUATION_TEMPLATE } from "./stop-continuation"

describe("stop-continuation template", () => {
  test("should export a non-empty template string", () => {
    // #given - the stop-continuation template

    // #when - we access the template

    // #then - it should be a non-empty string
    expect(typeof STOP_CONTINUATION_TEMPLATE).toBe("string")
    expect(STOP_CONTINUATION_TEMPLATE.length).toBeGreaterThan(0)
  })

  test("should describe the stop-continuation behavior", () => {
    // #given - the stop-continuation template

    // #when - we check the content

    // #then - it should mention key behaviors
    expect(STOP_CONTINUATION_TEMPLATE).toContain("todo-continuation-enforcer")
    expect(STOP_CONTINUATION_TEMPLATE).toContain("Ralph Loop")
    expect(STOP_CONTINUATION_TEMPLATE).toContain("boulder state")
  })
})
