import type { ProbeError } from "./provider-types"

function looksLikeJwtExpired(body: string | null): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return (
    lower.includes("token expired") ||
    lower.includes("invalid token") ||
    lower.includes("unauthenticated") ||
    lower.includes("jwt")
  )
}

export function mapManusWebError(
  status: number | null,
  body: string | null,
  errMsg: string | null,
): ProbeError | undefined {
  if (errMsg) {
    const m = errMsg.toLowerCase()
    if (m.includes("aborted") || m.includes("timeout")) {
      return { kind: "timeout", message: errMsg, retryable: true }
    }
    return { kind: "unknown", message: errMsg, retryable: false }
  }
  if (status == null) return undefined
  if (status === 429) {
    return {
      kind: "rate_limited",
      message: "manus-web 429",
      http_status: 429,
      retryable: true,
      response_body_preview: (body ?? "").slice(0, 200),
    }
  }
  if (status === 401) {
    return {
      kind: "blocked",
      message: looksLikeJwtExpired(body) ? "manus-web 401 (JWT expired or invalid)" : "manus-web 401",
      http_status: 401,
      retryable: false,
      response_body_preview: (body ?? "").slice(0, 200),
    }
  }
  if (status === 403) {
    return {
      kind: "blocked",
      message: "manus-web 403",
      http_status: 403,
      retryable: false,
      response_body_preview: (body ?? "").slice(0, 200),
    }
  }
  if (status >= 500) {
    return { kind: "http_error", message: `manus-web ${status}`, http_status: status, retryable: true }
  }
  return undefined
}
