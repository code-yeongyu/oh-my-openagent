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
import { dispatchViaCamoufox } from "../replay-engine-dispatcher"

const ERROR_TAXONOMY: ErrorTaxonomy = {
  rate_limited_signals: ["429_json"],
  blocked_signals: ["401_unauthorized", "403_forbidden"],
}

export function createGeminiWebReverseProvider(creds: ProviderCredentials): ProbeProvider {
  const auth = parseAuth(creds.auth_config)

  function buildHeaders(custom: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = { "Content-Type": "application/json" }
    if (creds.default_headers) Object.assign(out, JSON.parse(creds.default_headers) as Record<string, string>)
    if (auth.session_cookie) out.Cookie = auth.session_cookie
    Object.assign(out, custom)
    return out
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const url = creds.health_check_url ?? `${creds.base_url.replace(/\/$/, "")}/`
    try {
      const result = await dispatchViaCamoufox({ url, method: "GET", headers: buildHeaders({}), body: null })
      return { ok: result.status >= 200 && result.status < 400, status_code: result.status, message: result.status < 400 ? "ok" : `health returned ${result.status}`, checked_at: Math.floor(Date.now() / 1000) }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), checked_at: Math.floor(Date.now() / 1000) }
    }
  }

  async function dispatchProbe(request: ProbeRequest): Promise<ProbeResponse> {
    const headers = buildHeaders(request.headers ?? {})
    try {
      const result = await dispatchViaCamoufox({ url: request.url, method: request.method, headers, body: request.body ?? null })
      return {
        status: result.status,
        headers: result.headers,
        body: result.body,
        timing: { total_ms: result.timing_ms },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
        error: mapError(result.status, null),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        status: 0,
        headers: {},
        body: "",
        timing: { total_ms: 0 },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
        error: mapError(null, message),
      }
    }
  }

  return {
    id: creds.id,
    kind: "gemini_web_reverse",
    healthCheck,
    refreshCredentials: async (refreshType: string): Promise<CredentialRefreshResult> => ({
      success: refreshType === "session_cookie",
      refresh_type: refreshType,
      message: refreshType === "session_cookie" ? "session cookie refresh requires browser flow; mark stale" : `unsupported refresh_type: ${refreshType}`,
    }),
    rotateCredentials: async (reason: string): Promise<CredentialRotationResult> => ({ success: false, rotation_type: reason }),
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

type GeminiAuth = { session_cookie?: string }

function parseAuth(json: string): GeminiAuth {
  try {
    const parsed = JSON.parse(json) as Record<string, string>
    return { session_cookie: parsed.session_cookie ?? parsed.cookie }
  } catch { return {} }
}

function parseModels(json: string | null): ReadonlyArray<string> {
  if (!json) return []
  try { return JSON.parse(json) as ReadonlyArray<string> } catch { return [] }
}

function mapError(status: number | null, errMsg: string | null): ProbeError | undefined {
  if (errMsg) {
    const m = errMsg.toLowerCase()
    if (m.includes("aborted") || m.includes("timeout")) return { kind: "timeout", message: errMsg, retryable: true }
    return { kind: "unknown", message: errMsg, retryable: false }
  }
  if (status == null) return undefined
  if (status === 429) return { kind: "rate_limited", message: "gemini-web 429", http_status: 429, retryable: true }
  if (status === 401 || status === 403) return { kind: "blocked", message: `gemini-web ${status}`, http_status: status, retryable: false }
  if (status >= 500) return { kind: "http_error", message: `gemini-web ${status}`, http_status: status, retryable: true }
  return undefined
}
