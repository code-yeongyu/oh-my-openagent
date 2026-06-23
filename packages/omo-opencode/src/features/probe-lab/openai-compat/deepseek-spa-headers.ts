import type { ProviderCredentials } from "../providers/provider-types"
import { extractProxyUrl } from "./proxy-config"

export const DEEPSEEK_SPA_BASE_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    "x-app-version": "2.0.0",
    "x-client-platform": "web",
    "x-client-version": "2.0.0",
    "x-client-locale": "en_US",
    "x-client-timezone-offset": "0",
  })

export function mergeSpaBaseHeaders(
  extra: Record<string, string>,
): Record<string, string> {
  return { ...DEEPSEEK_SPA_BASE_HEADERS, ...extra }
}

const AWS_WAF_COOKIE = "aws-waf-token"

export type DeepSeekAuth = {
  aws_waf_token?: string
  session_cookie?: string
  authorization?: string
  cookie_extra?: string
  auto_solve_pow?: boolean
}

export function parseDeepSeekAuthConfig(json: string): DeepSeekAuth {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const stringField = (k: string) =>
      typeof parsed[k] === "string" ? (parsed[k] as string) : undefined
    return {
      aws_waf_token: stringField("aws_waf_token"),
      session_cookie: stringField("session_cookie") ?? stringField("cookie"),
      authorization:
        stringField("authorization") ??
        (stringField("bearer_token")
          ? `Bearer ${stringField("bearer_token")}`
          : undefined),
      cookie_extra: stringField("cookie_extra"),
      auto_solve_pow: parsed.auto_solve_pow === true,
    }
  } catch {
    return {}
  }
}

export function buildDeepSeekCookie(auth: DeepSeekAuth): string {
  const parts: string[] = []
  if (auth.aws_waf_token) parts.push(`${AWS_WAF_COOKIE}=${auth.aws_waf_token}`)
  if (auth.session_cookie) parts.push(auth.session_cookie)
  if (auth.cookie_extra) parts.push(auth.cookie_extra)
  return parts.join("; ")
}

/**
 * Builds the canonical set of outgoing headers that DeepSeek SPA expects.
 *
 * Assembles: SPA identity headers → provider-level overrides (from
 * default_headers minus __proxy_url__) → Cookie (aws-waf-token + session +
 * extras) → Authorization (bearer_token if present).
 *
 * Returns both the headers dict and the proxy URL extracted from
 * default_headers (if any) so the caller can route through a proxy.
 */
export function buildDeepSeekSpaHeaders(
  creds: ProviderCredentials,
  extras: Record<string, string> = {},
): { headers: Record<string, string>; proxyUrl: string | null } {
  const auth = parseDeepSeekAuthConfig(creds.auth_config)
  const { proxyUrl, headers: providerHeaders } = extractProxyUrl(
    creds.default_headers,
  )
  const headers = mergeSpaBaseHeaders({ ...extras })
  Object.assign(headers, providerHeaders)
  const cookie = buildDeepSeekCookie(auth)
  if (cookie) headers.Cookie = cookie
  if (auth.authorization) headers.Authorization = auth.authorization
  return { headers, proxyUrl }
}
