import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exportToCurlReplay } from "../../features/probe-lab/exporters/curl-replay-exporter"
import { exportToMitmproxyFlows } from "../../features/probe-lab/exporters/mitmproxy-flow-exporter"
import { exportToOpenApiYaml } from "../../features/probe-lab/exporters/openapi-yaml-exporter"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import type { ProbeExchange } from "../../features/probe-lab/types"

type ExportFormat = "har" | "jsonl" | "mitmproxy_mitm" | "curl_replay" | "openapi_yaml" | "markdown_report"

export function createProbeExportTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Export probe-lab sessions as HAR, JSONL, markdown, OpenAPI YAML, mitmproxy JSONL flows, or a curl replay shell script.",
    args: {
      session_id: tool.schema.string().optional(),
      experiment_id: tool.schema.string().optional(),
      hypothesis_id: tool.schema.string().optional(),
      format: tool.schema.enum(["har", "jsonl", "mitmproxy_mitm", "curl_replay", "openapi_yaml", "markdown_report"]),
      output_path: tool.schema.string().optional(),
      include_bodies: tool.schema.boolean().default(true),
      include_evidence: tool.schema.boolean().default(false),
      anonymize_credentials: tool.schema.boolean().default(true),
    },
    async execute(args) {
      try {
        const rows = collectRows(ctx, args)
        const filePath = args.output_path ?? defaultPath(args.format)
        await Bun.write(filePath, render(args.format, rows, args))
        return JSON.stringify({
          file_path: filePath,
          format: args.format,
          file_size_bytes: statSync(filePath).size,
          exchange_count: rows.length,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_export failed: ${message}`
      }
    },
  })
}

function collectRows(ctx: ProbeLabContext, args: { session_id?: string; hypothesis_id?: string; experiment_id?: string }): ProbeExchange[] {
  if (args.session_id) return ctx.store.listExchangesForSession(args.session_id, 10_000, 0)
  if (args.hypothesis_id) return ctx.store.listExchangesForHypothesis(args.hypothesis_id, 10_000, 0)
  if (args.experiment_id) {
    return ctx.store.listSessionsForExperiment(args.experiment_id).flatMap((session) => ctx.store.listExchangesForSession(session.id, 10_000, 0))
  }
  return []
}

function render(format: ExportFormat, rows: ProbeExchange[], args: { include_bodies: boolean; anonymize_credentials: boolean }): string {
  if (format === "openapi_yaml") return exportToOpenApiYaml({ rows, anonymizeCredentials: args.anonymize_credentials })
  if (format === "mitmproxy_mitm") return exportToMitmproxyFlows({ rows, anonymizeCredentials: args.anonymize_credentials, includeBodies: args.include_bodies })
  if (format === "curl_replay") return exportToCurlReplay({ rows, anonymizeCredentials: args.anonymize_credentials, includeBodies: args.include_bodies })
  const shaped = rows.map((row) => shape(row, args.include_bodies, args.anonymize_credentials))
  if (format === "jsonl") return shaped.map((row) => JSON.stringify(row)).join("\n")
  if (format === "markdown_report") return renderMarkdown(shaped)
  return JSON.stringify({ log: { version: "1.2", creator: { name: "probe-lab", version: "0.5" }, entries: shaped.map(toHarEntry) } }, null, 2)
}

function shape(row: ProbeExchange, includeBodies: boolean, redact: boolean): Record<string, unknown> {
  const headers = redact ? redactHeaders(row.request_headers) : row.request_headers
  const base = { id: row.id, session_id: row.session_id, method: row.method, url: row.url, request_headers: headers, response_status: row.response_status, response_headers: row.response_headers, timing_total_ms: row.timing_total_ms }
  if (!includeBodies) return base
  return { ...base, request_body: redact ? redactText(row.request_body) : toText(row.request_body), response_body: redact ? redactText(row.response_body) : toText(row.response_body) }
}

function toHarEntry(row: Record<string, unknown>): Record<string, unknown> {
  return { startedDateTime: new Date().toISOString(), time: row.timing_total_ms ?? 0, request: { method: row.method, url: row.url, headers: row.request_headers ?? [] }, response: { status: row.response_status ?? 0, headers: row.response_headers ?? [] } }
}

function renderMarkdown(rows: Array<Record<string, unknown>>): string {
  const lines = ["# Probe Lab Export", "", `Exchange count: ${rows.length}`, ""]
  for (const row of rows) lines.push(`- ${row.method} ${row.url} -> ${row.response_status}`)
  return `${lines.join("\n")}\n`
}

function redactHeaders(headers: string | null): string | null {
  if (!headers) return null
  try {
    const parsed = JSON.parse(headers) as Record<string, string>
    const redacted = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, isSecretHeader(key) ? "REDACTED" : value]))
    return JSON.stringify(redacted)
  } catch {
    return redactText(headers)
  }
}

function redactText(value: Buffer | string | null): string | null {
  return toText(value)?.replace(/Bearer\s+[^"\s]+/gi, "Bearer REDACTED").replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1REDACTED") ?? null
}

function toText(value: Buffer | string | null): string | null {
  if (value == null) return null
  return typeof value === "string" ? value : value.toString("utf8")
}

function isSecretHeader(key: string): boolean {
  return ["authorization", "cookie", "x-api-key", "api-key"].includes(key.toLowerCase())
}

function defaultPath(format: ExportFormat): string {
  const ext =
    format === "markdown_report" ? "md"
    : format === "har" ? "har"
    : format === "openapi_yaml" ? "yaml"
    : format === "curl_replay" ? "sh"
    : "jsonl"
  return join(tmpdir(), `probe-lab-export-${Date.now()}.${ext}`)
}
