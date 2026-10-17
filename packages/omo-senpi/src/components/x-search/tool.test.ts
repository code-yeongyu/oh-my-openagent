/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import probeFixture from "./__fixtures__/x-search-response.probe.json"
import { CARRIER_MODELS, DEFAULT_CARRIER } from "./client"
import {
  createXSearchTool,
  type XSearchToolExecutionContext,
  type XSearchToolExecutionResult,
} from "./tool"

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  })
}

function registryContext(stored: unknown, apiKey: string | undefined = "stored-token"): XSearchToolExecutionContext {
  return {
    modelRegistry: {
      authStorage: { get: () => stored },
      getProviderAuth: async () => (apiKey === undefined ? undefined : { auth: { apiKey } }),
    },
  }
}

const storedContext = registryContext({ type: "oauth" })
const unauthenticatedContext = registryContext(undefined)

function toolWith(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  env: Record<string, string | undefined> = {},
) {
  return createXSearchTool({ fetchImpl, env })
}

async function runTool(
  tool: ReturnType<typeof createXSearchTool>,
  params: Record<string, unknown>,
  ctx: XSearchToolExecutionContext,
): Promise<XSearchToolExecutionResult> {
  return (await tool.execute("call-1", params as never, undefined, undefined, ctx as never)) as XSearchToolExecutionResult
}

function textOf(result: XSearchToolExecutionResult): string {
  return result.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("")
}

describe("createXSearchTool definition", () => {
  const tool = toolWith(async () => jsonResponse(probeFixture))

  it("#given the definition #when reading discovery metadata #then it is a lazily activatable search-exposed x-search tool", () => {
    expect(tool.name).toBe("x_search")
    expect(tool.label).toBe("Search X posts")
    expect(tool.exposure).toBe("search")
    expect(tool.searchGroup).toBe("x-search")
    expect(tool.allowLazyActivation).toBe(true)
    expect(tool.executionMode).toBe("parallel")
    expect(tool.searchKeywords).toEqual([
      "X posts",
      "tweets",
      "twitter search",
      "xAI live search",
      "what people are saying on X",
    ])
  })

  it("#given the definition #when reading prompt fields #then no prompt tokens are carried before promotion", () => {
    expect(tool.promptSnippet).toBeUndefined()
    expect(tool.promptGuidelines).toBeUndefined()
  })

  it("#given the definition #when reading the description #then it condenses the four rules into four sentences", () => {
    const sentences = tool.description.split(". ").filter((part) => part.trim().length > 0)
    expect(sentences).toHaveLength(4)
    expect(tool.description).toContain("from_date")
    expect(tool.description).toContain("allowed_x_handles")
    expect(tool.description).toContain("2-3 narrower searches")
    expect(tool.description).toContain("connected xAI account")
  })
})

describe("createXSearchTool execute", () => {
  it("#given a stored credential and the probe fixture #when executing #then the formatted text and details carry the server queries", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const tool = toolWith(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(probeFixture)
    })

    const result = await runTool(tool, { query: "Grok CLI", from_date: "2026-09-01" }, storedContext)

    expect(textOf(result).startsWith("x_search results:")).toBe(true)
    expect(result.details.queries[0]).toContain("since:")
    expect(result.details.results.length).toBeGreaterThan(0)
    expect(result.details.usage.xSearchCalls).toBe(3)
    expect(calls).toHaveLength(1)
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer stored-token")
    expect(JSON.parse(String(calls[0].init.body)).model).toBe(CARRIER_MODELS[DEFAULT_CARRIER].model)
  })

  it("#given OMO_X_SEARCH_MODEL #when executing #then the carrier model is overridden", async () => {
    let body: Record<string, unknown> = {}
    const tool = toolWith(
      async (_url, init) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>
        return jsonResponse(probeFixture)
      },
      { OMO_X_SEARCH_MODEL: "grok-4.6" },
    )

    await runTool(tool, { query: "Grok CLI" }, storedContext)

    expect(body.model).toBe("grok-4.6")
  })

  it("#given no credential #when executing #then it returns the AUTH error without calling xAI", async () => {
    let fetched = 0
    const tool = toolWith(async () => {
      fetched += 1
      return jsonResponse(probeFixture)
    })

    const result = await runTool(tool, { query: "Grok CLI" }, unauthenticatedContext)

    expect(textOf(result)).toContain("x_search error [AUTH]")
    expect(result.isError).toBe(true)
    expect(fetched).toBe(0)
  })

  it("#given invalid parameters #when executing #then validation short-circuits before any request", async () => {
    let fetched = 0
    const tool = toolWith(async () => {
      fetched += 1
      return jsonResponse(probeFixture)
    })

    const result = await runTool(
      tool,
      { query: "Grok CLI", allowed_x_handles: ["a"], excluded_x_handles: ["b"] },
      storedContext,
    )

    expect(textOf(result)).toContain("x_search error [INVALID_FILTERS]")
    expect(result.details.code).toBe("INVALID_FILTERS")
    expect(fetched).toBe(0)
  })

  it("#given an upstream rate limit #when executing #then the error code is surfaced in text and details", async () => {
    const tool = toolWith(async () => jsonResponse({ error: "slow down" }, { status: 429, headers: { "retry-after": "7" } }))

    const result = await runTool(tool, { query: "Grok CLI" }, storedContext)

    expect(textOf(result)).toContain("x_search error [RATE_LIMITED]")
    expect(result.details.code).toBe("RATE_LIMITED")
    expect(result.isError).toBe(true)
  })

  it("#given a resolveBearer override #when executing #then the injected bearer is used", async () => {
    let authorization = ""
    const tool = createXSearchTool({
      fetchImpl: async (_url, init) => {
        authorization = (init.headers as Record<string, string>).authorization
        return jsonResponse(probeFixture)
      },
      env: {},
      resolveBearer: async () => ({ bearer: "injected", provenance: "env" }),
    })

    await runTool(tool, { query: "Grok CLI" }, unauthenticatedContext)

    expect(authorization).toBe("Bearer injected")
  })
})
