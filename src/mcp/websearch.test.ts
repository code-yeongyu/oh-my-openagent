import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createWebsearchConfig } from "./websearch"

describe("websearch MCP provider configuration", () => {
  let originalExaApiKey: string | undefined
  let originalTavilyApiKey: string | undefined

  beforeEach(() => {
    originalExaApiKey = process.env.EXA_API_KEY
    originalTavilyApiKey = process.env.TAVILY_API_KEY

    delete process.env.EXA_API_KEY
    delete process.env.TAVILY_API_KEY
  })

  afterEach(() => {
    if (originalExaApiKey === undefined) {
      delete process.env.EXA_API_KEY
    } else {
      process.env.EXA_API_KEY = originalExaApiKey
    }

    if (originalTavilyApiKey === undefined) {
      delete process.env.TAVILY_API_KEY
    } else {
      process.env.TAVILY_API_KEY = originalTavilyApiKey
    }
  })

  test("returns Exa config when no config provided", () => {
    //#given - no config

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.url).toContain("mcp.exa.ai")
    expect(result.url).toContain("tools=web_search_exa")
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
    expect(result.url).toContain("tools=web_search_exa")
    expect(result.type).toBe("remote")
  })

  test("appends exaApiKey query param when EXA_API_KEY is set", () => {
    //#given
    const apiKey = "test-exa-key-12345"
    process.env.EXA_API_KEY = apiKey

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.url).toContain(`exaApiKey=${encodeURIComponent(apiKey)}`)
  })

  test("sets x-api-key header when EXA_API_KEY is set", () => {
    //#given
    const apiKey = "test-exa-key-12345"
    process.env.EXA_API_KEY = apiKey

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.headers).toEqual({ "x-api-key": apiKey })
  })

  test("URL-encodes EXA_API_KEY when it contains special characters", () => {
    //#given an EXA_API_KEY with special characters (+ & =)
    const apiKey = "a+b&c=d"
    process.env.EXA_API_KEY = apiKey

    //#when createWebsearchConfig is called
    const result = createWebsearchConfig()

    //#then the URL contains the properly encoded key via encodeURIComponent
    expect(result.url).toContain(`exaApiKey=${encodeURIComponent(apiKey)}`)
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
    const exaKey = "test-exa-key"
    process.env.EXA_API_KEY = exaKey
    process.env.TAVILY_API_KEY = "test-tavily-key"

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.url).toContain("mcp.exa.ai")
    expect(result.url).toContain(`exaApiKey=${encodeURIComponent(exaKey)}`)
    expect(result.headers).toEqual({ "x-api-key": exaKey })
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
    expect(result.url).toContain("tools=web_search_exa")
    expect(result.url).not.toContain("exaApiKey=")
    expect(result.headers).toBeUndefined()
  })
})
