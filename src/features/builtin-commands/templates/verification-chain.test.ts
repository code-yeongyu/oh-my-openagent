/**
 * Verification Chain Tests
 *
 * Tests for cross-agent verification chain where Oracle writes independent integration tests
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  VerificationChain,
  createVerificationChain,
  type VerificationRequest,
  type VerificationResult,
} from "./verification-chain"

describe("VerificationChain", () => {
  let chain: VerificationChain

  beforeEach(() => {
    chain = createVerificationChain()
  })

  describe("verification request", () => {
    //#given implementation completed
    //#when triggering verification chain
    //#then should generate verification request for Oracle
    it("should create verification request", () => {
      const request = chain.createRequest({
        feature: "User authentication",
        implementedFiles: ["src/auth/login.ts", "src/auth/session.ts"],
        requirements: ["Users can login with email/password", "Sessions expire after 24h"],
      })

      expect(request.targetAgent).toBe("oracle")
      expect(request.task).toContain("integration test")
    })

    it("should include implemented files in request", () => {
      const request = chain.createRequest({
        feature: "Payment processing",
        implementedFiles: ["src/payments/stripe.ts"],
        requirements: ["Process payments via Stripe"],
      })

      expect(request.context.files).toContain("src/payments/stripe.ts")
    })
  })

  describe("test generation guidance", () => {
    //#given Oracle generates tests
    //#when checking test structure
    //#then tests should be independent from implementation
    it("should require independent tests", () => {
      const request = chain.createRequest({
        feature: "API endpoint",
        implementedFiles: ["src/api/users.ts"],
        requirements: ["GET /users returns user list"],
      })

      expect(request.constraints.some((c: string) => c.includes("independent"))).toBe(true)
    })

    it("should specify test location separate from implementation", () => {
      const request = chain.createRequest({
        feature: "Data validation",
        implementedFiles: ["src/validators/email.ts"],
        requirements: ["Validate email format"],
      })

      expect(request.testLocation).not.toContain("src/validators/")
    })
  })

  describe("verification result handling", () => {
    it("should parse verification result", () => {
      const result = chain.parseResult({
        testsWritten: 3,
        testFiles: ["tests/integration/auth.test.ts"],
        allPassed: true,
      })

      expect(result.success).toBe(true)
      expect(result.testCount).toBe(3)
    })

    it("should report failures", () => {
      const result = chain.parseResult({
        testsWritten: 3,
        testFiles: ["tests/integration/auth.test.ts"],
        allPassed: false,
        failures: ["Login should return token - expected 200, got 401"],
      })

      expect(result.success).toBe(false)
      expect(result.failures).toHaveLength(1)
    })
  })

  describe("chain triggering", () => {
    //#given verification chain configured
    //#when triggering manually or automatically
    //#then should invoke correct agent sequence
    it("should support manual trigger", () => {
      const canTrigger = chain.canTrigger("manual")
      expect(canTrigger).toBe(true)
    })

    it("should support automatic trigger after implementation", () => {
      const canTrigger = chain.canTrigger("auto")
      expect(canTrigger).toBe(true)
    })
  })

  describe("feedback to main agent", () => {
    //#given Oracle completes verification
    //#when returning results
    //#then should format feedback for main agent
    it("should generate feedback report", () => {
      const feedback = chain.generateFeedback({
        testsWritten: 5,
        testFiles: ["tests/integration/feature.test.ts"],
        allPassed: true,
      })

      expect(feedback).toContain("5")
      expect(feedback).toContain("passed")
    })

    it("should include failure details in feedback", () => {
      const feedback = chain.generateFeedback({
        testsWritten: 5,
        testFiles: ["tests/integration/feature.test.ts"],
        allPassed: false,
        failures: ["Test case 1 failed", "Test case 2 failed"],
      })

      expect(feedback).toContain("failed")
      expect(feedback).toContain("Test case 1")
    })
  })
})
