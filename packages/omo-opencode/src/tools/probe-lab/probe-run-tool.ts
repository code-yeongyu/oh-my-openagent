import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { dispatchProbe } from "../../features/probe-lab/probe-dispatcher"
import { dispatchProbeImpit } from "../../features/probe-lab/probe-dispatcher-impit"
import { NoIdentityAvailableError, PoolUnhealthyError } from "../../features/probe-lab/identity-pool"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import type { ProbeRequest, ProbeResponse } from "../../features/probe-lab/providers/provider-types"
import { isGlobalKillSwitchActive } from "./probe-kill-switch"

const DESCRIPTION = `Dispatch a single HTTP request through probe-lab, capturing the full request/response to the SQLite ledger for later evidence linkage.

When provider_id is set, the request is routed through that provider's adapter (with its auth, default headers, and error mapping). When omitted, falls back to raw bun fetch dispatch (v0.1 behaviour). The provider_id is persisted on probe_sessions.provider_id so cross-provider comparison via probe_capture_get is possible.

If identity_id is omitted and the pool is empty, the request is sent anonymously (no proxy, no rotation). Pass forward_as_is=true to send the literal headers and body without any transformation.`

const URL_DESC = "Target URL"
const METHOD_DESC = "HTTP method (default POST)"
const HEADERS_DESC = "Request headers, forwarded as-is"
const BODY_DESC = "Literal request body"
const IDENTITY_DESC = "Identity id from the probe pool. Omit to use the first active non-quarantined identity, or to dispatch anonymously if the pool is empty."
const PROVIDER_DESC = "Optional provider id to route the probe through. When present, the request is dispatched via the provider's adapter (with that provider's auth, headers, error mapping). When absent, falls back to raw dispatch (v0.1 behaviour)."
const SESSION_LABEL_DESC = "Joins or creates a probe session under this label"
const HYPOTHESIS_ID_DESC = "Hypothesis to link this probe to"
const TIMEOUT_DESC = "Timeout in milliseconds (default 30000, max 120000)"
const FORWARD_DESC = "If true, bypass any transforms; send exact headers + body"
const TRANSPORT_DESC = "Transport stack: 'fetch' (Bun native, generic JA3) | 'impit-firefox' (TLS fingerprint Firefox via impit) | 'impit-chrome' (Chrome via impit). Default 'fetch'."
const PROXY_URL_DESC = "Optional HTTP/HTTPS/SOCKS5 proxy URL (e.g. http://user:pass@host:port). Only applied to 'impit-firefox' / 'impit-chrome' transports."

export function createProbeRunTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      url: tool.schema.string().url().describe(URL_DESC),
      method: tool.schema.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]).default("POST").describe(METHOD_DESC),
      headers: tool.schema.record(tool.schema.string(), tool.schema.string()).optional().describe(HEADERS_DESC),
      body: tool.schema.string().optional().describe(BODY_DESC),
      identity_id: tool.schema.string().optional().describe(IDENTITY_DESC),
      provider_id: tool.schema.string().optional().describe(PROVIDER_DESC),
      session_label: tool.schema.string().optional().describe(SESSION_LABEL_DESC),
      hypothesis_id: tool.schema.string().optional().describe(HYPOTHESIS_ID_DESC),
      timeout_ms: tool.schema.number().int().min(1000).max(120000).default(30000).describe(TIMEOUT_DESC),
      forward_as_is: tool.schema.boolean().default(false).describe(FORWARD_DESC),
      transport: tool.schema.enum(["fetch", "impit-firefox", "impit-chrome"]).default("fetch").describe(TRANSPORT_DESC),
      proxy_url: tool.schema.string().optional().describe(PROXY_URL_DESC),
    },
    async execute(args) {
      try {
        if (isGlobalKillSwitchActive(ctx)) {
          return "[ERROR] global_kill_switch is active; probe_run rejected. Disable via probe_lab_config to resume."
        }
        let provider = null
        if (args.provider_id) {
          ctx.providerRegistry.loadAll()
          provider = ctx.providerRegistry.get(args.provider_id)
          if (!provider) return `[ERROR] provider not found: ${args.provider_id}`
        }
        const acquired = tryAcquire(ctx, args.identity_id)
        const identityId = acquired?.identity.id ?? null
        const existing = args.session_label
          ? ctx.store.findSessionByLabel(args.session_label)
          : null
        if (args.session_label && existing && existing.provider_id !== (args.provider_id ?? null)) {
          return `[ERROR] session label '${args.session_label}' already has provider '${existing.provider_id}', cannot mix with '${args.provider_id ?? null}'`
        }
        const session = existing ?? ctx.store.insertSession({
          id: `sess-${randomUUID()}`,
          hypothesis_id: args.hypothesis_id ?? null,
          identity_id: identityId,
          provider_id: args.provider_id ?? null,
          config: args.session_label ? { label: args.session_label } : null,
        })
        const outcome = provider
          ? await dispatchViaProvider(provider, args, session.id)
          : args.transport === "fetch"
              ? await dispatchRaw(args)
              : await dispatchProbeImpit({
                  url: args.url,
                  method: args.method,
                  headers: args.headers,
                  body: args.body,
                  timeout_ms: args.timeout_ms,
                  forward_as_is: args.forward_as_is,
                  browser: args.transport === "impit-chrome" ? "chrome" : "firefox",
                  proxy: args.proxy_url,
                })
        const exchange = ctx.store.insertExchange({
          session_id: session.id,
          method: args.method,
          url: args.url,
          request_headers: args.headers ?? null,
          request_body: args.body ?? null,
          response_status: outcome.status,
          response_headers: outcome.response_headers ?? null,
          response_body: outcome.response_body ?? outcome.error_message ?? null,
          timing_total_ms: outcome.timing_total_ms,
          was_forwarded_as_is: args.forward_as_is,
        })
        if (acquired) {
          if (outcome.ok) ctx.pool.reportSuccess(acquired.identity.id)
          else ctx.pool.reportFailure(acquired.identity.id)
        }
        return JSON.stringify({
          exchange_id: exchange.id,
          session_id: session.id,
          identity_id: identityId,
          provider_id: args.provider_id ?? null,
          status: outcome.status,
          ok: outcome.ok,
          timing_ms: outcome.timing_total_ms,
          response_headers: outcome.response_headers,
          response_body_preview: previewOf(outcome.response_body ?? outcome.error_message ?? ""),
          error: outcome.error_message ?? null,
        })
      } catch (err) {
        if (err instanceof PoolUnhealthyError) return `[ERROR] ${err.message}`
        if (err instanceof NoIdentityAvailableError) {
          return "[ERROR] no active identity available; either add an identity or omit identity_id when pool is empty"
        }
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_run failed: ${message}`
      }
    },
  })
}

type DispatchArgs = {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  timeout_ms: number
  forward_as_is: boolean
  hypothesis_id?: string
}

type RunOutcome = {
  ok: boolean
  status: number | null
  response_headers: Record<string, string> | null
  response_body: string | null
  timing_total_ms: number
  error_message?: string
}

async function dispatchRaw(args: DispatchArgs): Promise<RunOutcome> {
  return dispatchProbe({
    url: args.url,
    method: args.method,
    headers: args.headers,
    body: args.body,
    timeout_ms: args.timeout_ms,
    forward_as_is: args.forward_as_is,
  })
}

async function dispatchViaProvider(
  provider: { dispatchProbe: (req: ProbeRequest) => Promise<ProbeResponse> },
  args: DispatchArgs,
  sessionId: string,
): Promise<RunOutcome> {
  const request: ProbeRequest = {
    url: args.url,
    method: args.method,
    headers: args.headers ?? {},
    body: args.body,
    timeout_ms: args.timeout_ms,
    forward_as_is: args.forward_as_is,
    metadata: {
      session_id: sessionId,
      hypothesis_id: args.hypothesis_id,
      exchange_sequence: 1,
    },
  }
  const response = await provider.dispatchProbe(request)
  const ok = response.error == null && response.status >= 200 && response.status < 400
  return {
    ok,
    status: response.status,
    response_headers: response.headers,
    response_body: response.body,
    timing_total_ms: response.timing.total_ms,
    error_message: response.error?.message,
  }
}

function tryAcquire(
  ctx: ProbeLabContext,
  preferredId: string | undefined,
): { identity: { id: string } } | null {
  const health = ctx.pool.getHealth()
  if (preferredId == null && health.total === 0) return null
  return ctx.pool.acquire(preferredId)
}

function previewOf(body: string): string {
  return body.length <= 4096 ? body : `${body.slice(0, 4096)}…[truncated]`
}
