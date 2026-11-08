import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"

import { resolveXaiBearer, type XaiAuthRegistry } from "./auth"
import {
  buildXSearchRequest,
  CARRIER_MODELS,
  DEFAULT_CARRIER,
  DEFAULT_PROMPT_VARIANT,
  normalizeXSearchResponse,
  performXSearch,
  type XSearchFetch,
  type XSearchRequestParams,
} from "./client"
import { formatXSearchError, formatXSearchResult, type NormalizedXSearch, type XSearchErrorCode } from "./format"
import { validateXSearchParams, XSearchParams } from "./params"

export const X_SEARCH_TOOL_NAME = "x_search"

export const X_SEARCH_MODEL_ENV = "OMO_X_SEARCH_MODEL"

/**
 * Condensed form of the four SKILL.md rules, four sentences. It rides the tool_search catalog and
 * the promoted tool description, so it stays short enough to promote without a prompt-cache hit;
 * the full rationale lives in skill/SKILL.md, which the component contributes as a skill path.
 */
export const X_SEARCH_TOOL_DESCRIPTION =
  "Searches X (Twitter) posts through xAI. " +
  "Date-bound time-sensitive queries with from_date (>= yesterday), scope trusted accounts with allowed_x_handles (max 20), phrase as latest/recent, and run 2-3 narrower searches (by handle, by keyword) instead of one broad query. " +
  "Returns x.com URLs with one-line summaries plus the exact server queries used. " +
  "Requires a connected xAI account."

/** Structural slice of senpi's ExtensionContext: execute only needs the refresh-aware registry. */
export interface XSearchToolExecutionContext {
  readonly modelRegistry: XaiAuthRegistry
}

export interface XSearchToolDetails {
  readonly results: NormalizedXSearch["results"]
  readonly queries: NormalizedXSearch["queries"]
  readonly usage: NormalizedXSearch["usage"]
  readonly code?: XSearchErrorCode
}

export interface CreateXSearchToolOptions {
  readonly fetchImpl?: XSearchFetch
  readonly env?: Record<string, string | undefined>
  /** Test/injection seam; production resolves per call through ctx.modelRegistry. */
  readonly resolveBearer?: typeof resolveXaiBearer
}

/**
 * The agent loop honors an inline `isError` on the returned result (senpi builtin tool convention,
 * same shape the memory tools use); `AgentToolResult` itself does not declare the flag.
 */
export type XSearchToolExecutionResult = AgentToolResult<XSearchToolDetails> & { readonly isError?: boolean }

const EMPTY_USAGE = { xSearchCalls: 0, costTicks: 0 } as const

function errorResult(code: XSearchErrorCode, message: string): XSearchToolExecutionResult {
  return {
    content: [{ type: "text", text: formatXSearchError(code, message) }],
    details: { results: [], queries: [], usage: EMPTY_USAGE, code },
    isError: true,
  }
}

function requestParams(params: XSearchParams): XSearchRequestParams {
  return {
    query: params.query,
    mode: params.mode ?? "latest",
    max_results: params.max_results ?? 10,
    ...(params.from_date === undefined ? {} : { from_date: params.from_date }),
    ...(params.to_date === undefined ? {} : { to_date: params.to_date }),
    ...(params.allowed_x_handles === undefined ? {} : { allowed_x_handles: params.allowed_x_handles }),
    ...(params.excluded_x_handles === undefined ? {} : { excluded_x_handles: params.excluded_x_handles }),
    ...(params.enable_image_understanding === undefined
      ? {}
      : { enable_image_understanding: params.enable_image_understanding }),
    ...(params.enable_video_understanding === undefined
      ? {}
      : { enable_video_understanding: params.enable_video_understanding }),
  }
}

export function createXSearchTool(
  options: CreateXSearchToolOptions = {},
): ToolDefinition<typeof XSearchParams, XSearchToolDetails> {
  const env = options.env ?? process.env
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init))
  const resolveBearer = options.resolveBearer ?? resolveXaiBearer

  return {
    name: X_SEARCH_TOOL_NAME,
    label: "Search X posts",
    description: X_SEARCH_TOOL_DESCRIPTION,
    parameters: XSearchParams,
    exposure: "search",
    searchGroup: "x-search",
    searchKeywords: ["X posts", "tweets", "twitter search", "xAI live search", "what people are saying on X"],
    allowLazyActivation: true,
    // Read-only network call: safe to run alongside other tool calls in the same batch.
    executionMode: "parallel",
    async execute(_toolCallId, params, signal, _onUpdate, ectx): Promise<XSearchToolExecutionResult> {
      const validation = validateXSearchParams(params)
      if (!validation.ok) return errorResult(validation.code, validation.message)

      // Refresh-aware: the bearer is resolved per call through the live registry, never cached
      // at registration time, so an OAuth token refreshed mid-session is picked up.
      const credential = await resolveBearer({
        modelRegistry: (ectx as unknown as XSearchToolExecutionContext).modelRegistry,
        env,
      })
      if (credential === undefined) {
        return errorResult("AUTH", "no xAI credential is connected; run /login and pick xAI, or set XAI_API_KEY")
      }

      const carrier = CARRIER_MODELS[DEFAULT_CARRIER]
      const model = env[X_SEARCH_MODEL_ENV]?.trim()
      const body = buildXSearchRequest(requestParams(validation.value), {
        carrier: model ? { ...carrier, model } : carrier,
        variant: DEFAULT_PROMPT_VARIANT,
      })

      const outcome = await performXSearch({
        fetch: fetchImpl,
        bearer: credential.bearer,
        body,
        ...(signal === undefined ? {} : { signal }),
      })
      if (!outcome.ok) return errorResult(outcome.code, outcome.message)

      const normalized = normalizeXSearchResponse(outcome.raw, { maxResults: validation.value.max_results ?? 10 })
      return {
        content: [{ type: "text", text: formatXSearchResult(normalized) }],
        details: { results: normalized.results, queries: normalized.queries, usage: normalized.usage },
      }
    },
  }
}
