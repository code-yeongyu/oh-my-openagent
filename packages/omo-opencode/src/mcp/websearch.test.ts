/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import * as logger from "../shared/logger"
import { WebsearchConfigSchema } from "../config/schema/websearch"

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

describe("createWebsearchConfig Exa handling", () => {
  test("keeps Exa as the default when no provider is selected", () => {
    expect(createWebsearchConfig()).toEqual(createWebsearchConfig({ provider: "exa" }))
    expect(createWebsearchConfig({})).toEqual(createWebsearchConfig({ provider: "exa" }))
  })

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

describe("createWebsearchConfig Parallel handling", () => {
  test("accepts explicit Parallel selection through the config schema", () => {
    expect(WebsearchConfigSchema.parse({ provider: "parallel" })).toEqual({ provider: "parallel" })
  })

  test("connects anonymously without an OAuth flow", () => {
    // given
    const selection = WebsearchConfigSchema.parse({ provider: "parallel" })

    // when
    const config = createWebsearchConfig(selection)

    // then
    expect(config).toEqual({
      type: "remote",
      url: "https://search.parallel.ai/mcp",
      enabled: true,
      oauth: false,
    })
  })

  test("does not forward existing provider credentials to Parallel", () => {
    // given
    process.env.EXA_API_KEY = "exa-secret"
    process.env.TAVILY_API_KEY = "tavily-secret"
    const selection = WebsearchConfigSchema.parse({ provider: "parallel" })

    // when
    const config = createWebsearchConfig(selection)

    // then
    expect(config?.headers).toBeUndefined()
    expect(config?.url).toBe("https://search.parallel.ai/mcp")
  })
})
