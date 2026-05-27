import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createPromptTimeoutContext, PROMPT_TIMEOUT_MS } from "./prompt-timeout-context"

describe("createPromptTimeoutContext", () => {
  describe("#given no upstream signal", () => {
    describe("#when created with a timeout", () => {
      test("#then returns a non-aborted signal", () => {
        const ctx = createPromptTimeoutContext({}, 5000)
        expect(ctx.signal.aborted).toBe(false)
        expect(ctx.wasTimedOut()).toBe(false)
        ctx.cleanup()
      })

      test("#then cleanup prevents timeout from firing", () => {
        const ctx = createPromptTimeoutContext({}, 50)
        ctx.cleanup()
        // After cleanup, timeout should not fire
        expect(ctx.signal.aborted).toBe(false)
        expect(ctx.wasTimedOut()).toBe(false)
      })
    })
  })

  describe("#given an already-aborted upstream signal", () => {
    describe("#when created", () => {
      test("#then the returned signal is immediately aborted", () => {
        const upstream = AbortSignal.abort("upstream reason")
        const ctx = createPromptTimeoutContext({ signal: upstream }, 5000)
        expect(ctx.signal.aborted).toBe(true)
        expect(ctx.signal.reason).toBe("upstream reason")
        expect(ctx.wasTimedOut()).toBe(false)
        ctx.cleanup()
      })
    })
  })

  describe("#given a live upstream signal", () => {
    describe("#when upstream aborts", () => {
      test("#then the returned signal also aborts with upstream reason", () => {
        const controller = new AbortController()
        const ctx = createPromptTimeoutContext({ signal: controller.signal }, 60000)

        expect(ctx.signal.aborted).toBe(false)
        controller.abort("cancelled by user")

        expect(ctx.signal.aborted).toBe(true)
        expect(ctx.signal.reason).toBe("cancelled by user")
        expect(ctx.wasTimedOut()).toBe(false)
        ctx.cleanup()
      })
    })

    describe("#when cleanup is called before upstream aborts", () => {
      test("#then upstream abort no longer propagates", () => {
        const controller = new AbortController()
        const ctx = createPromptTimeoutContext({ signal: controller.signal }, 60000)

        ctx.cleanup()
        controller.abort("late abort")

        // Signal should NOT be aborted because we cleaned up the listener
        expect(ctx.signal.aborted).toBe(false)
      })
    })
  })

  describe("#given PROMPT_TIMEOUT_MS constant", () => {
    test("#then it equals 120000ms", () => {
      expect(PROMPT_TIMEOUT_MS).toBe(120000)
    })
  })

  describe("#given wasTimedOut tracking", () => {
    describe("#when timeout fires", () => {
      test("#then wasTimedOut returns true and signal is aborted with timeout message", async () => {
        const ctx = createPromptTimeoutContext({}, 1)
        // Wait for the 1ms timeout to fire
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => resolve(), { once: true })
        })
        expect(ctx.wasTimedOut()).toBe(true)
        expect(ctx.signal.aborted).toBe(true)
        expect(ctx.signal.reason).toBeInstanceOf(Error)
        expect((ctx.signal.reason as Error).message).toBe("prompt timed out after 1ms")
        ctx.cleanup()
      })
    })
  })
})
