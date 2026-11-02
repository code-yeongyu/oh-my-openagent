export type XSearchErrorCode =
  | "INVALID_PARAMS"
  | "INVALID_FILTERS"
  | "TOO_MANY_HANDLES"
  | "INVALID_DATE"
  | "INVALID_DATE_RANGE"
  | "AUTH"
  | "RATE_LIMITED"
  | "UPSTREAM"
  | "TIMEOUT"
  | "PROTOCOL"

export interface XSearchResultItem {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly snippet: string
}

export interface XSearchUsage {
  readonly xSearchCalls: number
  readonly costTicks: number
}

export interface NormalizedXSearch {
  readonly results: readonly XSearchResultItem[]
  readonly queries: readonly string[]
  readonly usage: XSearchUsage
}

const EMPTY_RESULT_TEXT = "x_search results: 0\n(no matching X posts)"

export function formatXSearchResult(normalized: NormalizedXSearch): string {
  if (normalized.results.length === 0) return EMPTY_RESULT_TEXT

  const lines: string[] = [`x_search results: ${normalized.results.length}`, ""]
  normalized.results.forEach((entry, index) => {
    lines.push(`[${index + 1}] ${entry.title}`, `URL: ${entry.url}`, `Snippet: ${entry.snippet}`, "")
  })
  lines.push(`Queries used: ${normalized.queries.join(" | ")}`)
  return lines.join("\n")
}

export function formatXSearchError(code: XSearchErrorCode, message: string): string {
  return `x_search error [${code}]: ${message}`
}
