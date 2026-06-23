import type {
  CredentialRefreshResult,
  CredentialRotationResult,
  ErrorTaxonomy,
  HealthCheckResult,
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
  ProviderCredentials,
  RateLimitConfig,
} from "./provider-types"
import { buildManusHeaders, parseManusAuthConfig } from "./manus-web-headers"
import { mapManusWebError } from "./manus-web-error-mapper"

export type ManusFetchFn = (
  url: string,
  init: RequestInit & { proxy?: string },
) => Promise<Response>

let fetchForTest: ManusFetchFn | null = null
export function __setManusFetchForTest(fn: ManusFetchFn | null): void {
  fetchForTest = fn
}

const ERROR_TAXONOMY: ErrorTaxonomy = {
  rate_limited_signals: ["429_json", "rate_limit_header"],
  blocked_signals: ["401_unauthorized", "403_forbidden", "jwt_expired"],
}

const DEFAULT_HEALTH_PATH = "/user.v1.UserService/UserInfo"
const KIND = "manus_web"

function parseModels(json: string | null): ReadonlyArray<string> {
  if (!json) return []
  try {
    return JSON.parse(json) as ReadonlyArray<string>
  } catch {
    return []
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function createManusWebProvider(creds: ProviderCredentials): ProbeProvider {
  const auth = parseManusAuthConfig(creds.auth_config)
  const proxyUrl = auth.proxy_url

  function buildHeaders(custom: Record<string, string>): Record<string, string> {
    return buildManusHeaders(auth, custom)
  }

  function doFetch(url: string, init: RequestInit): Promise<Response> {
    const impl: ManusFetchFn = fetchForTest ?? ((u, i) => fetch(u, i as RequestInit))
    const withProxy: RequestInit & { proxy?: string } = proxyUrl ? { ...init, proxy: proxyUrl } : init
    return impl(url, withProxy)
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = nowSeconds()
    if (!auth.jwt_token) {
      return { ok: false, message: "missing jwt_token in auth_config", checked_at: checkedAt }
    }
    const baseUrl = creds.base_url.replace(/\/$/, "")
    const url = creds.health_check_url ?? `${baseUrl}${DEFAULT_HEALTH_PATH}`
    try {
      const res = await doFetch(url, { method: "POST", headers: buildHeaders({}), body: "{}" })
      if (res.status === 200) {
        return { ok: true, status_code: 200, message: "ok", checked_at: checkedAt }
      }
      const message =
        res.status === 401
          ? "401 — JWT expired or invalid"
          : `health check returned ${res.status}`
      return { ok: false, status_code: res.status, message, checked_at: checkedAt }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        checked_at: checkedAt,
      }
    }
  }

  async function dispatchProbe(request: ProbeRequest): Promise<ProbeResponse> {
    const headers = request.forward_as_is ? request.headers : buildHeaders(request.headers ?? {})
    const started = Date.now()
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), request.timeout_ms)
    const fetchInit: RequestInit = {
      method: request.method,
      headers,
      signal: controller.signal,
    }
    if (request.body !== undefined) {
      fetchInit.body = request.body as BodyInit
    }
    try {
      const res = await doFetch(request.url, fetchInit)
      const body = await res.text()
      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })
      return {
        status: res.status,
        headers: responseHeaders,
        body,
        timing: { total_ms: Date.now() - started },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
        error: mapManusWebError(res.status, body, null),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        status: 0,
        headers: {},
        body: "",
        timing: { total_ms: Date.now() - started },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
        error: mapManusWebError(null, null, message),
      }
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  async function refreshCredentials(refreshType: string): Promise<CredentialRefreshResult> {
    if (refreshType === "jwt_token") {
      return {
        success: false,
        refresh_type: refreshType,
        message:
          "manus_web JWT refresh not yet implemented — caller must re-authenticate via signup pipeline or persist a fresh JWT into auth_config.jwt_token",
      }
    }
    return {
      success: false,
      refresh_type: refreshType,
      message: `unsupported refresh_type for manus-web: ${refreshType}`,
    }
  }

  async function rotateCredentials(reason: string): Promise<CredentialRotationResult> {
    return { success: false, rotation_type: reason }
  }

  return {
    id: creds.id,
    kind: KIND,
    healthCheck,
    refreshCredentials,
    rotateCredentials,
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
