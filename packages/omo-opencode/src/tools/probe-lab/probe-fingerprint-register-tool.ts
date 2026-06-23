import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const DESCRIPTION = `Register a fingerprint profile (TLS + HTTP + UA + headers).

v0.2 LIMITATION: detection_risk is set to a default 0.5 baseline; calibration via probe_fingerprint_verify is the v0.3 mechanism.`

const NAME_DESC = "Logical name"
const ENGINE_DESC = "Transport engine (curl_cffi, camoufox, nodriver, bun_fetch, go_utls, custom)"
const UA_DESC = "User agent string"
const TLS_DESC = "JA3/JA4 TLS fingerprint hash if known"
const HTTP_DESC = "Negotiated HTTP version (default HTTP/2)"
const HEADER_ORDER_DESC = "Canonical header order list"
const EXTRA_HEADERS_DESC = "Headers attached to every request"

export function createProbeFingerprintRegisterTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      name: tool.schema.string().min(1).describe(NAME_DESC),
      engine: tool.schema.enum(["curl_cffi", "camoufox", "nodriver", "bun_fetch", "go_utls", "custom"]).describe(ENGINE_DESC),
      user_agent: tool.schema.string().describe(UA_DESC),
      tls_fingerprint: tool.schema.string().optional().describe(TLS_DESC),
      http_version: tool.schema.enum(["HTTP/1.1", "HTTP/2", "HTTP/3"]).default("HTTP/2").describe(HTTP_DESC),
      sec_ch_ua: tool.schema.string().optional(),
      header_order: tool.schema.array(tool.schema.string()).optional().describe(HEADER_ORDER_DESC),
      extra_headers: tool.schema.record(tool.schema.string(), tool.schema.string()).optional().describe(EXTRA_HEADERS_DESC),
    },
    async execute(args) {
      try {
        const id = `fp-${randomUUID()}`
        const row = ctx.store.insertFingerprintProfile({
          id,
          name: args.name,
          engine: args.engine,
          user_agent: args.user_agent,
          tls_fingerprint: args.tls_fingerprint ?? null,
          http_version: args.http_version,
          sec_ch_ua: args.sec_ch_ua ?? null,
          header_order: args.header_order,
          extra_headers: args.extra_headers,
        })
        ctx.store.recordFingerprintDetectionScore(id, 0.5)
        return JSON.stringify({
          fingerprint_id: row.id,
          name: row.name,
          engine: row.engine,
          detection_risk: 0.5,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_fingerprint_register failed: ${message}`
      }
    },
  })
}
