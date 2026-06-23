import type {
  CredentialRefreshResult,
  CredentialRotationResult,
  ErrorTaxonomy,
  HealthCheckResult,
  ProbeError,
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
  ProviderCredentials,
  RateLimitConfig,
} from "./provider-types"
import { dispatchProbe as rawDispatch } from "../probe-dispatcher"

const ERROR_TAXONOMY: ErrorTaxonomy = {
  rate_limited_signals: ["empty_sse_200", "429_json"],
  blocked_signals: ["403_html"],
}

export function createDs2ApiProvider(creds: ProviderCredentials): ProbeProvider {
  const auth = parseAuth(creds.auth_config)

  function buildHeaders(custom: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {}
    if (creds.default_headers) {
      const defaults = JSON.parse(creds.default_headers) as Record<string, string>
      Object.assign(out, defaults)
    }
    if (auth.bearer) out.Authorization = `Bearer ${auth.bearer}`
    Object.assign(out, custom)
    return out
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const url = creds.health_check_url ?? `${creds.base_url.replace(/\/$/, "")}/v1/models`
    try {
      const res = await fetch(url, { headers: buildHeaders({}) })
      return {
        ok: res.ok,
        status_code: res.status,
        message: res.ok ? "ok" : `health check returned ${res.status}`,
        checked_at: Math.floor(Date.now() / 1000),
      }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        checked_at: Math.floor(Date.now() / 1000),
      }
    }
  }

  async function dispatchProbe(request: ProbeRequest): Promise<ProbeResponse> {
    const headers = buildHeaders(request.headers ?? {})
    const outcome = await rawDispatch({
      url: request.url,
      method: request.method,
      headers,
      body: request.body,
      timeout_ms: request.timeout_ms,
      forward_as_is: request.forward_as_is,
    })
    const error = mapError(outcome)
    return {
      status: outcome.status ?? 0,
      headers: outcome.response_headers ?? {},
      body: outcome.response_body ?? "",
      timing: { total_ms: outcome.timing_total_ms },
      identity_used: null,
      fingerprint_used: null,
      retry_count: 0,
      error,
    }
  }

  return {
    id: creds.id,
    kind: "ds2api",
    healthCheck,
    refreshCredentials: async (refreshType: string): Promise<CredentialRefreshResult> => ({
      success: true,
      refresh_type: refreshType,
      message: "ds2api uses bearer token; no refresh required",
    }),
    rotateCredentials: async (reason: string): Promise<CredentialRotationResult> => ({
      success: false,
      rotation_type: reason,
      new_value_hash: undefined,
    }),
    dispatchProbe,
    getRateLimits: (): RateLimitConfig => ({
      rps: creds.rate_limit_rps,
      rpm: creds.rate_limit_rpm,
      tpm: creds.rate_limit_tpm,
      cooldown_on_429_s: creds.cooldown_on_429_s,
    }),
    getErrorTaxonomy: () => ERROR_TAXONOMY,
    getSupportedModels: () => parseModels(creds.supported_models),
  }
}

function parseAuth(authConfigJson: string): { bearer: string | null } {
  try {
    const parsed = JSON.parse(authConfigJson) as Record<string, string>
    return { bearer: parsed.bearer_token ?? parsed.token ?? null }
  } catch {
    return { bearer: null }
  }
}

function parseModels(json: string | null): ReadonlyArray<string> {
  if (!json) return []
  try {
    return JSON.parse(json) as ReadonlyArray<string>
  } catch {
    return []
  }
}

function mapError(outcome: { ok: boolean; status: number | null; response_body: string | null; error_message?: string }): ProbeError | undefined {
  if (outcome.error_message) {
    const msg = outcome.error_message.toLowerCase()
    if (msg.includes("aborted") || msg.includes("timeout")) {
      return { kind: "timeout", message: outcome.error_message, retryable: true }
    }
    if (msg.includes("econn") || msg.includes("refused") || msg.includes("reset")) {
      return { kind: "connection_refused", message: outcome.error_message, retryable: true }
    }
    return { kind: "unknown", message: outcome.error_message, retryable: false }
  }
  if (outcome.status == null) return undefined
  if (outcome.status === 429) {
    return { kind: "rate_limited", message: "ds2api rate-limited", http_status: 429, retryable: true }
  }
  if (outcome.status === 403) {
    return { kind: "blocked", message: "ds2api blocked", http_status: 403, retryable: false }
  }
  if (outcome.status === 200 && (outcome.response_body == null || outcome.response_body.trim() === "")) {
    return {
      kind: "rate_limited",
      message: "ds2api 200 + empty SSE (downstream rate-limit)",
      http_status: 200,
      retryable: true,
    }
  }
  if (outcome.status >= 500) {
    return { kind: "http_error", message: `ds2api ${outcome.status}`, http_status: outcome.status, retryable: true }
  }
  return undefined
}
