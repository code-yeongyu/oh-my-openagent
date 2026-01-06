import { describe, it, expect } from "bun:test"
import { isTokenExpired } from "./token"
import type { AntigravityTokens } from "./types"

describe("Token Expiry with 50-minute Buffer", () => {
  const createToken = (expiresInSeconds: number): AntigravityTokens => ({
    type: "antigravity",
    access_token: "test-access",
    refresh_token: "test-refresh",
    expires_in: expiresInSeconds,
    timestamp: Date.now(),
  })

  it("should NOT be expired if token expires in 51 minutes", () => {
    // #given
    const fiftyOneMinutes = 51 * 60 // 3060 seconds
    const token = createToken(fiftyOneMinutes)

    // #when
    const expired = isTokenExpired(token)

    // #then
    expect(expired).toBe(false)
  })

  it("should be expired if token expires in 49 minutes", () => {
    // #given
    const fortyNineMinutes = 49 * 60 // 2940 seconds
    const token = createToken(fortyNineMinutes)

    // #when
    const expired = isTokenExpired(token)

    // #then
    expect(expired).toBe(true)
  })

  it("should be expired at exactly 50 minutes (boundary)", () => {
    // #given
    const fiftyMinutes = 50 * 60 // 3000 seconds
    const token = createToken(fiftyMinutes)

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
      expires_in: 3600, // 1 hour originally
      timestamp: Date.now() - 4000 * 1000, // 4000 seconds ago
    }

    // #when
    const expired = isTokenExpired(alreadyExpired)

    // #then
    expect(expired).toBe(true)
  })

  it("should NOT be expired if token has plenty of time", () => {
    // #given
    const twoHours = 2 * 60 * 60 // 7200 seconds
    const token = createToken(twoHours)

    // #when
    const expired = isTokenExpired(token)

    // #then
    expect(expired).toBe(false)
  })
})
