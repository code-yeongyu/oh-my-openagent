import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import type { ProbeExchange } from "../../features/probe-lab/types"

const DESCRIPTION = `Retrieve captured probe exchanges, filtered by session, exchange ids, or hypothesis. JSONL format writes to /tmp/probe-lab-captures-{session-id}-{ts}.jsonl and returns the path; JSON returns inline (request/response bodies always included by default but truncated at max_body_bytes).`

const SESSION_ID_DESC = "Filter by session id"
const EXCHANGE_IDS_DESC = "Specific exchange ids (overrides other filters)"
const HYPOTHESIS_ID_DESC = "Filter by hypothesis (joins via evidence)"
const FORMAT_DESC = "json (inline) | jsonl (file) | har (v0.3 — currently throws not_implemented)"
const INCLUDE_BODIES_DESC = "Whether to include request/response bodies (default true)"
const MAX_BODY_DESC = "Truncate bodies past this byte count"

export function createProbeCaptureGetTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      session_id: tool.schema.string().optional().describe(SESSION_ID_DESC),
      exchange_ids: tool.schema.array(tool.schema.number().int()).optional().describe(EXCHANGE_IDS_DESC),
      hypothesis_id: tool.schema.string().optional().describe(HYPOTHESIS_ID_DESC),
      limit: tool.schema.number().int().min(1).max(500).default(50),
      offset: tool.schema.number().int().min(0).default(0),
      format: tool.schema.enum(["json", "jsonl", "har"]).default("json").describe(FORMAT_DESC),
      include_bodies: tool.schema.boolean().default(true).describe(INCLUDE_BODIES_DESC),
      max_body_bytes: tool.schema.number().int().default(65536).describe(MAX_BODY_DESC),
    },
    async execute(args) {
      try {
        if (args.format === "har") {
          return "[ERROR] HAR export deferred to v0.3"
        }
        const { rows, total } = collectExchanges(ctx, args)
        const shaped = rows.map((row) => shapeExchange(ctx, row, args.include_bodies, args.max_body_bytes))
        if (args.format === "jsonl") {
          const filePath = join(
            tmpdir(),
            `probe-lab-captures-${args.session_id ?? "any"}-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`,
          )
          const body = shaped.map((row) => JSON.stringify(row)).join("\n")
          await Bun.write(filePath, body)
          return JSON.stringify({
            exchanges: [],
            total_count: total,
            has_more: args.offset + shaped.length < total,
            export_file_path: filePath,
            exchange_count: shaped.length,
          })
        }
        return JSON.stringify({
          exchanges: shaped,
          total_count: total,
          has_more: args.offset + shaped.length < total,
          export_file_path: null,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_capture_get failed: ${message}`
      }
    },
  })
}

function collectExchanges(
  ctx: ProbeLabContext,
  args: { session_id?: string; exchange_ids?: ReadonlyArray<number>; hypothesis_id?: string; limit: number; offset: number },
): { rows: ProbeExchange[]; total: number } {
  if (args.exchange_ids && args.exchange_ids.length > 0) {
    const rows = ctx.store.listExchangesByIds(args.exchange_ids)
    return { rows, total: rows.length }
  }
  if (args.session_id) {
    const rows = ctx.store.listExchangesForSession(args.session_id, args.limit, args.offset)
    const total = ctx.store.countExchangesForSession(args.session_id)
    return { rows, total }
  }
  if (args.hypothesis_id) {
    const rows = ctx.store.listExchangesForHypothesis(args.hypothesis_id, args.limit, args.offset)
    const total = ctx.store.countExchangesForHypothesis(args.hypothesis_id)
    return { rows, total }
  }
  return { rows: [], total: 0 }
}

function shapeExchange(ctx: ProbeLabContext, row: ProbeExchange, includeBodies: boolean, maxBodyBytes: number): Record<string, unknown> {
  const session = ctx.store.getSession(row.session_id)
  const provider = session?.provider_id ? ctx.store.getProvider(session.provider_id) : null
  const base = {
    id: row.id,
    session_id: row.session_id,
    timestamp: row.timestamp,
    method: row.method,
    url: row.url,
    request_headers: row.request_headers,
    response_status: row.response_status,
    response_headers: row.response_headers,
    timing_total_ms: row.timing_total_ms,
    provider_id: session?.provider_id ?? null,
    provider_name: provider?.name ?? null,
  }
  if (!includeBodies) return base
  return {
    ...base,
    request_body: bound(row.request_body, maxBodyBytes),
    response_body: bound(row.response_body, maxBodyBytes),
  }
}

function bound(body: Buffer | string | null, maxBytes: number): string | null {
  if (body == null) return null
  const str = typeof body === "string" ? body : body.toString("utf-8")
  return str.length > maxBytes ? `${str.slice(0, maxBytes)}…[truncated]` : str
}
