import type { DiagnoseResult, RecoveryAction } from "./types"

const PATTERNS: Array<{ regex: RegExp; action: RecoveryAction; type: string }> = [
  { regex: /insufficient balance/i, action: "LOCKED", type: "balance" },
  { regex: /usage limit reached/i, action: "LOCKED", type: "balance" },
  { regex: /quota exceeded/i, action: "COOLING", type: "quota" },
  { regex: /rate limit/i, action: "COOLING", type: "rate_limit" },
  { regex: /429/i, action: "COOLING", type: "rate_limit" },
  { regex: /overloaded/i, action: "COOLING", type: "overloaded" },
  { regex: /503/i, action: "COOLING", type: "server_error" },
  { regex: /502/i, action: "COOLING", type: "server_error" },
  { regex: /500/i, action: "COOLING", type: "server_error" },
  { regex: /unavailable/i, action: "COOLING", type: "availability" },
  { regex: /not found/i, action: "COOLING", type: "availability" },
  { regex: /does not exist/i, action: "COOLING", type: "availability" },
  { regex: /unsupported/i, action: "COOLING", type: "availability" },
  { regex: /context length/i, action: "SKIP", type: "context_length" },
  { regex: /maximum context/i, action: "SKIP", type: "context_length" },
  { regex: /token limit/i, action: "SKIP", type: "context_length" },
]

function parseRetryAfterMs(value: string, headerName: "retry-after" | "x-ratelimit-reset"): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const now = Date.now()

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed)
    if (!Number.isFinite(num) || num < 0) return null

    if (headerName === "retry-after") {
      return Math.round(num * 1000)
    }

    const isLikelyEpochSeconds = num >= 1_000_000_000
    const isLikelyEpochMs = num >= 1_000_000_000_000

    const targetMs = isLikelyEpochMs
      ? Math.round(num)
      : isLikelyEpochSeconds
        ? Math.round(num * 1000)
        : now + Math.round(num * 1000)

    const delta = targetMs - now
    return delta > 0 ? delta : null
  }

  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return null

  const delta = dateMs - now
  return delta > 0 ? delta : null
}

export class ErrorDiagnoser {
  static diagnose(error: unknown, headers?: Record<string, string>): DiagnoseResult {
    const errorStr = String(error)
    
    if (headers) {
      const retryAfter = headers["retry-after"]
      const rateLimitReset = headers["x-ratelimit-reset"]

      const retryAfterMs = retryAfter ? parseRetryAfterMs(retryAfter, "retry-after") : null
      if (retryAfterMs !== null) {
        return { action: "COOLING", reason: `Retry-After header`, cooldownMs: retryAfterMs }
      }

      const resetMs = rateLimitReset ? parseRetryAfterMs(rateLimitReset, "x-ratelimit-reset") : null
      if (resetMs !== null) {
        return { action: "COOLING", reason: `x-ratelimit-reset header`, cooldownMs: resetMs }
      }
    }

    for (const pattern of PATTERNS) {
      if (pattern.regex.test(errorStr)) {
        return {
          action: pattern.action,
          reason: `Matched pattern: ${pattern.type}`
        }
      }
    }

    return {
      action: "RETRY",
      reason: "Unknown error, default retry"
    }
  }
}
