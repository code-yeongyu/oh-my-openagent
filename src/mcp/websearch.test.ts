/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { createWebsearchConfig } from "./websearch"
import * as shared from "../shared"

let logSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  logSpy = spyOn(shared, "log").mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

describe("createWebsearchConfig Tavily handling", () => {
  test("returns undefined when Tavily API key is missing", () => {
    const originalEnv = process.env.TAVILY_API_KEY
    delete process.env.TAVILY_API_KEY

    const config = createWebsearchConfig({ provider: "tavily" })

    expect(config).toBeUndefined()
    expect(logSpy).toHaveBeenCalledWith("[websearch] Tavily API key not found, skipping websearch MCP")

    if (originalEnv) {
      process.env.TAVILY_API_KEY = originalEnv
    }
  })

  test("returns valid config when Tavily API key is present", () => {
    const originalEnv = process.env.TAVILY_API_KEY
    process.env.TAVILY_API_KEY = "test-key"

    const config = createWebsearchConfig({ provider: "tavily" })

    expect(config).toBeDefined()
    expect(config?.type).toBe("remote")
    expect(config?.url).toBe("https://mcp.tavily.com/mcp/")

    if (originalEnv) {
      process.env.TAVILY_API_KEY = originalEnv
    } else {
      delete process.env.TAVILY_API_KEY
    }
  })
})
