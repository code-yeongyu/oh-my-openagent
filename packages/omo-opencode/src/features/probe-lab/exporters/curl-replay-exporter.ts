import type { ProbeExchange } from "../types"

export type CurlReplayExportInput = {
  rows: ReadonlyArray<ProbeExchange>
  anonymizeCredentials: boolean
  includeBodies: boolean
}

export function exportToCurlReplay(input: CurlReplayExportInput): string {
  const lines: string[] = ["#!/usr/bin/env bash", "set -euo pipefail", "", "# probe-lab curl replay script", ""]
  for (const row of input.rows) lines.push(...renderExchange(row, input.includeBodies, input.anonymizeCredentials))
  return `${lines.join("\n")}\n`
}

function renderExchange(row: ProbeExchange, includeBodies: boolean, anonymize: boolean): string[] {
  const lines: string[] = [`# exchange ${row.id} (session ${row.session_id})`]
  const headers = parseHeaders(row.request_headers)
  const headerArgs = Object.entries(headers).map(([key, value]) => `  -H ${shellQuote(`${key}: ${maybeRedactHeader(key, value, anonymize)}`)}`)
  const dataArg = includeBodies && row.request_body != null
    ? `  --data ${shellQuote(maybeRedactBody(toText(row.request_body) ?? "", anonymize))}`
    : null
  lines.push(`curl -sS -X ${row.method} ${shellQuote(row.url)} \\`)
  for (let i = 0; i < headerArgs.length; i++) {
    const isLast = i === headerArgs.length - 1 && !dataArg
    lines.push(`${headerArgs[i]}${isLast ? "" : " \\"}`)
  }
  if (dataArg) lines.push(dataArg)
  lines.push("")
  return lines
}

function parseHeaders(json: string | null): Record<string, string> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

function maybeRedactHeader(key: string, value: string, anonymize: boolean): string {
  if (!anonymize) return value
  return ["authorization", "cookie", "x-api-key", "api-key"].includes(key.toLowerCase()) ? "REDACTED" : value
}

function maybeRedactBody(body: string, anonymize: boolean): string {
  if (!anonymize) return body
  return body.replace(/Bearer\s+[^"\s]+/gi, "Bearer REDACTED").replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1REDACTED")
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function toText(value: Buffer | string | null): string | null {
  if (value == null) return null
  return typeof value === "string" ? value : value.toString("utf8")
}
