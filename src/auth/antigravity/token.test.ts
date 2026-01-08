import { describe, it, expect } from "bun:test"
import { isTokenExpired } from "./token"
import type { AntigravityTokens } from "./types"

describe("Token Expiry with 60-second Buffer", () => {
  const createToken = (expiresInSeconds: number): AntigravityTokens => ({
    type: "antigravity",
    access_token: "test-access",
    refresh_token: "test-refresh",
    expires_in: expiresInSeconds,
    timestamp: Date.now(),
  })

  it("should NOT be expired if token expires in 2 minutes", () => {
    // #given
    const twoMinutes = 2 * 60
    const token = createToken(twoMinutes)

    // #when
    const expired = isTokenExpired(token)

    // #then
    expect(expired).toBe(false)
  })

  it("should be expired if token expires in 30 seconds", () => {
    // #given
    const thirtySeconds = 30
    const token = createToken(thirtySeconds)

    // #when
    const expired = isTokenExpired(token)

    // #then
    expect(expired).toBe(true)
  })

  it("should be expired at exactly 60 seconds (boundary)", () => {
    // #given
    const sixtySeconds = 60
    const token = createToken(sixtySeconds)

    // #when
    const expired = isTokenExpired(token)

    // #then - at boundary, should trigger refresh
    expect(expired).toBe(true)
  })

  it("should be expired if token already expired", () => {
    // #given
    const alreadyExpired: AntigravityTokens = {
      type: "antigravity",
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_in: 3600,
      timestamp: Date.now() - 4000 * 1000,
    }

    // #when
    const expired = isTokenExpired(alreadyExpired)

    // #then
    expect(expired).toBe(true)
  })

  it("should NOT be expired if token has plenty of time", () => {
    // #given
    const twoHours = 2 * 60 * 60
    const token = createToken(twoHours)

    // #when
    const expired = isTokenExpired(token)

    // #then
    expect(expired).toBe(false)
  })
})
