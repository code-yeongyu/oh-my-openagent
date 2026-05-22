import { describe, it, expect } from "bun:test"
import { createModelFallbackStateController } from "./state-controller"
import type { FallbackEntry } from "@oh-my-opencode/model-core"
import type { ModelFallbackState } from "./types"

function createTestController(options?: {
  reachabilityChecker?: (entry: FallbackEntry) => boolean
}) {
  const pendingModelFallbacks = new Map<string, ModelFallbackState>()
  const lastToastKey = new Map<string, string>()
  const sessionFallbackChains = new Map<string, FallbackEntry[]>()
  const logs: string[] = []

  const controller = createModelFallbackStateController({
    pendingModelFallbacks,
    lastToastKey,
    sessionFallbackChains,
    reachabilityChecker: options?.reachabilityChecker,
    logger: (msg) => logs.push(msg),
  })

  return { controller, pendingModelFallbacks, lastToastKey, sessionFallbackChains, logs }
}

describe("createModelFallbackStateController", () => {
  describe("setPendingModelFallback", () => {
    it("returns false when no fallback chain exists for agent", () => {
      const { controller, logs } = createTestController()
      const result = controller.setPendingModelFallback("session-1", "unknown-agent", "openai", "gpt-4")
      expect(result).toBe(false)
      expect(logs.some((l) => l.includes("No fallback chain"))).toBe(true)
    })

    it("arms fallback for known agent (sisyphus)", () => {
      const { controller, pendingModelFallbacks } = createTestController()
      const result = controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      expect(result).toBe(true)
      const state = pendingModelFallbacks.get("session-1")
      expect(state?.pending).toBe(true)
      expect(state?.providerID).toBe("anthropic")
      expect(state?.attemptCount).toBe(0)
    })

    it("returns false when already armed", () => {
      const { controller } = createTestController()
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      const result = controller.setPendingModelFallback("session-1", "sisyphus", "openai", "gpt-4")
      expect(result).toBe(false)
    })

    it("uses custom fallback chain from session when set", () => {
      const { controller, pendingModelFallbacks } = createTestController()
      const customChain: FallbackEntry[] = [
        { providers: ["custom-provider"], model: "custom-model" },
      ]
      controller.setSessionFallbackChain("session-1", customChain)
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      const state = pendingModelFallbacks.get("session-1")
      expect(state?.fallbackChain).toEqual(customChain)
    })
  })

  describe("getNextFallback", () => {
    it("returns null when no fallback is pending", () => {
      const { controller } = createTestController()
      expect(controller.getNextFallback("session-1")).toBeNull()
    })

    it("returns next fallback and marks state as not pending", () => {
      const { controller, pendingModelFallbacks } = createTestController()
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      const result = controller.getNextFallback("session-1")
      expect(result).not.toBeNull()
      expect(result?.providerID).toBeDefined()
      expect(result?.modelID).toBeDefined()
      expect(pendingModelFallbacks.get("session-1")?.pending).toBe(false)
    })

    it("skips unreachable entries", () => {
      const { controller, logs } = createTestController({
        reachabilityChecker: (entry) => entry.providers[0] !== "unreachable",
      })
      controller.setSessionFallbackChain("session-1", [
        { providers: ["unreachable"], model: "model-a" },
        { providers: ["reachable"], model: "model-b" },
      ])
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      const result = controller.getNextFallback("session-1")
      expect(result).not.toBeNull()
      expect(result?.modelID).toBe("model-b")
      expect(logs.some((l) => l.includes("Skipping unreachable"))).toBe(true)
    })

    it("skips no-op fallback (same provider and model)", () => {
      const { controller } = createTestController()
      controller.setSessionFallbackChain("session-1", [
        { providers: ["anthropic"], model: "claude-sonnet-4-20250514" },
        { providers: ["openai"], model: "gpt-4" },
      ])
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      const result = controller.getNextFallback("session-1")
      expect(result?.providerID).toBe("openai")
      expect(result?.modelID).toBe("gpt-4")
    })

    it("returns null and deletes state when chain exhausted", () => {
      const { controller, pendingModelFallbacks, logs } = createTestController({
        reachabilityChecker: () => false,
      })
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      const result = controller.getNextFallback("session-1")
      expect(result).toBeNull()
      expect(pendingModelFallbacks.has("session-1")).toBe(false)
      expect(logs.some((l) => l.includes("No more fallbacks"))).toBe(true)
    })

    it("includes variant and model parameters in result", () => {
      const { controller } = createTestController()
      controller.setSessionFallbackChain("session-1", [
        { providers: ["openai"], model: "gpt-4", variant: "high", temperature: 0.5 },
      ])
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      const result = controller.getNextFallback("session-1")
      expect(result?.variant).toBe("high")
      expect(result?.temperature).toBe(0.5)
    })
  })

  describe("session fallback chain management", () => {
    it("set and get session fallback chain", () => {
      const { controller } = createTestController()
      const chain: FallbackEntry[] = [
        { providers: ["a"], model: "m1" },
        { providers: ["b"], model: "m2" },
      ]
      controller.setSessionFallbackChain("session-1", chain)
      expect(controller.getSessionFallbackChain("session-1")).toEqual(chain)
    })

    it("returns undefined for unset session", () => {
      const { controller } = createTestController()
      expect(controller.getSessionFallbackChain("session-1")).toBeUndefined()
    })

    it("clearSessionFallbackChain removes chain", () => {
      const { controller } = createTestController()
      controller.setSessionFallbackChain("session-1", [{ providers: ["a"], model: "m1" }])
      controller.clearSessionFallbackChain("session-1")
      expect(controller.getSessionFallbackChain("session-1")).toBeUndefined()
    })

    it("returns copy of chain, not reference", () => {
      const { controller } = createTestController()
      const chain: FallbackEntry[] = [{ providers: ["a"], model: "m1" }]
      controller.setSessionFallbackChain("session-1", chain)
      const retrieved = controller.getSessionFallbackChain("session-1")
      expect(retrieved).toEqual(chain)
      expect(retrieved).not.toBe(chain)
    })
  })

  describe("clearPendingModelFallback", () => {
    it("removes pending state and lastToastKey", () => {
      const { controller, pendingModelFallbacks, lastToastKey } = createTestController()
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      lastToastKey.set("session-1", "some-key")
      controller.clearPendingModelFallback("session-1")
      expect(pendingModelFallbacks.has("session-1")).toBe(false)
      expect(lastToastKey.has("session-1")).toBe(false)
    })
  })

  describe("hasPendingModelFallback", () => {
    it("returns false when no state", () => {
      const { controller } = createTestController()
      expect(controller.hasPendingModelFallback("session-1")).toBe(false)
    })

    it("returns true when armed", () => {
      const { controller } = createTestController()
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      expect(controller.hasPendingModelFallback("session-1")).toBe(true)
    })

    it("returns false after fallback applied", () => {
      const { controller } = createTestController()
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      controller.getNextFallback("session-1")
      expect(controller.hasPendingModelFallback("session-1")).toBe(false)
    })
  })

  describe("reset", () => {
    it("clears all state", () => {
      const { controller, pendingModelFallbacks, lastToastKey, sessionFallbackChains } = createTestController()
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      controller.setSessionFallbackChain("session-2", [{ providers: ["a"], model: "m1" }])
      lastToastKey.set("session-1", "key")
      controller.reset()
      expect(pendingModelFallbacks.size).toBe(0)
      expect(lastToastKey.size).toBe(0)
      expect(sessionFallbackChains.size).toBe(0)
    })
  })

  describe("multi-session isolation", () => {
    it("sessions are independent", () => {
      const { controller } = createTestController()
      controller.setPendingModelFallback("session-1", "sisyphus", "anthropic", "claude-sonnet-4-20250514")
      controller.setPendingModelFallback("session-2", "hephaestus", "openai", "gpt-4")
      expect(controller.hasPendingModelFallback("session-1")).toBe(true)
      expect(controller.hasPendingModelFallback("session-2")).toBe(true)
      controller.clearPendingModelFallback("session-1")
      expect(controller.hasPendingModelFallback("session-1")).toBe(false)
      expect(controller.hasPendingModelFallback("session-2")).toBe(true)
    })
  })
})
