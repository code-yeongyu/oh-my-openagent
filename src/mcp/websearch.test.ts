import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { createWebsearchConfig } from "./websearch"

describe("websearch MCP provider configuration", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.EXA_API_KEY
    delete process.env.TAVILY_API_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test("returns Exa config when no config provided", () => {
    //#given - no config

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.url).toContain("mcp.exa.ai")
    expect(result.type).toBe("remote")
    expect(result.enabled).toBe(true)
  })

  test("returns Exa config when provider is 'exa'", () => {
    //#given
    const config = { provider: "exa" as const }

    //#when
    const result = createWebsearchConfig(config)

    //#then
    expect(result.url).toContain("mcp.exa.ai")
    expect(result.type).toBe("remote")
  })

  test("includes x-api-key header when EXA_API_KEY is set", () => {
    //#given
    const apiKey = "test-exa-key-12345"
    process.env.EXA_API_KEY = apiKey

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.headers).toEqual({ "x-api-key": apiKey })
  })

  test("returns Tavily config when provider is 'tavily' and TAVILY_API_KEY set", () => {
    //#given
    const tavilyKey = "test-tavily-key-67890"
    process.env.TAVILY_API_KEY = tavilyKey
    const config = { provider: "tavily" as const }

    //#when
    const result = createWebsearchConfig(config)

    //#then
    expect(result.url).toContain("mcp.tavily.com")
    expect(result.headers).toEqual({ Authorization: `Bearer ${tavilyKey}` })
  })

  test("throws error when provider is 'tavily' but TAVILY_API_KEY missing", () => {
    //#given
    delete process.env.TAVILY_API_KEY
    const config = { provider: "tavily" as const }

    //#when
    const createTavilyConfig = () => createWebsearchConfig(config)

    //#then
    expect(createTavilyConfig).toThrow("TAVILY_API_KEY environment variable is required")
  })

  test("returns Exa when both keys present but no explicit provider", () => {
    //#given
    process.env.EXA_API_KEY = "test-exa-key"
    process.env.TAVILY_API_KEY = "test-tavily-key"

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.url).toContain("mcp.exa.ai")
    expect(result.headers).toEqual({ "x-api-key": "test-exa-key" })
  })

  test("Tavily config uses Authorization Bearer header format", () => {
    //#given
    const tavilyKey = "tavily-secret-key-xyz"
    process.env.TAVILY_API_KEY = tavilyKey
    const config = { provider: "tavily" as const }

    //#when
    const result = createWebsearchConfig(config)

    //#then
    expect(result.headers?.Authorization).toMatch(/^Bearer /)
    expect(result.headers?.Authorization).toBe(`Bearer ${tavilyKey}`)
  })

  test("Exa config has no headers when EXA_API_KEY not set", () => {
    //#given
    delete process.env.EXA_API_KEY

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.url).toContain("mcp.exa.ai")
    expect(result.headers).toBeUndefined()
  })
})
