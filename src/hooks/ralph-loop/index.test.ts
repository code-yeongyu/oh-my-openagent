import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRalphLoopHook } from "./index"
import { readState, writeState, clearState } from "./storage"
import type { RalphLoopState } from "./types"

describe("ralph-loop", () => {
  const TEST_DIR = join(tmpdir(), "ralph-loop-test-" + Date.now())
  let promptCalls: Array<{ sessionID: string; text: string }>
  let toastCalls: Array<{ title: string; message: string; variant: string }>

  function createMockPluginInput() {
    return {
      client: {
        session: {
          prompt: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
            promptCalls.push({
              sessionID: opts.path.id,
              text: opts.body.parts[0].text,
            })
            return {}
          },
        },
        tui: {
          showToast: async (opts: { body: { title: string; message: string; variant: string } }) => {
            toastCalls.push({
              title: opts.body.title,
              message: opts.body.message,
              variant: opts.body.variant,
            })
            return {}
          },
        },
      },
      directory: TEST_DIR,
    } as Parameters<typeof createRalphLoopHook>[0]
  }

  beforeEach(() => {
    promptCalls = []
    toastCalls = []

    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }

    clearState(TEST_DIR)
  })

  afterEach(() => {
    clearState(TEST_DIR)
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("storage", () => {
    test("should write and read state correctly", () => {
      // #given - a state object
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 50,
        completion_promise: "DONE",
        started_at: "2025-12-30T01:00:00Z",
        prompt: "Build a REST API",
        session_id: "test-session-123",
      }

      // #when - write and read state
      const writeSuccess = writeState(TEST_DIR, state)
      const readResult = readState(TEST_DIR)

      // #then - state should match
      expect(writeSuccess).toBe(true)
      expect(readResult).not.toBeNull()
      expect(readResult?.active).toBe(true)
      expect(readResult?.iteration).toBe(1)
      expect(readResult?.max_iterations).toBe(50)
      expect(readResult?.completion_promise).toBe("DONE")
      expect(readResult?.prompt).toBe("Build a REST API")
      expect(readResult?.session_id).toBe("test-session-123")
    })

    test("should return null for non-existent state", () => {
      // #given - no state file exists
      // #when - read state
      const result = readState(TEST_DIR)

      // #then - should return null
      expect(result).toBeNull()
    })

    test("should clear state correctly", () => {
      // #given - existing state
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 50,
        completion_promise: "DONE",
        started_at: "2025-12-30T01:00:00Z",
        prompt: "Test prompt",
      }
      writeState(TEST_DIR, state)

      // #when - clear state
      const clearSuccess = clearState(TEST_DIR)
      const readResult = readState(TEST_DIR)

      // #then - state should be cleared
      expect(clearSuccess).toBe(true)
      expect(readResult).toBeNull()
    })

    test("should handle multiline prompts", () => {
      // #given - state with multiline prompt
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "FINISHED",
        started_at: "2025-12-30T02:00:00Z",
        prompt: "Build a feature\nwith multiple lines\nand requirements",
      }

      // #when - write and read
      writeState(TEST_DIR, state)
      const readResult = readState(TEST_DIR)

      // #then - multiline prompt preserved
      expect(readResult?.prompt).toBe("Build a feature\nwith multiple lines\nand requirements")
    })
  })

  describe("hook", () => {
    test("should start loop and write state", () => {
      // #given - hook instance
      const hook = createRalphLoopHook(createMockPluginInput())

      // #when - start loop
      const success = hook.startLoop("session-123", "Build something", {
        maxIterations: 25,
        completionPromise: "FINISHED",
      })

      // #then - state should be written
      expect(success).toBe(true)
      const state = hook.getState()
      expect(state?.active).toBe(true)
      expect(state?.iteration).toBe(1)
      expect(state?.max_iterations).toBe(25)
      expect(state?.completion_promise).toBe("FINISHED")
      expect(state?.prompt).toBe("Build something")
      expect(state?.session_id).toBe("session-123")
    })

    test("should inject continuation when loop active and no completion detected", async () => {
      // #given - active loop state
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Build a feature", { maxIterations: 10 })

      // #when - session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - continuation should be injected
      expect(promptCalls.length).toBe(1)
      expect(promptCalls[0].sessionID).toBe("session-123")
      expect(promptCalls[0].text).toContain("RALPH LOOP")
      expect(promptCalls[0].text).toContain("Build a feature")
      expect(promptCalls[0].text).toContain("2/10")

      // #then - iteration should be incremented
      const state = hook.getState()
      expect(state?.iteration).toBe(2)
    })

    test("should stop loop when max iterations reached", async () => {
      // #given - loop at max iteration
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Build something", { maxIterations: 2 })

      const state = hook.getState()!
      state.iteration = 2
      writeState(TEST_DIR, state)

      // #when - session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - no continuation injected
      expect(promptCalls.length).toBe(0)

      // #then - warning toast shown
      expect(toastCalls.length).toBe(1)
      expect(toastCalls[0].title).toBe("Ralph Loop Stopped")
      expect(toastCalls[0].variant).toBe("warning")

      // #then - state should be cleared
      expect(hook.getState()).toBeNull()
    })

    test("should cancel loop via cancelLoop", () => {
      // #given - active loop
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Test task")

      // #when - cancel loop
      const success = hook.cancelLoop("session-123")

      // #then - loop cancelled
      expect(success).toBe(true)
      expect(hook.getState()).toBeNull()
    })

    test("should not cancel loop for different session", () => {
      // #given - active loop for session-123
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Test task")

      // #when - try to cancel for different session
      const success = hook.cancelLoop("session-456")

      // #then - cancel should fail
      expect(success).toBe(false)
      expect(hook.getState()).not.toBeNull()
    })

    test("should skip injection during recovery", async () => {
      // #given - active loop and session in recovery
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Test task")

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-123", error: new Error("test") },
        },
      })

      // #when - session goes idle immediately
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - no continuation injected
      expect(promptCalls.length).toBe(0)
    })

    test("should clear state on session deletion", async () => {
      // #given - active loop
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Test task")

      // #when - session deleted
      await hook.event({
        event: {
          type: "session.deleted",
          properties: { info: { id: "session-123" } },
        },
      })

      // #then - state should be cleared
      expect(hook.getState()).toBeNull()
    })

    test("should not inject for different session than loop owner", async () => {
      // #given - loop owned by session-123
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Test task")

      // #when - different session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-456" },
        },
      })

      // #then - no continuation injected
      expect(promptCalls.length).toBe(0)
    })

    test("should use default config values", () => {
      // #given - hook with config
      const hook = createRalphLoopHook(createMockPluginInput(), {
        config: {
          enabled: true,
          default_max_iterations: 200,
        },
      })

      // #when - start loop without options
      hook.startLoop("session-123", "Test task")

      // #then - should use config defaults
      const state = hook.getState()
      expect(state?.max_iterations).toBe(200)
    })

    test("should not inject when no loop is active", async () => {
      // #given - no active loop
      const hook = createRalphLoopHook(createMockPluginInput())

      // #when - session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - no continuation injected
      expect(promptCalls.length).toBe(0)
    })

    test("should detect completion promise and stop loop", async () => {
      // #given - active loop with transcript containing completion
      const transcriptPath = join(TEST_DIR, "transcript.jsonl")
      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => transcriptPath,
      })
      hook.startLoop("session-123", "Build something", { completionPromise: "COMPLETE" })

      writeFileSync(transcriptPath, JSON.stringify({ content: "Task done <promise>COMPLETE</promise>" }))

      // #when - session goes idle (transcriptPath now derived from sessionID via getTranscriptPath)
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - loop completed, no continuation
      expect(promptCalls.length).toBe(0)
      expect(toastCalls.some((t) => t.title === "Ralph Loop Complete!")).toBe(true)
      expect(hook.getState()).toBeNull()
    })

    test("should handle multiple iterations correctly", async () => {
      // #given - active loop
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Build feature", { maxIterations: 5 })

      // #when - multiple idle events
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-123" } },
      })
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-123" } },
      })

      // #then - iteration incremented correctly
      expect(hook.getState()?.iteration).toBe(3)
      expect(promptCalls.length).toBe(2)
    })

    test("should include prompt and promise in continuation message", async () => {
      // #given - loop with specific prompt and promise
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Create a calculator app", {
        completionPromise: "CALCULATOR_DONE",
        maxIterations: 10,
      })

      // #when - session goes idle
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-123" } },
      })

      // #then - continuation includes original task and promise
      expect(promptCalls[0].text).toContain("Create a calculator app")
      expect(promptCalls[0].text).toContain("<promise>CALCULATOR_DONE</promise>")
    })
  })
})
