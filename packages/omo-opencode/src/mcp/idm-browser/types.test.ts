import { describe, test, expect } from "bun:test"
import {
  ChallengeKindSchema,
  EngineNameSchema,
  BotBlockedError,
  RawInteractionForbiddenError,
  CircuitOpenError,
} from "./types"

describe("idm-browser types", () => {
  describe("ChallengeKindSchema", () => {
    test("#given valid kind #when parsed #then succeeds", () => {
      expect(ChallengeKindSchema.parse("cloudflare_turnstile")).toBe("cloudflare_turnstile")
    })
    test("#given invalid kind #when parsed #then throws", () => {
      expect(() => ChallengeKindSchema.parse("nope")).toThrow()
    })
  })

  describe("EngineNameSchema", () => {
    test("#given valid engine #when parsed #then succeeds", () => {
      expect(EngineNameSchema.parse("camoufox")).toBe("camoufox")
    })
    test("#given invalid engine #when parsed #then throws", () => {
      expect(() => EngineNameSchema.parse("selenium")).toThrow()
    })
  })

  describe("BotBlockedError", () => {
    test("#given kind+profile #when constructed #then carries fields", () => {
      const err = new BotBlockedError("cloudflare_403", "/tmp/p", { headers: { server: "cf" } })
      expect(err.kind).toBe("cloudflare_403")
      expect(err.profileDir).toBe("/tmp/p")
      expect(err.evidence.headers?.server).toBe("cf")
      expect(err.name).toBe("BotBlockedError")
      expect(err.message).toBe("Bot block detected: cloudflare_403")
    })
  })

  describe("RawInteractionForbiddenError", () => {
    test("#given method name #when constructed #then message references method", () => {
      const err = new RawInteractionForbiddenError("click")
      expect(err.name).toBe("RawInteractionForbiddenError")
      expect(err.message).toContain("page.click()")
    })
  })

  describe("CircuitOpenError", () => {
    test("#given host and retryAfterMs #when constructed #then carries fields", () => {
      const err = new CircuitOpenError("example.com", 5000)
      expect(err.host).toBe("example.com")
      expect(err.retryAfterMs).toBe(5000)
      expect(err.name).toBe("CircuitOpenError")
    })
  })
})
