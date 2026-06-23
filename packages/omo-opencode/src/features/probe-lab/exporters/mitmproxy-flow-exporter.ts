import type { ProbeExchange } from "../types"

export type MitmproxyExportInput = {
  rows: ReadonlyArray<ProbeExchange>
  anonymizeCredentials: boolean
  includeBodies: boolean
}

export function exportToMitmproxyFlows(input: MitmproxyExportInput): string {
  return input.rows
    .map((row) => JSON.stringify(toFlow(row, input.includeBodies, input.anonymizeCredentials)))
    .join("\n")
}

type FlowRecord = {
  type: "http"
  id: string
  request: { method: string; scheme: string; host: string; port: number; path: string; http_version: string; headers: Array<[string, string]>; content: string | null }
  response: { status_code: number; reason: string; http_version: string; headers: Array<[string, string]>; content: string | null } | null
  metadata: { exchange_id: number; session_id: string; timing_total_ms: number | null; was_forwarded_as_is: number }
}

function toFlow(row: ProbeExchange, includeBodies: boolean, anonymize: boolean): FlowRecord {
  const parsedUrl = parseUrl(row.url)
  const requestHeaders = redactHeaders(parseHeaders(row.request_headers), anonymize)
  const responseHeaders = redactHeaders(parseHeaders(row.response_headers), anonymize)
  return {
    type: "http",
    id: `pl-${row.id}`,
    request: {
      method: row.method,
      scheme: parsedUrl.scheme,
      host: parsedUrl.host,
      port: parsedUrl.port,
      path: parsedUrl.path,
      http_version: "HTTP/1.1",
      headers: toHeaderArray(requestHeaders),
      content: includeBodies ? maybeRedactBody(toText(row.request_body), anonymize) : null,
    },
    response: row.response_status == null
      ? null
      : {
          status_code: row.response_status,
          reason: "",
          http_version: "HTTP/1.1",
          headers: toHeaderArray(responseHeaders),
          content: includeBodies ? maybeRedactBody(toText(row.response_body), anonymize) : null,
        },
    metadata: {
      exchange_id: row.id,
      session_id: row.session_id,
      timing_total_ms: row.timing_total_ms,
      was_forwarded_as_is: row.was_forwarded_as_is,
    },
  }
}

function parseUrl(url: string): { scheme: string; host: string; port: number; path: string } {
  try {
    const parsed = new URL(url)
    return {
      scheme: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
      path: `${parsed.pathname}${parsed.search}`,
    }
  } catch {
    return { scheme: "https", host: "", port: 443, path: url }
  }
}

function parseHeaders(json: string | null): Record<string, string> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

function toHeaderArray(headers: Record<string, string>): Array<[string, string]> {
  return Object.entries(headers).map(([key, value]) => [key, value] as [string, string])
}

function redactHeaders(headers: Record<string, string>, anonymize: boolean): Record<string, string> {
  if (!anonymize) return headers
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) out[key] = isSecretHeader(key) ? "REDACTED" : value
  return out
}

function maybeRedactBody(body: string | null, anonymize: boolean): string | null {
  if (body == null) return null
  if (!anonymize) return body
  return body.replace(/Bearer\s+[^"\s]+/gi, "Bearer REDACTED").replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1REDACTED")
}

function isSecretHeader(key: string): boolean {
  return ["authorization", "cookie", "x-api-key", "api-key"].includes(key.toLowerCase())
}

function toText(value: Buffer | string | null): string | null {
  if (value == null) return null
  return typeof value === "string" ? value : value.toString("utf8")
}
