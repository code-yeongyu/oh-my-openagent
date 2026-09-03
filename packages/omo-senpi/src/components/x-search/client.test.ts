/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import fastFixture from "./__fixtures__/x-search-response.fast.json"
import probeFixture from "./__fixtures__/x-search-response.probe.json"
import {
  buildXSearchRequest,
  CARRIER_MODELS,
  DEFAULT_CARRIER,
  DEFAULT_PROMPT_VARIANT,
  normalizeXSearchResponse,
  performXSearch,
  PROMPT_VARIANTS,
  type XSearchFetch,
  type XSearchRequestParams,
} from "./client"
import { formatXSearchError, formatXSearchResult, type XSearchErrorCode } from "./format"

const fastCarrier = CARRIER_MODELS.fast
const reasoningCarrier = CARRIER_MODELS.reasoning

function baseParams(overrides: Partial<XSearchRequestParams> = {}): XSearchRequestParams {
  return { query: "Grok CLI", mode: "latest", max_results: 10, ...overrides }
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  })
}

describe("buildXSearchRequest", () => {
  it("#given dates and allowed handles #when building the request #then the x_search tool carries only the set filters under the bounded envelope", () => {
    const body = buildXSearchRequest(
      baseParams({
        query: "Grok CLI",
        from_date: "2026-09-01",
        to_date: "2026-09-03",
        allowed_x_handles: ["grok", "xai"],
      }),
      { carrier: fastCarrier, variant: "v1" },
    )

    expect(body.model).toBe("grok-4.20-0309-non-reasoning")
    expect(body.tool_choice).toBe("required")
    expect(body.max_turns).toBe(1)
    expect(body.parallel_tool_calls).toBe(false)
    expect(body.max_output_tokens).toBe(4000)
    expect(body.store).toBe(false)
    expect(body.tools).toEqual([
      {
        type: "x_search",
        from_date: "2026-09-01",
        to_date: "2026-09-03",
        allowed_x_handles: ["grok", "xai"],
      },
    ])
    expect(body.input).toHaveLength(1)
    expect(body.input[0]?.role).toBe("user")
    expect(body.input[0]?.content).toContain('Run exactly this query: "Grok CLI since:2026-09-01 until:2026-09-03"')
    expect(body.input[0]?.content).toContain("mode=Latest")
    expect(body.input[0]?.content).toContain("Return up to 10 X posts")
    expect(body).not.toHaveProperty("reasoning")
  })

  it("#given top mode with no filters #when building the request #then the tool has no filter keys and the prompt asks for Top", () => {
    const body = buildXSearchRequest(baseParams({ query: "bun 1.4", mode: "top", max_results: 5 }), {
      carrier: fastCarrier,
      variant: "v1",
    })

    expect(body.tools).toEqual([{ type: "x_search" }])
    expect(body.tool_choice).toBe("required")
    expect(body.max_turns).toBe(1)
    expect(body.parallel_tool_calls).toBe(false)
    expect(body.max_output_tokens).toBe(4000)
    expect(body.store).toBe(false)
    expect(body.input[0]?.content).toContain("mode=Top")
    expect(body.input[0]?.content).toContain('Run exactly this query: "bun 1.4"')
    expect(body.input[0]?.content).toContain("Return up to 5 X posts")
  })

  it("#given excluded handles plus understanding flags on the reasoning carrier #when building the request #then flags and reasoning ride along", () => {
    const body = buildXSearchRequest(
      baseParams({
        query: "xAI livestream",
        excluded_x_handles: ["spam_account"],
        enable_image_understanding: true,
        enable_video_understanding: false,
      }),
      { carrier: reasoningCarrier, variant: "v2" },
    )

    expect(body.model).toBe("grok-4.6")
    expect(body.reasoning).toEqual({ effort: "low" })
    expect(body.tool_choice).toBe("required")
    expect(body.max_turns).toBe(1)
    expect(body.parallel_tool_calls).toBe(false)
    expect(body.max_output_tokens).toBe(4000)
    expect(body.store).toBe(false)
    expect(body.tools).toEqual([
      {
        type: "x_search",
        excluded_x_handles: ["spam_account"],
        enable_image_understanding: true,
        enable_video_understanding: false,
      },
    ])
    expect(body.input[0]?.content).toBe(PROMPT_VARIANTS.v2(baseParams({
      query: "xAI livestream",
      excluded_x_handles: ["spam_account"],
      enable_image_understanding: true,
      enable_video_understanding: false,
    })))
  })

  it("#given the shipped defaults #when reading the frozen knobs #then v1 is the default variant on the fast carrier and v2 extends v1", () => {
    expect(DEFAULT_PROMPT_VARIANT).toBe("v1")
    expect(DEFAULT_CARRIER).toBe("fast")
    expect(CARRIER_MODELS.fast).toEqual({ model: "grok-4.20-0309-non-reasoning" })
    expect(CARRIER_MODELS.reasoning).toEqual({ model: "grok-4.6", reasoning: { effort: "low" } })

    const params = baseParams()
    expect(PROMPT_VARIANTS.v2(params).startsWith(PROMPT_VARIANTS.v1(params))).toBe(true)
    expect(PROMPT_VARIANTS.v2(params)).toContain("Prefer the most recent posts")
  })
})

describe("performXSearch", () => {
  it("#given a 200 JSON response #when performing the search #then the raw payload comes back with the bearer and JSON headers set", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl: XSearchFetch = async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} })
      return jsonResponse(fastFixture)
    }

    const outcome = await performXSearch({ fetch: fetchImpl, bearer: "test-bearer", body: { model: "m" } })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("expected ok")
    expect((outcome.raw as { model?: string }).model).toBe("grok-4.20-0309-non-reasoning")
    expect(seen).toHaveLength(1)
    expect(seen[0]?.init.method).toBe("POST")
    const headers = new Headers(seen[0]?.init.headers)
    expect(headers.get("authorization")).toBe("Bearer test-bearer")
    expect(headers.get("content-type")).toBe("application/json")
  })

  it.each([
    { status: 401, code: "AUTH" },
    { status: 403, code: "AUTH" },
    { status: 500, code: "UPSTREAM" },
    { status: 503, code: "UPSTREAM" },
  ])("#given HTTP $status #when performing the search #then it fails closed as $code with no retry", async ({ status, code }) => {
    let calls = 0
    const fetchImpl: XSearchFetch = async () => {
      calls += 1
      return new Response("nope", { status })
    }

    const outcome = await performXSearch({ fetch: fetchImpl, bearer: "b", body: {} })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("expected failure")
    expect(outcome.code).toBe(code as never)
    expect(calls).toBe(1)
  })

  it("#given HTTP 429 with Retry-After #when performing the search #then RATE_LIMITED carries the retryAfter seconds", async () => {
    const fetchImpl: XSearchFetch = async () => new Response("slow down", { status: 429, headers: { "retry-after": "42" } })

    const outcome = await performXSearch({ fetch: fetchImpl, bearer: "b", body: {} })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("expected failure")
    expect(outcome.code).toBe("RATE_LIMITED")
    expect(outcome.retryAfter).toBe(42)
  })

  it("#given an aborted request #when performing the search #then it reports TIMEOUT", async () => {
    const controller = new AbortController()
    const fetchImpl: XSearchFetch = async (_url, init) => {
      controller.abort()
      const signal = init?.signal
      const error = new Error("aborted")
      error.name = "AbortError"
      if (signal?.aborted) throw error
      throw error
    }

    const outcome = await performXSearch({ fetch: fetchImpl, bearer: "b", body: {}, signal: controller.signal })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("expected failure")
    expect(outcome.code).toBe("TIMEOUT")
  })

  it("#given a deadline shorter than the response #when performing the search #then the request is aborted as TIMEOUT", async () => {
    const fetchImpl: XSearchFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        })
      })

    const outcome = await performXSearch({ fetch: fetchImpl, bearer: "b", body: {}, deadlineMs: 5 })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("expected failure")
    expect(outcome.code).toBe("TIMEOUT")
  })

  it("#given a 200 body that is not JSON #when performing the search #then it reports PROTOCOL", async () => {
    const fetchImpl: XSearchFetch = async () => new Response("<html>gateway</html>", { status: 200 })

    const outcome = await performXSearch({ fetch: fetchImpl, bearer: "b", body: {} })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("expected failure")
    expect(outcome.code).toBe("PROTOCOL")
  })
})

describe("normalizeXSearchResponse", () => {
  it("#given the probe fixture #when normalized #then unique tweet ids, the server queries, and usage are recovered", () => {
    const normalized = normalizeXSearchResponse(probeFixture)

    const ids = normalized.results.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(4)
    expect(ids).toContain("2095333026204971141")
    expect(normalized.queries[0]).toContain("since:2026-09-01")
    expect(normalized.queries[0]).toContain("Latest")
    expect(normalized.queries).toHaveLength(3)
    expect(normalized.usage).toEqual({ xSearchCalls: 3, costTicks: 262234000 })

    const first = normalized.results.find((entry) => entry.id === "2095333026204971141")
    expect(first?.url).toBe("https://x.com/grok/status/2095333026204971141")
    expect(first?.snippet).toContain("cheque-spitting CLI")
  })

  it("#given max_results 2 on the probe fixture #when normalized #then exactly two results survive the cap", () => {
    const normalized = normalizeXSearchResponse(probeFixture, { maxResults: 2 })

    expect(normalized.results).toHaveLength(2)
    expect(normalized.queries).toHaveLength(3)
  })

  it("#given the fast-carrier fixture #when normalized #then annotation ids dedupe against the message-text URLs", () => {
    const normalized = normalizeXSearchResponse(fastFixture)

    expect(normalized.results.map((entry) => entry.id).sort()).toEqual([
      "2095271947169055077",
      "2095307098238128218",
      "2095344199851798606",
    ])
    // The annotations pass runs first, so the citation form (/i/status/) wins over the
    // handle URL echoed in the message text for the same tweet id.
    expect(normalized.results.map((entry) => entry.url)).toEqual([
      "https://x.com/i/status/2095344199851798606",
      "https://x.com/i/status/2095307098238128218",
      "https://x.com/i/status/2095271947169055077",
    ])
    expect(normalized.usage).toEqual({ xSearchCalls: 1, costTicks: 87231000 })
    expect(normalized.queries[0]).toContain("Bun 1.4 since:2026-09-01")
  })

  it("#given a citation that appears only in annotations #when normalized #then the annotations pass still recovers its id", () => {
    const normalized = normalizeXSearchResponse({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "https://x.com/grok/status/2095333026204971141 inline post",
              annotations: [
                { type: "url_citation", url: "https://x.com/grok/status/2095333026204971141", title: "1" },
                { type: "url_citation", url: "https://x.com/i/status/2095332141047431453", title: "2" },
              ],
            },
          ],
        },
      ],
    })

    expect(normalized.results.map((entry) => entry.id)).toEqual(["2095333026204971141", "2095332141047431453"])
  })

  it("#given a payload with only top-level citations #when normalized #then the citation URLs become results with url titles", () => {
    const normalized = normalizeXSearchResponse({
      output: [],
      citations: ["https://x.com/someone/status/1234567890123456789"],
    })

    expect(normalized.results).toEqual([
      {
        id: "1234567890123456789",
        url: "https://x.com/someone/status/1234567890123456789",
        title: "https://x.com/someone/status/1234567890123456789",
        snippet: "",
      },
    ])
    expect(normalized.queries).toEqual([])
    expect(normalized.usage).toEqual({ xSearchCalls: 0, costTicks: 0 })
  })

  it("#given citation titles that are bare indices or the URL itself #when normalized #then the URL is the title and a descriptive title survives", () => {
    const normalized = normalizeXSearchResponse({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "https://x.com/a/status/11 first\nhttps://x.com/b/status/22 second\nhttps://x.com/c/status/33 third",
              annotations: [
                { type: "url_citation", url: "https://x.com/a/status/11", title: "1" },
                { type: "url_citation", url: "https://x.com/b/status/22", title: "https://x.com/b/status/22" },
                { type: "url_citation", url: "https://x.com/c/status/33", title: "Real headline" },
              ],
            },
          ],
        },
      ],
    })

    expect(normalized.results.map((entry) => entry.title)).toEqual([
      "https://x.com/a/status/11",
      "https://x.com/b/status/22",
      "Real headline",
    ])
    expect(normalized.results[0]?.snippet).toBe("https://x.com/a/status/11 first")
  })

  it("#given a response with no X posts #when normalized #then results and queries are empty", () => {
    const normalized = normalizeXSearchResponse({
      output: [{ type: "message", content: [{ type: "output_text", text: "No matching posts.", annotations: [] }] }],
    })

    expect(normalized.results).toEqual([])
    expect(normalized.queries).toEqual([])
  })
})

describe("formatXSearchResult", () => {
  it("#given two results #when formatted #then the text contract renders header, blocks, and the queries line", () => {
    const text = formatXSearchResult({
      results: [
        {
          id: "1",
          url: "https://x.com/grok/status/1",
          title: "Grok ships the CLI",
          snippet: "Grok jokes about a cheque-spitting CLI.",
        },
        {
          id: "2",
          url: "https://x.com/xai/status/2",
          title: "https://x.com/xai/status/2",
          snippet: "Second post summary.",
        },
      ],
      queries: ['{"query":"Grok CLI since:2026-09-01","mode":"Latest"}'],
      usage: { xSearchCalls: 1, costTicks: 100 },
    })

    expect(text).toBe(
      [
        "x_search results: 2",
        "",
        "[1] Grok ships the CLI",
        "URL: https://x.com/grok/status/1",
        "Snippet: Grok jokes about a cheque-spitting CLI.",
        "",
        "[2] https://x.com/xai/status/2",
        "URL: https://x.com/xai/status/2",
        "Snippet: Second post summary.",
        "",
        'Queries used: {"query":"Grok CLI since:2026-09-01","mode":"Latest"}',
      ].join("\n"),
    )
  })

  it("#given zero results #when formatted #then the empty contract renders", () => {
    const text = formatXSearchResult({ results: [], queries: [], usage: { xSearchCalls: 0, costTicks: 0 } })

    expect(text).toBe("x_search results: 0\n(no matching X posts)")
  })
})

describe("formatXSearchError", () => {
  const codes: XSearchErrorCode[] = [
    "INVALID_PARAMS",
    "INVALID_FILTERS",
    "TOO_MANY_HANDLES",
    "INVALID_DATE",
    "INVALID_DATE_RANGE",
    "AUTH",
    "RATE_LIMITED",
    "UPSTREAM",
    "TIMEOUT",
    "PROTOCOL",
  ]

  it.each(codes)("#given the %s code #when formatted #then the single-line error contract renders", (code) => {
    expect(formatXSearchError(code, "something went wrong")).toBe(`x_search error [${code}]: something went wrong`)
  })
})
