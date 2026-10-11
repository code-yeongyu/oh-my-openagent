import { describe, expect, test } from "bun:test"
import {
  applyGitHubCopilotRateLimit,
  createGitHubCopilotRateLimitState,
  filterGitHubCopilotModelsInCooldown,
  parseGitHubCopilotRetryAfterMs,
} from "./copilot-rate-limit"

describe("GitHub Copilot HTTP 429 policy", () => {
  test("#given a Retry-After delta header #when a Copilot 429 is recorded #then the retry delay does not precede the server window", () => {
    // given
    const state = createGitHubCopilotRateLimitState()

    // when
    const decision = applyGitHubCopilotRateLimit(state, {
      error: {
        statusCode: 429,
        response: { headers: { "Retry-After": "12" } },
      },
      model: "github-copilot/gpt-5.6",
      now: 0,
      random: () => 0.5,
    })

    // then
    expect(decision).toEqual({ kind: "backoff", delayMs: 12_125, retryCount: 1 })
    expect(state.retryNotBefore).toBe(12_125)
  })

  test("#given an HTTP-date Retry-After header #when it is parsed #then it returns the remaining delay", () => {
    // given
    const now = Date.parse("2026-08-26T12:00:00.000Z")
    const retryAt = new Date(now + 17_000).toUTCString()

    // when
    const retryAfterMs = parseGitHubCopilotRetryAfterMs(
      { data: { headers: { "retry-after": retryAt } } },
      now,
    )

    // then
    expect(retryAfterMs).toBe(17_000)
  })

  test("#given repeated Copilot 429 responses #when the retry budget is exhausted #then the provider enters cooldown and is removed from fallback candidates", () => {
    // given
    const state = createGitHubCopilotRateLimitState()
    const input = {
      error: { statusCode: 429, providerID: "github-copilot" },
      model: "github-copilot/gpt-5.6",
      random: () => 0,
    }

    // when
    for (let retryCount = 0; retryCount < 4; retryCount += 1) {
      const decision = applyGitHubCopilotRateLimit(state, { ...input, now: retryCount * 1_000 })
      expect(decision.kind).toBe("backoff")
    }
    const cooldown = applyGitHubCopilotRateLimit(state, { ...input, now: 4_000 })
    const fallbackModels = filterGitHubCopilotModelsInCooldown(
      ["github-copilot/gpt-5.6", "openai/gpt-5.6"],
      state,
      4_000,
    )

    // then
    expect(cooldown.kind).toBe("cooldown")
    expect(fallbackModels).toEqual(["openai/gpt-5.6"])
  })
})
