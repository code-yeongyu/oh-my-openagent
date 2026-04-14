/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import * as logger from "../shared/logger"

let logSpy: ReturnType<typeof spyOn>
let createWebsearchConfig: (typeof import("./websearch"))["createWebsearchConfig"]
let originalEnv: Record<"EXA_API_KEY" | "TAVILY_API_KEY", string | undefined>

async function importFreshWebsearchModule(): Promise<typeof import("./websearch")> {
  return import(`./websearch?test=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  originalEnv = {
    EXA_API_KEY: process.env.EXA_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  }
  delete process.env.EXA_API_KEY
  delete process.env.TAVILY_API_KEY
  logSpy = spyOn(logger, "log").mockImplementation(() => {})
  ;({ createWebsearchConfig } = await importFreshWebsearchModule())
})

afterEach(() => {
  logSpy.mockRestore()
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }

    process.env[key] = value
  }
})

describe("createWebsearchConfig Tavily handling", () => {
  test("returns undefined when Tavily API key is missing", () => {
    delete process.env.TAVILY_API_KEY

    const config = createWebsearchConfig({ provider: "tavily" })

    expect(config).toBeUndefined()
    expect(logSpy).toHaveBeenCalledWith("[websearch] Tavily API key not found, skipping websearch MCP")
  })

  test("returns valid config when Tavily API key is present", () => {
    process.env.TAVILY_API_KEY = "test-key"

    const config = createWebsearchConfig({ provider: "tavily" })

    expect(config).toBeDefined()
    expect(config?.type).toBe("remote")
    expect(config?.url).toBe("https://mcp.tavily.com/mcp/")
  })
})
