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

export class ErrorDiagnoser {
  static diagnose(error: unknown, headers?: Record<string, string>): DiagnoseResult {
    const errorStr = String(error)
    
    if (headers) {
      const retryAfter = headers["retry-after"] || headers["x-ratelimit-reset"]
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10)
        if (!isNaN(seconds)) {
          return {
            action: "COOLING",
            reason: `Retry-After header: ${seconds}s`,
            cooldownMs: seconds * 1000
          }
        }
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
