import type { ProbeError } from "./provider-types"

function looksLikeAwsWafChallenge(body: string | null): boolean {
  if (!body) return false
  return body.includes("awswaf.com") || body.includes("captcha-prod.awswaf") || body.includes("/challenge.js")
}

export function mapDeepSeekWebError(status: number | null, body: string | null, errMsg: string | null): ProbeError | undefined {
  if (errMsg) {
    const m = errMsg.toLowerCase()
    if (m.includes("aborted") || m.includes("timeout")) return { kind: "timeout", message: errMsg, retryable: true }
    return { kind: "unknown", message: errMsg, retryable: false }
  }
  if (status == null) return undefined
  if (status === 429) return { kind: "rate_limited", message: "deepseek-web 429", http_status: 429, retryable: true }
  if (status === 401 || status === 403) return { kind: "blocked", message: `deepseek-web ${status}`, http_status: status, retryable: false }
  if (looksLikeAwsWafChallenge(body)) return { kind: "captcha", message: "aws-waf challenge interstitial", http_status: status, retryable: true, response_body_preview: (body ?? "").slice(0, 200) }
  if (status >= 500) return { kind: "http_error", message: `deepseek-web ${status}`, http_status: status, retryable: true }
  return undefined
}
