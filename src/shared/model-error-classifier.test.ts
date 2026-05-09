declare const require: (name: string) => any
const { describe, expect, test, beforeEach, afterEach, mock, spyOn } = require("bun:test")
import * as connectedProvidersCache from "./connected-providers-cache"

let readConnectedProvidersCacheSpy: ReturnType<typeof spyOn> | undefined
const { shouldRetryError, selectFallbackProvider, isProviderScopedStop, hasCrossProviderFallback } = await import("./model-error-classifier")

describe("model-error-classifier", () => {
  beforeEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
  })

  afterEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = undefined
  })

  test("treats overloaded retry messages as retryable", () => {
    //#given
    const error = { message: "Provider is overloaded" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats cooling-down auto-retry messages as retryable", () => {
    //#given
    const error = {
      message:
        "All credentials for model claude-opus-4-7-thinking are cooling down [retrying in ~5 days attempt #1]",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("selectFallbackProvider prefers first connected provider in preference order", () => {
    //#given
    readConnectedProvidersCacheSpy?.mockReturnValue(["anthropic", "nvidia"])

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

    //#then
    expect(provider).toBe("anthropic")
  })

  test("selectFallbackProvider falls back to next connected provider when first is disconnected", () => {
    //#given
    readConnectedProvidersCacheSpy?.mockReturnValue(["nvidia"])

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"])

    //#then
    expect(provider).toBe("nvidia")
  })

  test("selectFallbackProvider uses provider preference order when cache is missing", () => {
    //#given - no cache file

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

    //#then
    expect(provider).toBe("anthropic")
  })

  test("selectFallbackProvider uses connected preferred provider when fallback providers are unavailable", () => {
    //#given
    readConnectedProvidersCacheSpy?.mockReturnValue(["provider-x"])

    //#when
    const provider = selectFallbackProvider(["provider-y"], "provider-x")

    //#then
    expect(provider).toBe("provider-x")
  })

  test("treats QuotaExceededError (PascalCase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "QuotaExceededError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats quotaexceedederror (lowercase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "quotaexceedederror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats InsufficientCreditsError (PascalCase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "InsufficientCreditsError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats insufficientcreditserror (lowercase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "insufficientcreditserror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats FreeUsageLimitError (PascalCase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "FreeUsageLimitError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats freeusagelimiterror (lowercase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "freeusagelimiterror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats quota reset message as non-retryable STOP error (no error name)", () => {
    //#given
    const error = { message: "quota will reset after 1 hour" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats quota exceeded message as non-retryable STOP error (no error name)", () => {
    //#given
    const error = { message: "quota exceeded for this billing period" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats usage limit reached message as non-retryable STOP error (no error name)", () => {
    //#given
    const error = { message: "usage limit has been reached for your account" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats insufficient credits message as non-retryable STOP error (no error name)", () => {
    //#given
    const error = { message: "insufficient credits to complete this request" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats 'bad request' message as retryable (GitHub Copilot rolling update)", () => {
    //#given
    const error = { message: "400 Bad Request" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats 'bad request' lowercase as retryable", () => {
    //#given
    const error = { message: "bad request: model temporarily unavailable" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats subscription quota message as non-retryable", () => {
    //#given
    const error = { message: "Subscription quota exceeded. You can continue using free models." }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats HTTP 429 rate limit message as retryable", () => {
    //#given
    const error = { message: "429 Too Many Requests: rate limit reached" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats forbidden provider message as retryable", () => {
    //#given
    const error = { message: "Forbidden: Selected provider is forbidden" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("does not treat unrelated forbidden messages as retryable", () => {
    //#given
    const error = { message: "EACCES: forbidden write to /etc/hosts" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("does not treat unrelated 403 messages as retryable", () => {
    //#given
    const error = { message: "Tool returned HTTP 403 for the requested URL" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  describe("isProviderScopedStop", () => {
    test("flags 'insufficient balance' as provider-scoped stop", () => {
      const error = { message: "402 Payment Required: insufficient balance for model" }
      expect(isProviderScopedStop(error)).toBe(true)
    })

    test("flags 'credits exhausted' as provider-scoped stop", () => {
      expect(isProviderScopedStop({ message: "Your credits exhausted, please refill" })).toBe(true)
    })

    test("flags 'quota exceeded' as provider-scoped stop", () => {
      expect(isProviderScopedStop({ message: "Subscription quota exceeded for this month" })).toBe(true)
    })

    test("flags InsufficientCreditsError name as provider-scoped stop", () => {
      expect(isProviderScopedStop({ name: "InsufficientCreditsError" })).toBe(true)
    })

    test("does not flag generic rate-limit messages (those go via baseRetry)", () => {
      expect(isProviderScopedStop({ message: "rate_limit hit, retry later" })).toBe(false)
    })

    test("does not flag user-fault errors as provider-scoped stop", () => {
      expect(isProviderScopedStop({ name: "PermissionDeniedError" })).toBe(false)
      expect(isProviderScopedStop({ name: "ValidationError" })).toBe(false)
    })

    test("returns false on empty error info", () => {
      expect(isProviderScopedStop({})).toBe(false)
    })
  })

  describe("hasCrossProviderFallback", () => {
    test("returns true when chain has a different-provider entry ahead", () => {
      const chain = [
        { model: "claude-haiku-4.5", providers: ["github-copilot"] },
        { model: "glm-5.1", providers: ["opencode-go"] },
      ]
      expect(hasCrossProviderFallback(chain, 1, "github-copilot")).toBe(true)
    })

    test("returns false when remaining chain is all same-provider", () => {
      const chain = [
        { model: "claude-haiku-4.5", providers: ["github-copilot"] },
        { model: "claude-sonnet-4.6", providers: ["github-copilot"] },
      ]
      expect(hasCrossProviderFallback(chain, 1, "github-copilot")).toBe(false)
    })

    test("returns false when failing provider is unknown", () => {
      const chain = [{ model: "x", providers: ["other"] }]
      expect(hasCrossProviderFallback(chain, 0, undefined)).toBe(false)
    })

    test("treats provider names case-insensitively", () => {
      const chain = [{ model: "x", providers: ["OpenCode-Go"] }]
      expect(hasCrossProviderFallback(chain, 0, "github-copilot")).toBe(true)
      expect(hasCrossProviderFallback(chain, 0, "opencode-go")).toBe(false)
    })

    test("entry with mixed providers counts as cross-provider if any differs", () => {
      const chain = [{ model: "x", providers: ["github-copilot", "opencode-go"] }]
      expect(hasCrossProviderFallback(chain, 0, "github-copilot")).toBe(true)
    })

    test("respects attemptCount and ignores already-tried entries", () => {
      const chain = [
        { model: "y", providers: ["opencode-go"] },
        { model: "x", providers: ["github-copilot"] },
      ]
      expect(hasCrossProviderFallback(chain, 1, "github-copilot")).toBe(false)
    })
  })

  describe("SDK transport error retryability", () => {
    test("'JSON Parse error: Unterminated string' is retryable even when error name is SyntaxError", () => {
      const error = { name: "SyntaxError", message: "JSON Parse error: Unterminated string" }
      expect(shouldRetryError(error)).toBe(true)
    })

    test("'unexpected end of stream' is retryable", () => {
      expect(shouldRetryError({ name: "SyntaxError", message: "Unexpected end of stream" })).toBe(true)
    })

    test("'unexpected end of json' is retryable", () => {
      expect(shouldRetryError({ message: "Unexpected end of JSON input" })).toBe(true)
    })

    test("'stream closed' is retryable", () => {
      expect(shouldRetryError({ message: "stream closed unexpectedly" })).toBe(true)
    })

    test("'socket hang up' is retryable", () => {
      expect(shouldRetryError({ name: "Error", message: "socket hang up" })).toBe(true)
    })

    test("'ECONNRESET' is retryable", () => {
      expect(shouldRetryError({ message: "fetch failed: ECONNRESET" })).toBe(true)
    })

    test("real SyntaxError without transport pattern stays non-retryable", () => {
      const error = { name: "SyntaxError", message: "Unexpected token < in user code" }
      expect(shouldRetryError(error)).toBe(false)
    })
  })
})

export {}
