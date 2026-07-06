import { describe, expect, test } from "bun:test"

import { validateTaskTarget } from "./validation"

describe("validateTaskTarget", () => {
  test("#given only category #when validated #then resolves to a category selection", () => {
    // given
    const params = { prompt: "do it", category: "quick" }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result).toEqual({ kind: "category", category: "quick" })
  })

  test("#given only subagent_type #when validated #then resolves to a subagent selection", () => {
    // given
    const params = { prompt: "do it", subagent_type: "oracle" }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result).toEqual({ kind: "subagent_type", subagentType: "oracle" })
  })

  test("#given both category and subagent_type #when validated #then returns a typed both_targets error", () => {
    // given
    const params = { prompt: "do it", category: "quick", subagent_type: "oracle" }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("both_targets")
    expect(result.error.message).toContain("EITHER category OR subagent_type")
    expect(result.error.message).toContain("not both")
    // the call hard-fails and spawns nothing, so the message must not claim subagent_type "is ignored"
    expect(result.error.message).not.toContain("ignored")
    expect(result.error.message).toContain("Remove one and retry")
  })

  test("#given neither category nor subagent_type #when validated #then returns a typed no_target error", () => {
    // given
    const params = { prompt: "do it" }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("no_target")
    expect(result.error.message).toContain("MUST provide EITHER category OR subagent_type")
  })

  test("#given empty-string category #when validated #then treated as absent (no_target)", () => {
    // given
    const params = { prompt: "do it", category: "  " }

    // when
    const result = validateTaskTarget(params)

    // then
    expect(result.kind).toBe("error")
    if (result.kind !== "error") throw new Error("expected error")
    expect(result.error.code).toBe("no_target")
  })
})
