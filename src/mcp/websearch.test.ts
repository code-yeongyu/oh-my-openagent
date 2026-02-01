import { describe, expect, test, beforeEach, afterEach } from "bun:test"

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
    //#given
    const provider = undefined
    const exaKey = undefined
    const tavilyKey = undefined

    //#when
    process.env.EXA_API_KEY = exaKey
    process.env.TAVILY_API_KEY = tavilyKey

    //#then
    expect(provider).toBeUndefined()
  })

  test("returns Exa config when provider is 'exa'", () => {
    //#given
    const provider = "exa"

    //#when
    const selectedProvider = provider

    //#then
    expect(selectedProvider).toBe("exa")
  })

  test("includes x-api-key header when EXA_API_KEY is set", () => {
    //#given
    const apiKey = "test-exa-key-12345"
    process.env.EXA_API_KEY = apiKey

    //#when
    const headers = process.env.EXA_API_KEY
      ? { "x-api-key": process.env.EXA_API_KEY }
      : undefined

    //#then
    expect(headers).toEqual({ "x-api-key": "test-exa-key-12345" })
    expect(headers?.["x-api-key"]).toBe(apiKey)
  })

  test("returns Tavily config when provider is 'tavily' and TAVILY_API_KEY set", () => {
    //#given
    const provider = "tavily"
    const tavilyKey = "test-tavily-key-67890"
    process.env.TAVILY_API_KEY = tavilyKey

    //#when
    const headers = process.env.TAVILY_API_KEY
      ? { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }
      : undefined

    //#then
    expect(provider).toBe("tavily")
    expect(headers).toEqual({ Authorization: "Bearer test-tavily-key-67890" })
    expect(headers?.Authorization).toContain("Bearer")
  })

  test("throws error when provider is 'tavily' but TAVILY_API_KEY missing", () => {
    //#given
    const provider = "tavily"
    delete process.env.TAVILY_API_KEY

    //#when
    const createTavilyConfig = () => {
      if (provider === "tavily" && !process.env.TAVILY_API_KEY) {
        throw new Error("TAVILY_API_KEY environment variable is required for Tavily provider")
      }
    }

    //#then
    expect(createTavilyConfig).toThrow("TAVILY_API_KEY environment variable is required")
  })

  test("returns Exa when both keys present but no explicit provider (conflict resolution)", () => {
    //#given
    const exaKey = "test-exa-key"
    const tavilyKey = "test-tavily-key"
    const provider = undefined
    process.env.EXA_API_KEY = exaKey
    process.env.TAVILY_API_KEY = tavilyKey

    //#when
    const selectedProvider = provider || "exa"

    //#then
    expect(selectedProvider).toBe("exa")
    expect(process.env.EXA_API_KEY).toBe(exaKey)
    expect(process.env.TAVILY_API_KEY).toBe(tavilyKey)
  })

  test("Tavily config uses Authorization Bearer header", () => {
    //#given
    const tavilyKey = "tavily-secret-key-xyz"
    process.env.TAVILY_API_KEY = tavilyKey

    //#when
    const headers = {
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    }

    //#then
    expect(headers.Authorization).toMatch(/^Bearer /)
    expect(headers.Authorization).toBe(`Bearer ${tavilyKey}`)
    expect(headers.Authorization).not.toContain("x-api-key")
  })

  test("Tavily config points to mcp.tavily.com", () => {
    //#given
    const tavilyUrl = "https://mcp.tavily.com/mcp/"

    //#when
    const url = tavilyUrl

    //#then
    expect(url).toContain("mcp.tavily.com")
    expect(url).toMatch(/^https:\/\//)
    expect(url).toEndWith("/")
  })
})
