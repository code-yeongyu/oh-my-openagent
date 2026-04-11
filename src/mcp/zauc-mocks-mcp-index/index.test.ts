import { describe, expect, test } from "bun:test"
import { createBuiltinMcps } from "../index"

describe("createBuiltinMcps", () => {
  test("should return all MCPs when disabled_mcps is empty", () => {
    // given
    const disabledMcps: string[] = []

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(Object.keys(result).length).toBeGreaterThan(0)
    expect(result.websearch).toBeDefined()
    expect(result.context7).toBeDefined()
    expect(result.grep_app).toBeDefined()
  })

  test("should filter out disabled MCPs", () => {
    // given
    const disabledMcps = ["websearch"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(result.websearch).toBeUndefined()
    expect(result.context7).toBeDefined()
    expect(result.grep_app).toBeDefined()
  })

  test("should return empty array when all MCPs are disabled", () => {
    // given - disable all known MCPs
    const disabledMcps = ["websearch", "context7", "grep_app"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then - may still have MCPs we didn't list
    const remainingMcpNames = Object.keys(result)
    expect(remainingMcpNames).not.toContain("websearch")
    expect(remainingMcpNames).not.toContain("context7")
    expect(remainingMcpNames).not.toContain("grep_app")
    expect(remainingMcpNames).toEqual([])
  })
})
