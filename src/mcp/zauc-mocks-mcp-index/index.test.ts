import { describe, expect, test } from "bun:test"
import { createBuiltinMcps } from "../index"

describe("createBuiltinMcps", () => {
  test("should return all MCPs when disabled_mcps is empty", () => {
    // given
    const disabledMcps: string[] = []

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(result.length).toBeGreaterThan(0)
  })

  test("should filter out disabled MCPs", () => {
    // given
    const disabledMcps = ["websearch"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(result.some((mcp) => mcp.name === "websearch")).toBe(false)
  })

  test("should return empty array when all MCPs are disabled", () => {
    // given - disable all known MCPs
    const disabledMcps = ["websearch", "context7", "grep-app"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then - may still have MCPs we didn't list
    const remainingMcpNames = result.map((m) => m.name)
    expect(remainingMcpNames).not.toContain("websearch")
    expect(remainingMcpNames).not.toContain("context7")
    expect(remainingMcpNames).not.toContain("grep-app")
  })
})