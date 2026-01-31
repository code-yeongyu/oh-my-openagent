import { describe, expect, test } from "bun:test"
import { createBuiltinMcps, checkMcpToolCount } from "./index"

describe("createBuiltinMcps", () => {
  test("should return all MCPs when disabled_mcps is empty", () => {
    //#given
    const disabledMcps: string[] = []

    //#when
    const result = createBuiltinMcps(disabledMcps)

    //#then
    expect(result).toHaveProperty("websearch")
    expect(result).toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(3)
  })

  test("should filter out disabled built-in MCPs", () => {
    //#given
    const disabledMcps = ["context7"]

    //#when
    const result = createBuiltinMcps(disabledMcps)

    //#then
    expect(result).toHaveProperty("websearch")
    expect(result).not.toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(2)
  })

  test("should filter out all built-in MCPs when all disabled", () => {
    //#given
    const disabledMcps = ["websearch", "context7", "grep_app"]

    //#when
    const result = createBuiltinMcps(disabledMcps)

    //#then
    expect(result).not.toHaveProperty("websearch")
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
    expect(result).toHaveProperty("websearch")
    expect(result).not.toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(2)
  })

  test("should handle empty disabled_mcps by default", () => {
    //#given
    //#when
    const result = createBuiltinMcps()

    //#then
    expect(result).toHaveProperty("websearch")
    expect(result).toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(3)
  })

  test("should only filter built-in MCPs, ignoring unknown names", () => {
    //#given
    const disabledMcps = ["playwright", "sqlite", "unknown-mcp"]

    //#when
    const result = createBuiltinMcps(disabledMcps)

    //#then
    expect(result).toHaveProperty("websearch")
    expect(result).toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(3)
  })
})

describe("checkMcpToolCount", () => {
  test("should not warn when tool count is below threshold", () => {
    //#given
    const toolCount = 50

    //#when
    const result = checkMcpToolCount(toolCount)

    //#then
    expect(result.warned).toBe(false)
    expect(result.message).toBeUndefined()
  })

  test("should not warn when tool count equals threshold", () => {
    //#given
    const toolCount = 80

    //#when
    const result = checkMcpToolCount(toolCount)

    //#then
    expect(result.warned).toBe(false)
    expect(result.message).toBeUndefined()
  })

  test("should warn when tool count exceeds default threshold of 80", () => {
    //#given
    const toolCount = 85

    //#when
    const result = checkMcpToolCount(toolCount)

    //#then
    expect(result.warned).toBe(true)
    expect(result.message).toContain("85")
    expect(result.message).toContain("80")
  })

  test("should use custom threshold when provided", () => {
    //#given
    const toolCount = 60

    //#when
    const result = checkMcpToolCount(toolCount, { threshold: 50 })

    //#then
    expect(result.warned).toBe(true)
    expect(result.message).toContain("60")
    expect(result.message).toContain("50")
  })

  test("should not warn with custom threshold when below", () => {
    //#given
    const toolCount = 40

    //#when
    const result = checkMcpToolCount(toolCount, { threshold: 50 })

    //#then
    expect(result.warned).toBe(false)
  })
})
