import type { NormalizedXSearch, XSearchResultItem } from "./format"

export const X_SEARCH_ENDPOINT = "https://api.x.ai/v1/responses"

export const X_SEARCH_MAX_OUTPUT_TOKENS = 4000

const X_SEARCH_DEFAULT_DEADLINE_MS = 60_000

const TWEET_ID_PATTERN = /https?:\/\/(?:www\.)?x\.com\/(?:[A-Za-z0-9_]+\/status|i\/status)\/([0-9]{1,30})/
const TWEET_URL_PATTERN = new RegExp(TWEET_ID_PATTERN.source, "g")

const SERVER_QUERY_TOOL_NAMES = new Set(["x_keyword_search", "x_semantic_search", "x_user_search", "x_thread_fetch"])

export interface XSearchRequestParams {
  readonly query: string
  readonly mode: "latest" | "top"
  readonly max_results: number
  readonly from_date?: string
  readonly to_date?: string
  readonly allowed_x_handles?: readonly string[]
  readonly excluded_x_handles?: readonly string[]
  readonly enable_image_understanding?: boolean
  readonly enable_video_understanding?: boolean
}

export interface XSearchCarrier {
  readonly model: string
  readonly reasoning?: { readonly effort: string }
}

export type XSearchPromptVariant = "v1" | "v2"

export type XSearchCarrierName = "fast" | "reasoning"

export interface XSearchRequestBody {
  readonly model: string
  readonly input: ReadonlyArray<{ readonly role: "user"; readonly content: string }>
  readonly tools: readonly Record<string, unknown>[]
  readonly tool_choice: "required"
  readonly max_turns: number
  readonly parallel_tool_calls: false
  readonly max_output_tokens: number
  readonly store: false
  readonly reasoning?: { readonly effort: string }
}

function promptV1(params: XSearchRequestParams): string {
  const since = params.from_date ? ` since:${params.from_date}` : ""
  const until = params.to_date ? ` until:${params.to_date}` : ""
  return (
    `Use the x_search tool with x_keyword_search only, mode=${params.mode === "top" ? "Top" : "Latest"}. ` +
    `Run exactly this query: "${params.query}${since}${until}". ` +
    `Return up to ${params.max_results} X posts, one per line as "URL - one-line summary (@handle, YYYY-MM-DD)". ` +
    "Posts only, no commentary."
  )
}

function promptV2(params: XSearchRequestParams): string {
  return `${promptV1(params)} Prefer the most recent posts; keep the exact since: operator inside the keyword query.`
}

export const PROMPT_VARIANTS: Record<XSearchPromptVariant, (params: XSearchRequestParams) => string> = {
  v1: promptV1,
  v2: promptV2,
}

export const CARRIER_MODELS: Record<XSearchCarrierName, XSearchCarrier> = {
  fast: { model: "grok-4.20-0309-non-reasoning" },
  reasoning: { model: "grok-4.6", reasoning: { effort: "low" } },
}

export const DEFAULT_PROMPT_VARIANT: XSearchPromptVariant = "v1"

export const DEFAULT_CARRIER: XSearchCarrierName = "fast"

export function buildXSearchRequest(
  params: XSearchRequestParams,
  options: { readonly carrier: XSearchCarrier; readonly variant: XSearchPromptVariant },
): XSearchRequestBody {
  const tool: Record<string, unknown> = { type: "x_search" }
  if (params.from_date !== undefined) tool.from_date = params.from_date
  if (params.to_date !== undefined) tool.to_date = params.to_date
  if (params.allowed_x_handles !== undefined) tool.allowed_x_handles = [...params.allowed_x_handles]
  if (params.excluded_x_handles !== undefined) tool.excluded_x_handles = [...params.excluded_x_handles]
  if (params.enable_image_understanding !== undefined) tool.enable_image_understanding = params.enable_image_understanding
  if (params.enable_video_understanding !== undefined) tool.enable_video_understanding = params.enable_video_understanding

  return {
    model: options.carrier.model,
    input: [{ role: "user", content: PROMPT_VARIANTS[options.variant](params) }],
    tools: [tool],
    tool_choice: "required",
    // max_turns bounds TURNS; parallel_tool_calls:false is what bounds one turn to ONE
    // server-side x_search call, and max_output_tokens caps output+reasoning tokens.
    max_turns: 1,
    parallel_tool_calls: false,
    max_output_tokens: X_SEARCH_MAX_OUTPUT_TOKENS,
    store: false,
    ...(options.carrier.reasoning ? { reasoning: options.carrier.reasoning } : {}),
  }
}

export type XSearchFetchOutcome =
  | { readonly ok: true; readonly raw: unknown }
  | {
      readonly ok: false
      readonly code: "AUTH" | "RATE_LIMITED" | "UPSTREAM" | "TIMEOUT" | "PROTOCOL"
      readonly status?: number
      readonly retryAfter?: number
      readonly message: string
    }

/** Structural fetch port: the tool injects the host fetch, tests inject a mock. */
export type XSearchFetch = (url: string, init: RequestInit) => Promise<Response>

export interface PerformXSearchOptions {
  readonly fetch: XSearchFetch
  readonly bearer: string
  readonly body: unknown
  readonly signal?: AbortSignal
  readonly deadlineMs?: number
  readonly endpoint?: string
}

export async function performXSearch(options: PerformXSearchOptions): Promise<XSearchFetchOutcome> {
  const deadlineMs = options.deadlineMs ?? X_SEARCH_DEFAULT_DEADLINE_MS
  const controller = new AbortController()
  const abortForCaller = () => controller.abort()
  options.signal?.addEventListener("abort", abortForCaller)
  const timer = setTimeout(abortForCaller, deadlineMs)

  try {
    const response = await options.fetch(options.endpoint ?? X_SEARCH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.bearer}` },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    })

    if (!response.ok) return failureFromStatus(response)

    const text = await response.text()
    try {
      return { ok: true, raw: JSON.parse(text) as unknown }
    } catch {
      return { ok: false, code: "PROTOCOL", status: response.status, message: "xAI returned a non-JSON response" }
    }
  } catch (error) {
    if (isAbortError(error)) return { ok: false, code: "TIMEOUT", message: `xAI request aborted after ${deadlineMs}ms` }
    return { ok: false, code: "UPSTREAM", message: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", abortForCaller)
  }
}

function failureFromStatus(response: Response): XSearchFetchOutcome {
  const status = response.status
  if (status === 401 || status === 403) {
    return { ok: false, code: "AUTH", status, message: "xAI rejected the credential" }
  }
  if (status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"))
    return {
      ok: false,
      code: "RATE_LIMITED",
      status,
      ...(retryAfter === undefined ? {} : { retryAfter }),
      message: "xAI rate limited the request",
    }
  }
  return { ok: false, code: "UPSTREAM", status, message: `xAI responded with HTTP ${status}` }
}

function parseRetryAfter(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const seconds = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function tweetId(url: string): string | undefined {
  return TWEET_ID_PATTERN.exec(url)?.[1]
}

interface MessageText {
  readonly text: string
  readonly annotations: unknown[]
}

function collectMessageTexts(output: unknown[]): MessageText[] {
  return output.flatMap((rawItem) => {
    const item = asObject(rawItem)
    if (item?.type !== "message") return []
    return asArray(item.content).flatMap((rawPart) => {
      const part = asObject(rawPart)
      const text = asString(part?.text)
      if (text === undefined) return []
      return [{ text, annotations: asArray(part?.annotations) }]
    })
  })
}

function snippetFor(url: string, id: string, texts: readonly MessageText[]): string {
  for (const entry of texts) {
    for (const line of entry.text.split("\n")) {
      if (line.includes(url) || line.includes(`/status/${id}`)) return line.trim()
    }
  }
  return ""
}

function descriptiveTitle(rawTitle: string | undefined, url: string): string {
  if (rawTitle === undefined) return url
  if (/^\d+$/.test(rawTitle)) return url
  if (/^https?:\/\//.test(rawTitle)) return url
  return rawTitle
}

function collectQueries(output: unknown[]): string[] {
  return output.flatMap((rawItem) => {
    const item = asObject(rawItem)
    if (item?.type !== "custom_tool_call" && item?.type !== "x_search_call") return []
    const name = asString(item.name)
    if (name === undefined || !SERVER_QUERY_TOOL_NAMES.has(name)) return []
    const input = asString(item.input)
    if (input === undefined) return []
    try {
      const parsed = asObject(JSON.parse(input) as unknown)
      if (parsed === undefined) return []
      return [
        Object.entries(parsed)
          .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
          .join(" "),
      ]
    } catch {
      return []
    }
  })
}

export function normalizeXSearchResponse(raw: unknown, options: { readonly maxResults?: number } = {}): NormalizedXSearch {
  const payload = asObject(raw) ?? {}
  const output = asArray(payload.output)
  const texts = collectMessageTexts(output)

  const byId = new Map<string, XSearchResultItem>()
  const add = (url: string, title: string | undefined): void => {
    const id = tweetId(url)
    if (id === undefined || byId.has(id)) return
    byId.set(id, { id, url, title: descriptiveTitle(title, url), snippet: snippetFor(url, id, texts) })
  }

  for (const entry of texts) {
    for (const rawAnnotation of entry.annotations) {
      const annotation = asObject(rawAnnotation)
      if (annotation?.type !== "url_citation") continue
      const url = asString(annotation.url)
      if (url === undefined) continue
      add(url, asString(annotation.title))
    }
  }

  for (const entry of texts) {
    for (const match of entry.text.matchAll(TWEET_URL_PATTERN)) add(match[0], undefined)
  }

  for (const rawCitation of asArray(payload.citations)) {
    const url = asString(rawCitation)
    if (url !== undefined) add(url, undefined)
  }

  const results = [...byId.values()]
  const usage = asObject(payload.usage)
  const toolUsage = asObject(usage?.server_side_tool_usage_details)

  return {
    results: options.maxResults === undefined ? results : results.slice(0, options.maxResults),
    queries: collectQueries(output),
    usage: {
      xSearchCalls: typeof toolUsage?.x_search_calls === "number" ? toolUsage.x_search_calls : 0,
      costTicks: typeof usage?.cost_in_usd_ticks === "number" ? usage.cost_in_usd_ticks : 0,
    },
  }
}
