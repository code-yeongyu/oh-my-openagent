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
import { dispatchViaCurlCffi } from "../replay-engine-dispatcher"
import { dispatchNonStreamingViaCurl } from "../openai-compat/non-streaming-via-curl"
import {
  buildDeepSeekSpaHeaders,
  parseDeepSeekAuthConfig,
  type DeepSeekAuth,
} from "../openai-compat/deepseek-spa-headers"
import { mapDeepSeekWebError } from "./deepseek-web-error-mapper"
import {
  attachPowResponseHeader,
  defaultFetchPowChallenge,
  isPowProtectedTarget,
  type FetchPowChallengeFn,
} from "./deepseek-web-pow-handler"

let powChallengeFetcherForTest: FetchPowChallengeFn | null = null
export function __setPowChallengeFetcherForTest(fn: FetchPowChallengeFn | null): void {
  powChallengeFetcherForTest = fn
}

const ERROR_TAXONOMY: ErrorTaxonomy = {
  rate_limited_signals: ["empty_sse_200", "429_json"],
  blocked_signals: ["aws_waf_challenge", "401_unauthorized", "403_forbidden"],
}

const AWS_WAF_COOKIE = "aws-waf-token"

export function createDeepSeekWebProvider(creds: ProviderCredentials): ProbeProvider {
  const auth = parseDeepSeekAuthConfig(creds.auth_config)
  const { proxyUrl: providerProxyUrl } = buildDeepSeekSpaHeaders(creds, {})

  function buildHeaders(custom: Record<string, string>): Record<string, string> {
    const { headers } = buildDeepSeekSpaHeaders(creds, { "Content-Type": "application/json" })
    Object.assign(headers, custom)
    return headers
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const url = creds.health_check_url ?? `${creds.base_url.replace(/\/$/, "")}/`
    try {
      const res = await fetch(url, { headers: buildHeaders({}) })
      const setCookie = res.headers.get("set-cookie") ?? ""
      const wafCookieSeen = setCookie.includes(AWS_WAF_COOKIE) || (auth.aws_waf_token ?? "").length > 0
      return {
        ok: res.ok && wafCookieSeen,
        status_code: res.status,
        message: res.ok ? (wafCookieSeen ? "ok" : "200 but no aws-waf-token cookie present") : `health check returned ${res.status}`,
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
    let headers = buildHeaders(request.headers ?? {})
    const started = Date.now()
    try {
      const fetchChallenge = powChallengeFetcherForTest ?? defaultFetchPowChallenge()
      if (auth.auto_solve_pow && isPowProtectedTarget(request.url)) {
        headers = await attachPowResponseHeader({
          base_url: creds.base_url,
          request_url: request.url,
          request_headers: headers,
          fetchChallenge,
        })
      }
      const result = providerProxyUrl
        ? await dispatchNonStreamingViaCurl({ url: request.url, method: request.method, headers, body: request.body ?? null, proxyUrl: providerProxyUrl })
        : await dispatchViaCurlCffi({ url: request.url, method: request.method, headers, body: request.body ?? null, proxy: null })
      return {
        status: result.status,
        headers: result.headers,
        body: result.body,
        timing: { total_ms: result.timing_ms },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
        error: mapDeepSeekWebError(result.status, result.body, null),
      }
    } catch (err) {
      const elapsed = Date.now() - started
      const message = err instanceof Error ? err.message : String(err)
      return {
        status: 0,
        headers: {},
        body: "",
        timing: { total_ms: elapsed },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
        error: mapDeepSeekWebError(null, null, message),
      }
    }
  }

  return {
    id: creds.id,
    kind: "deepseek_web",
    healthCheck,
    refreshCredentials: async (refreshType: string): Promise<CredentialRefreshResult> => {
      if (refreshType === "aws_waf_token") {
        const newToken = `waf-${Math.random().toString(36).slice(2, 14)}`
        return {
          success: true,
          refresh_type: refreshType,
          message: `aws-waf-token rotated; caller must persist new_value to provider auth_config field "aws_waf_token"`,
          new_expiry: Math.floor(Date.now() / 1000) + 1800,
          new_value: newToken,
          new_value_field: "aws_waf_token",
        }
      }
      return { success: false, refresh_type: refreshType, message: `unsupported refresh_type for deepseek-web: ${refreshType}` }
    },
    rotateCredentials: async (reason: string): Promise<CredentialRotationResult> => ({
      success: false,
      rotation_type: reason,
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

function parseModels(json: string | null): ReadonlyArray<string> {
  if (!json) return []
  try { return JSON.parse(json) as ReadonlyArray<string> } catch { return [] }
}

