import { describe, expect, test } from "bun:test"
import { createBuiltinMcps } from "./index"

describe("createBuiltinMcps", () => {
  test("should return all MCPs when disabled_mcps is empty", () => {
    //#given
    const disabledMcps: string[] = []

    //#when
    const result = createBuiltinMcps(disabledMcps)

    //#then
    expect(result).toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(2)
  })

  test("should filter out disabled built-in MCPs", () => {
    //#given
    const disabledMcps = ["context7"]

    //#when
    const result = createBuiltinMcps(disabledMcps)

    //#then
    expect(result).not.toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(1)
  })

  test("should filter out both built-in MCPs when both disabled", () => {
    //#given
    const disabledMcps = ["context7", "grep_app"]

    //#when
    const result = createBuiltinMcps(disabledMcps)

    //#then
    expect(result).not.toHaveProperty("context7")
    expect(result).not.toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(0)
  })

  test("should ignore custom MCP names in disabled_mcps", () => {
    //#given
    const disabledMcps = ["context7", "playwright", "custom"]

    //#when
    const result = createBuiltinMcps(disabledMcps)

    //#then
    expect(result).not.toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(1)
  })

  test("should handle empty disabled_mcps by default", () => {
    //#given
    //#when
    const result = createBuiltinMcps()

    //#then
    expect(result).toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(2)
  })

  test("should only filter built-in MCPs, ignoring unknown names", () => {
    //#given
    const disabledMcps = ["playwright", "sqlite", "unknown-mcp"]

    //#when
    const result = createBuiltinMcps(disabledMcps)

    //#then
    expect(result).toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(2)
  })
})
