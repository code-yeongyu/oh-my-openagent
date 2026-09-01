import {
  DEFAULT_WEBFETCH_TIMEOUT_MS,
  MAX_WEBFETCH_REDIRECTS,
  MAX_WEBFETCH_TIMEOUT_MS,
  WEBFETCH_REDIRECT_STATUSES,
} from "./constants"

export type WebFetchFormat = "markdown" | "text" | "html"

type RedirectResolutionParams = {
  url: string
  format: WebFetchFormat
  timeoutSeconds?: number
}

export type RedirectResolutionResult =
  | { type: "resolved"; url: string }
  | { type: "exceeded"; url: string; maxRedirects: number }

function buildAcceptHeader(format: WebFetchFormat): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  }
}

function buildWebFetchHeaders(format: WebFetchFormat): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    Accept: buildAcceptHeader(format),
    "Accept-Language": "en-US,en;q=0.9",
  }
}

function normalizeTimeoutMs(timeoutSeconds?: number): number {
  if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return DEFAULT_WEBFETCH_TIMEOUT_MS
  }

  return Math.min(timeoutSeconds * 1000, MAX_WEBFETCH_TIMEOUT_MS)
}

function resolveRedirectLocation(currentUrl: string, location: string): string {
  return new URL(location, currentUrl).toString()
}

export async function resolveWebFetchRedirects(
  params: RedirectResolutionParams,
): Promise<RedirectResolutionResult> {
  const timeoutMs = normalizeTimeoutMs(params.timeoutSeconds)
  const signal = AbortSignal.timeout(timeoutMs)
  const headers = buildWebFetchHeaders(params.format)

  let currentUrl = params.url
  let redirectCount = 0

  while (true) {
    const response = await fetch(currentUrl, {
      headers,
      redirect: "manual",
      signal,
    })

    if (!WEBFETCH_REDIRECT_STATUSES.has(response.status)) {
      return { type: "resolved", url: currentUrl }
    }

    const location = response.headers.get("location")
    if (!location) {
      return { type: "resolved", url: currentUrl }
    }

    if (redirectCount >= MAX_WEBFETCH_REDIRECTS) {
      return {
        type: "exceeded",
        url: params.url,
        maxRedirects: MAX_WEBFETCH_REDIRECTS,
      }
    }

    currentUrl = resolveRedirectLocation(currentUrl, location)
    redirectCount += 1
  }
}
