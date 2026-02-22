import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { createBuiltinMcps, checkMcpToolCount } from "./index"
import { getLogFilePath } from "../shared/logger"
import { OhMyOpenCodeConfigSchema } from "../config/schema"

describe("createBuiltinMcps", () => {
  test("should return all MCPs when disabled_mcps is empty", () => {
    // given
    const disabledMcps: string[] = []

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(result).toHaveProperty("websearch")
    expect(result).toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(3)
  })

  test("should filter out disabled built-in MCPs", () => {
    // given
    const disabledMcps = ["context7"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(result).toHaveProperty("websearch")
    expect(result).not.toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(2)
  })

  test("should filter out all built-in MCPs when all disabled", () => {
    // given
    const disabledMcps = ["websearch", "context7", "grep_app"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(result).not.toHaveProperty("websearch")
    expect(result).not.toHaveProperty("context7")
    expect(result).not.toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(0)
  })

  test("should ignore custom MCP names in disabled_mcps", () => {
    // given
    const disabledMcps = ["context7", "playwright", "custom"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(result).toHaveProperty("websearch")
    expect(result).not.toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(2)
  })

  test("should handle empty disabled_mcps by default", () => {
    // given
    // when
    const result = createBuiltinMcps()

    // then
    expect(result).toHaveProperty("websearch")
    expect(result).toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(3)
  })

  test("should only filter built-in MCPs, ignoring unknown names", () => {
    // given
    const disabledMcps = ["playwright", "sqlite", "unknown-mcp"]

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(result).toHaveProperty("websearch")
    expect(result).toHaveProperty("context7")
    expect(result).toHaveProperty("grep_app")
    expect(Object.keys(result)).toHaveLength(3)
  })

  test("should not throw when websearch disabled even if tavily configured without API key", () => {
    // given
    const originalTavilyKey = process.env.TAVILY_API_KEY
    delete process.env.TAVILY_API_KEY
    const disabledMcps = ["websearch"]
    const config = OhMyOpenCodeConfigSchema.parse({ websearch: { provider: "tavily" } })

    try {
      // when
      const createMcps = () => createBuiltinMcps(disabledMcps, config)

      // then
      expect(createMcps).not.toThrow()
      const result = createMcps()
      expect(result).not.toHaveProperty("websearch")
    } finally {
      if (originalTavilyKey) process.env.TAVILY_API_KEY = originalTavilyKey
    }
  })

  test("should log warning using configured tool count threshold", () => {
    // given
    const disabledMcps: string[] = []
    const config = OhMyOpenCodeConfigSchema.parse({
      mcp: {
        tool_count_warning_threshold: 2,
      },
    })
    const logFile = getLogFilePath()
    const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : ""

    // when
    const result = createBuiltinMcps(disabledMcps, config)
    const after = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : ""

    // then
    expect(Object.keys(result)).toHaveLength(3)
    expect(after.length).toBeGreaterThan(before.length)
    expect(after).toContain(
      "[MCP Warning] Tool count (3) exceeds threshold (2). Consider disabling unused MCPs to improve performance and reduce confusion.",
    )
  })

})

describe("checkMcpToolCount", () => {
  test("should return warned false when under threshold", () => {
    // given
    const toolCount = 3

    // when
    const result = checkMcpToolCount(toolCount, { threshold: 3 })

    // then
    expect(result).toEqual({ warned: false })
  })

  test("should return warned true with warning message when above threshold", () => {
    // given
    const toolCount = 3

    // when
    const result = checkMcpToolCount(toolCount, { threshold: 2 })

    // then
    expect(result.warned).toBe(true)
    expect(result.message).toBe(
      "[MCP Warning] Tool count (3) exceeds threshold (2). Consider disabling unused MCPs to improve performance and reduce confusion.",
    )
  })
})
