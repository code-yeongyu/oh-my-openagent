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

  // Tests for exa_tools configuration (VAL-MCP-001, VAL-MCP-002, VAL-MCP-003, VAL-MCP-004)
  describe("exa_tools configuration", () => {
    test('"all" preset loads all 8 tools', () => {
      //#given
      const config = { exa_tools: "all" as const }

      //#when
      const result = createWebsearchConfig(config)

      //#then
      expect(result.url).toContain("tools=web_search_exa")
      expect(result.url).toContain("tools=get_code_context_exa")
      expect(result.url).toContain("tools=company_research_exa")
      expect(result.url).toContain("tools=web_search_advanced_exa")
      expect(result.url).toContain("tools=crawling_exa")
      expect(result.url).toContain("tools=people_search_exa")
      expect(result.url).toContain("tools=deep_researcher_start")
      expect(result.url).toContain("tools=deep_researcher_check")
    })

    test('"default" preset loads 3 default tools', () => {
      //#given
      const config = { exa_tools: "default" as const }

      //#when
      const result = createWebsearchConfig(config)

      //#then
      expect(result.url).toContain("tools=web_search_exa")
      expect(result.url).toContain("tools=get_code_context_exa")
      expect(result.url).toContain("tools=company_research_exa")
      expect(result.url).not.toContain("tools=web_search_advanced_exa")
      expect(result.url).not.toContain("tools=crawling_exa")
    })

    test("custom array selects specific tools only", () => {
      //#given
      const config = { exa_tools: ["web_search_exa", "crawling_exa"] as const }

      //#when
      const result = createWebsearchConfig(config)

      //#then
      expect(result.url).toContain("tools=web_search_exa")
      expect(result.url).toContain("tools=crawling_exa")
      expect(result.url).not.toContain("tools=get_code_context_exa")
      expect(result.url).not.toContain("tools=company_research_exa")
    })

    test("empty/unconfigured falls back to web_search_exa (backward compatible)", () => {
      //#given - no exa_tools config
      const config = {}

      //#when
      const result = createWebsearchConfig(config)

      //#then - should only have web_search_exa
      expect(result.url).toContain("tools=web_search_exa")
      expect(result.url).not.toContain("tools=get_code_context_exa")
    })

    test("empty array falls back to web_search_exa (backward compatible)", () => {
      //#given - empty array
      const config = { exa_tools: [] }

      //#when
      const result = createWebsearchConfig(config)

      //#then - should only have web_search_exa
      expect(result.url).toContain("tools=web_search_exa")
      expect(result.url).not.toContain("tools=get_code_context_exa")
    })
  })
})
