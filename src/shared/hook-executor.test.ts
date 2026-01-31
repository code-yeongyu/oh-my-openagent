/**
 * Hook Executor with Graceful Degradation Tests
 *
 * Tests for graceful degradation when hooks fail
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  HookExecutor,
  createHookExecutor,
  HookStatus,
  type HookResult,
  type HookDefinition,
} from "./hook-executor"

describe("HookExecutor", () => {
  let executor: HookExecutor

  beforeEach(() => {
    executor = createHookExecutor()
  })

  describe("successful execution", () => {
    //#given hook executes successfully
    //#when running hook
    //#then should return success status
    it("should return success for passing hooks", async () => {
      const hook: HookDefinition = {
        name: "test-hook",
        execute: async () => ({ success: true }),
      }

      const result = await executor.execute(hook)

      expect(result.status).toBe(HookStatus.SUCCESS)
      expect(result.error).toBeUndefined()
    })
  })

  describe("graceful degradation", () => {
    //#given hook throws error
    //#when running hook
    //#then should mark as unstable instead of throwing
    it("should mark hook as unstable on failure", async () => {
      const hook: HookDefinition = {
        name: "failing-hook",
        execute: async () => {
          throw new Error("Hook failed")
        },
      }

      const result = await executor.execute(hook)

      expect(result.status).toBe(HookStatus.UNSTABLE)
      expect(result.error).toBe("Hook failed")
    })

    it("should not block main flow on hook failure", async () => {
      const hook: HookDefinition = {
        name: "failing-hook",
        execute: async () => {
          throw new Error("Critical error")
        },
      }

      // Should not throw - graceful degradation
      const result = await executor.execute(hook)
      expect(result.blocked).toBe(false)
    })

    it("should log warning for unstable hooks", async () => {
      const logs: string[] = []
      executor.setLogger((msg) => logs.push(msg))

      const hook: HookDefinition = {
        name: "failing-hook",
        execute: async () => {
          throw new Error("Hook error")
        },
      }

      await executor.execute(hook)

      expect(logs.some((l) => l.includes("warning"))).toBe(true)
      expect(logs.some((l) => l.includes("failing-hook"))).toBe(true)
    })
  })

  describe("unstable hook tracking", () => {
    it("should track unstable hooks in session", async () => {
      const hook1: HookDefinition = {
        name: "hook-1",
        execute: async () => {
          throw new Error("Error 1")
        },
      }
      const hook2: HookDefinition = {
        name: "hook-2",
        execute: async () => {
          throw new Error("Error 2")
        },
      }

      await executor.execute(hook1)
      await executor.execute(hook2)

      const unstable = executor.getUnstableHooks()
      expect(unstable).toHaveLength(2)
      expect(unstable.map((h) => h.name)).toContain("hook-1")
      expect(unstable.map((h) => h.name)).toContain("hook-2")
    })

    it("should include failure reason in unstable list", async () => {
      const hook: HookDefinition = {
        name: "failing-hook",
        execute: async () => {
          throw new Error("Specific failure reason")
        },
      }

      await executor.execute(hook)

      const unstable = executor.getUnstableHooks()
      expect(unstable[0].reason).toBe("Specific failure reason")
    })
  })

  describe("final report", () => {
    //#given some hooks failed
    //#when generating final report
    //#then should show unstable hooks list
    it("should include unstable hooks in final report", async () => {
      const hook: HookDefinition = {
        name: "unstable-hook",
        execute: async () => {
          throw new Error("Failed")
        },
      }

      await executor.execute(hook)
      const report = executor.generateReport()

      expect(report).toContain("unstable-hook")
      expect(report).toContain("Unstable Hooks")
    })

    it("should show clean report when no failures", async () => {
      const hook: HookDefinition = {
        name: "good-hook",
        execute: async () => ({ success: true }),
      }

      await executor.execute(hook)
      const report = executor.generateReport()

      expect(report).toContain("All hooks executed successfully")
    })
  })

  describe("timeout handling", () => {
    it("should mark as unstable on timeout", async () => {
      const hook: HookDefinition = {
        name: "slow-hook",
        timeout: 10, // 10ms timeout
        execute: async () => {
          await new Promise((r) => setTimeout(r, 100))
          return { success: true }
        },
      }

      const result = await executor.execute(hook)

      expect(result.status).toBe(HookStatus.UNSTABLE)
      expect(result.error).toContain("timeout")
    })
  })

  describe("reset", () => {
    it("should clear unstable hooks on reset", async () => {
      const hook: HookDefinition = {
        name: "failing-hook",
        execute: async () => {
          throw new Error("Error")
        },
      }

      await executor.execute(hook)
      expect(executor.getUnstableHooks()).toHaveLength(1)

      executor.reset()
      expect(executor.getUnstableHooks()).toHaveLength(0)
    })
  })
})
