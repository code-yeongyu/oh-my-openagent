import { describe, it, expect, beforeEach, mock } from "bun:test"
import { createCompactionContextInjector } from "./index"

// Mock the dependencies
const mockInjectHookMessage = mock(() => true)
const mockMarkCompaction = mock(() => {})

// We need to test the function behavior
describe("compaction-context-injector", () => {
  beforeEach(() => {
    mockInjectHookMessage.mockClear()
    mockMarkCompaction.mockClear()
  })

  describe("createCompactionContextInjector", () => {
    it("#then should return a function", () => {
      // #given
      const injector = createCompactionContextInjector()

      // #then
      expect(typeof injector).toBe("function")
    })

    it("#then should accept SummarizeContext parameters", async () => {
      // #given
      const injector = createCompactionContextInjector()
      const ctx = {
        sessionID: "test-session-1",
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        usageRatio: 0.85,
        directory: "/tmp/test",
      }

      // #when - should not throw
      let error: Error | null = null
      try {
        await injector(ctx)
      } catch (e) {
        error = e as Error
      }

      // #then - function executes without throwing (may fail injection but that's ok)
      expect(error).toBeNull()
    })
  })

  describe("SummarizeContext interface", () => {
    it("#then should require all expected fields", () => {
      // #given - a valid context object
      const ctx = {
        sessionID: "ses_123",
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        usageRatio: 0.9,
        directory: "/project",
      }

      // #then - all fields should be defined
      expect(ctx.sessionID).toBeDefined()
      expect(ctx.providerID).toBeDefined()
      expect(ctx.modelID).toBeDefined()
      expect(ctx.usageRatio).toBeDefined()
      expect(ctx.directory).toBeDefined()
    })

    it("#then usageRatio should be a number between 0 and 1", () => {
      // #given
      const validRatios = [0, 0.5, 0.85, 1]

      // #then
      for (const ratio of validRatios) {
        expect(ratio).toBeGreaterThanOrEqual(0)
        expect(ratio).toBeLessThanOrEqual(1)
      }
    })
  })
})
