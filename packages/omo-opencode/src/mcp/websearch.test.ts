/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import * as logger from "../shared/logger"

let logSpy: ReturnType<typeof spyOn>
let createWebsearchConfig: (typeof import("./websearch"))["createWebsearchConfig"]
let originalEnv: Record<"EXA_API_KEY" | "TAVILY_API_KEY" | "ASK_ECHO_SEARCH_INFINITY_API_KEY", string | undefined>

async function importFreshWebsearchModule(): Promise<typeof import("./websearch")> {
  return import(`./websearch?test=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  originalEnv = {
    EXA_API_KEY: process.env.EXA_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    ASK_ECHO_SEARCH_INFINITY_API_KEY: process.env.ASK_ECHO_SEARCH_INFINITY_API_KEY,
  }
  delete process.env.EXA_API_KEY
  delete process.env.TAVILY_API_KEY
  delete process.env.ASK_ECHO_SEARCH_INFINITY_API_KEY
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

describe("createWebsearchConfig Volcano Engine handling", () => {
  test("returns undefined when Volcano Engine API key is missing", () => {
    delete process.env.ASK_ECHO_SEARCH_INFINITY_API_KEY

    const config = createWebsearchConfig({ provider: "volcengine" })

    expect(config).toBeUndefined()
    expect(logSpy).toHaveBeenCalledWith("[websearch] Volcano Engine API key not found, skipping websearch MCP")
  })

  test("returns local MCP config for the official Volcano Engine websearch server when API key is present", () => {
    process.env.ASK_ECHO_SEARCH_INFINITY_API_KEY = "test-key"

    const config = createWebsearchConfig({ provider: "volcengine" })

    expect(config).toEqual({
      type: "local",
      command: [
        "uvx",
        "--from",
        "mcp-server-askecho-search-infinity>=0.2.0",
        "mcp-server-askecho-search-infinity",
      ],
      enabled: true,
      environment: {
        ASK_ECHO_SEARCH_INFINITY_API_KEY: "test-key",
      },
    })
  })
})

describe("createWebsearchConfig Exa handling", () => {
  test("keeps EXA_API_KEY out of URL query params and sends bearer auth header", () => {
    process.env.EXA_API_KEY = "exa-secret"

    const config = createWebsearchConfig({ provider: "exa" })

    expect(config).toEqual({
      type: "remote",
      url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
      enabled: true,
      headers: {
        Authorization: "Bearer exa-secret",
      },
      oauth: false,
    })
    expect(config?.url).not.toContain("exaApiKey")
    expect(config?.headers).not.toHaveProperty("x-api-key")
  })

  test("uses unauthenticated Exa URL when EXA_API_KEY is missing", () => {
    delete process.env.EXA_API_KEY

    const config = createWebsearchConfig({ provider: "exa" })

    expect(config).toEqual({
      type: "remote",
      url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
      enabled: true,
      oauth: false,
    })
  })
})
