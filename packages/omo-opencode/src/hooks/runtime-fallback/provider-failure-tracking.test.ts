import { describe, expect, test } from "bun:test"
import {
  createFallbackState,
  extractProviderFromModel,
  isProviderInCooldown,
  markProviderFailed,
  findNextAvailableFallback,
  prepareFallback,
} from "./fallback-state"
import {
  snapshotFallbackState,
  restoreFallbackState,
} from "./fallback-state-snapshot"

describe("provider-level failure tracking", () => {
  describe("extractProviderFromModel", () => {
    test("extracts provider from model string", () => {
      expect(extractProviderFromModel("openai/gpt-4o")).toBe("openai")
      expect(extractProviderFromModel("anthropic/claude-3.5-sonnet")).toBe("anthropic")
      expect(extractProviderFromModel("google/gemini-pro")).toBe("google")
    })

    test("returns undefined for invalid model strings", () => {
      expect(extractProviderFromModel("gpt-4o")).toBeUndefined()
      expect(extractProviderFromModel("")).toBeUndefined()
    })
  })

  describe("createFallbackState with failedProviders", () => {
    test("initializes failedProviders map", () => {
      const state = createFallbackState("openai/gpt-4o")
      expect(state.failedProviders).toBeDefined()
      expect(state.failedProviders.size).toBe(0)
    })
  })

  describe("markProviderFailed", () => {
    test("marks provider as failed", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      expect(state.failedProviders.has("openai")).toBe(true)
      expect(state.failedProviders.get("openai")).toBeDefined()
    })

    test("does nothing for invalid model string", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("invalid-model", state)
      expect(state.failedProviders.size).toBe(0)
    })
  })

  describe("isProviderInCooldown", () => {
    test("returns false when provider not in cooldown", () => {
      const state = createFallbackState("openai/gpt-4o")
      expect(isProviderInCooldown("openai/gpt-4o", state, 60)).toBe(false)
    })

    test("returns true when provider in cooldown", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      expect(isProviderInCooldown("openai/gpt-4o-mini", state, 60)).toBe(true)
      expect(isProviderInCooldown("openai/gpt-4-turbo", state, 60)).toBe(true)
    })

    test("returns false for different provider", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      expect(isProviderInCooldown("anthropic/claude-3.5-sonnet", state, 60)).toBe(false)
    })
  })

  describe("findNextAvailableFallback with provider cooldown", () => {
    test("skips models from failed provider", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      
      const fallbackModels = [
        "openai/gpt-4o-mini",      // Same provider - should skip
        "openai/gpt-4-turbo",      // Same provider - should skip
        "anthropic/claude-3.5-sonnet", // Different provider - should select
      ]
      
      const next = findNextAvailableFallback(state, fallbackModels, 60)
      expect(next?.model).toBe("anthropic/claude-3.5-sonnet")
    })

    test("returns undefined when all providers in cooldown", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      markProviderFailed("anthropic/claude-3.5-sonnet", state)
      
      const fallbackModels = [
        "openai/gpt-4o-mini",
        "anthropic/claude-3.5-sonnet",
      ]
      
      const next = findNextAvailableFallback(state, fallbackModels, 60)
      expect(next).toBeUndefined()
    })
  })

  describe("prepareFallback with isProviderFailure", () => {
    test("marks provider failed when isProviderFailure is true", () => {
      const state = createFallbackState("openai/gpt-4o")
      const fallbackModels = ["anthropic/claude-3.5-sonnet"]
      const config = {
        enabled: true,
        max_fallback_attempts: 3,
        cooldown_seconds: 60,
        timeout_seconds: 30,
        retry_on_errors: [429, 500, 502, 503, 504],
      }
      
      const result = prepareFallback(
        "test-session",
        state,
        fallbackModels,
        config as any,
        { isProviderFailure: true }
      )
      
      expect(result.success).toBe(true)
      expect(state.failedProviders.has("openai")).toBe(true)
    })

    test("does not mark provider failed when isProviderFailure is false", () => {
      const state = createFallbackState("openai/gpt-4o")
      const fallbackModels = ["anthropic/claude-3.5-sonnet"]
      const config = {
        enabled: true,
        max_fallback_attempts: 3,
        cooldown_seconds: 60,
        timeout_seconds: 30,
        retry_on_errors: [429, 500, 502, 503, 504],
      }
      
      const result = prepareFallback(
        "test-session",
        state,
        fallbackModels,
        config as any,
        { isProviderFailure: false }
      )
      
      expect(result.success).toBe(true)
      expect(state.failedProviders.has("openai")).toBe(false)
    })
  })
})

describe("fallback-state-snapshot round-trip", () => {
  test("preserves failedProviders across snapshot/restore", () => {
    const state = createFallbackState("openai/gpt-4o")
    markProviderFailed("openai/gpt-4o", state)
    state.failedModels.set("openai/gpt-4o", Date.now())
    state.attemptCount = 2
    state.currentModel = "anthropic/claude-3.5-sonnet"
    state.fallbackIndex = 1

    const snapshot = snapshotFallbackState(state)
    
    // Mutate original state
    state.failedProviders.clear()
    state.failedModels.clear()
    state.attemptCount = 0

    // Restore from snapshot
    restoreFallbackState(state, snapshot)

    expect(state.failedProviders.has("openai")).toBe(true)
    expect(state.failedModels.has("openai/gpt-4o")).toBe(true)
    expect(state.attemptCount).toBe(2)
    expect(state.currentModel).toBe("anthropic/claude-3.5-sonnet")
    expect(state.fallbackIndex).toBe(1)
  })

  test("snapshot is independent copy (no shared references)", () => {
    const state = createFallbackState("openai/gpt-4o")
    markProviderFailed("openai/gpt-4o", state)
    
    const snapshot = snapshotFallbackState(state)
    
    // Mutating original should not affect snapshot
    state.failedProviders.set("anthropic", Date.now())
    
    expect(snapshot.failedProviders.has("anthropic")).toBe(false)
    expect(snapshot.failedProviders.size).toBe(1)
  })
})

describe("error type classification from retry messages", () => {
  // These patterns mirror those used in session-status-handler.ts
  const RATE_LIMIT_PATTERNS = [
    "rate limit exceeded",
    "Rate-Limit: too many requests",
    "429 Too Many Requests",
    "quota will reset after 2024-01-01",
    "quota exceeded for this month",
    "You have exhausted your capacity",
    "limit exhausted",
    "cooling down, please try again later",
    "频率限制",
    "使用上限",
    "请求过于频繁",
  ]

  const OVERLOAD_PATTERNS = [
    "overloaded, please try again later",
    "529 model overloaded",
  ]

  const TRANSIENT_PATTERNS = [
    "500 Internal Server Error",
    "503 Service Unavailable",
    "connection reset",
    "timeout",
  ]

  function classifyErrorType(retryMessage: string): string | undefined {
    const messageLower = retryMessage.toLowerCase()
    if (/rate.?limit|too.?many.?requests|(?:^|\s)429(?:\s|$)|quota|exhausted.*capacity|limit\s+exhausted|cool.*down|频率限制|使用上限|请求过于频繁/.test(messageLower)) {
      return "rate_limit"
    }
    if (/overloaded|(?:^|\s)529(?:\s|$)/.test(messageLower)) {
      return "quota_exceeded"
    }
    return undefined
  }

  test("classifies rate limit patterns as rate_limit", () => {
    for (const msg of RATE_LIMIT_PATTERNS) {
      expect(classifyErrorType(msg)).toBe("rate_limit")
    }
  })

  test("classifies overload patterns as quota_exceeded", () => {
    for (const msg of OVERLOAD_PATTERNS) {
      expect(classifyErrorType(msg)).toBe("quota_exceeded")
    }
  })

  test("returns undefined for transient errors (no provider-level marking)", () => {
    for (const msg of TRANSIENT_PATTERNS) {
      expect(classifyErrorType(msg)).toBeUndefined()
    }
  })
})

describe("event-handler errorType resolution", () => {
  // Simulates the logic in event-handler.ts for resolving errorType
  function resolveErrorType(error: unknown, statusCode: number | undefined): string | undefined {
    const errorMsg = (typeof error === "string" ? error : String((error as Record<string, unknown>)?.message ?? "")).toLowerCase()
    const isQuotaExceeded = /quota.?exceeded|exceeded.*quota|usage\s*quota|exhausted\s+your\s+capacity|limit\s+exhausted|使用上限|额度.*不足|余额.*不足/.test(errorMsg)
    const isRateLimit =
      statusCode === 429 ||
      statusCode === 529 ||
      /rate.?limit|too.?many.?requests|cool.*down|频率限制|使用上限|请求过于频繁/.test(errorMsg)
    
    if (isQuotaExceeded) return "quota_exceeded"
    if (isRateLimit) return "rate_limit"
    return undefined
  }

  test("classifies 429 status code as rate_limit", () => {
    expect(resolveErrorType({ message: "Too Many Requests" }, 429)).toBe("rate_limit")
  })

  test("classifies 529 status code as rate_limit", () => {
    expect(resolveErrorType({ message: "Model overloaded" }, 529)).toBe("rate_limit")
  })

  test("classifies rate limit message as rate_limit", () => {
    expect(resolveErrorType({ message: "Rate limit exceeded for API key" }, undefined)).toBe("rate_limit")
  })

  test("classifies quota exceeded as quota_exceeded", () => {
    expect(resolveErrorType({ message: "You have exceeded your quota" }, undefined)).toBe("quota_exceeded")
  })

  test("returns undefined for transient errors (500, 503)", () => {
    expect(resolveErrorType({ message: "Internal Server Error" }, 500)).toBeUndefined()
    expect(resolveErrorType({ message: "Service Unavailable" }, 503)).toBeUndefined()
  })
})
