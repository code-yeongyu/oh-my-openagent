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
  let messagesCalls: Array<{ sessionID: string }>
  let mockSessionMessages: Array<{ info?: { role?: string }; parts?: Array<{ type: string; text?: string }> }>

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
          messages: async (opts: { path: { id: string } }) => {
            messagesCalls.push({ sessionID: opts.path.id })
            return { data: mockSessionMessages }
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
    } as unknown as Parameters<typeof createRalphLoopHook>[0]
  }

  beforeEach(() => {
    promptCalls = []
    toastCalls = []
    messagesCalls = []
    mockSessionMessages = []

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

    test("should handle ultrawork field", () => {
      // #given - a state object with ultrawork enabled
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 50,
        completion_promise: "DONE",
        started_at: "2025-12-30T01:00:00Z",
        prompt: "Build a REST API",
        session_id: "test-session-123",
        ultrawork: true,
      }

      // #when - write and read state
      writeState(TEST_DIR, state)
      const readResult = readState(TEST_DIR)

      // #then - ultrawork field should be preserved
      expect(readResult?.ultrawork).toBe(true)
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

    test("should accept ultrawork option in startLoop", () => {
      // #given - hook instance
      const hook = createRalphLoopHook(createMockPluginInput())

      // #when - start loop with ultrawork
      hook.startLoop("session-123", "Build something", { ultrawork: true })

      // #then - state should have ultrawork=true
      const state = hook.getState()
      expect(state?.ultrawork).toBe(true)
    })

    test("should handle missing ultrawork option in startLoop", () => {
      // #given - hook instance
      const hook = createRalphLoopHook(createMockPluginInput())

      // #when - start loop without ultrawork
      hook.startLoop("session-123", "Build something")

      // #then - state should have ultrawork=undefined
      const state = hook.getState()
      expect(state?.ultrawork).toBeUndefined()
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

    test("should clear orphaned state when original session no longer exists", async () => {
      // #given - state file exists from a previous session that no longer exists
      const state: RalphLoopState = {
        active: true,
        iteration: 3,
        max_iterations: 50,
        completion_promise: "DONE",
        started_at: "2025-12-30T01:00:00Z",
        prompt: "Build something",
        session_id: "orphaned-session-999", // This session no longer exists
      }
      writeState(TEST_DIR, state)

      // Mock sessionExists to return false for the orphaned session
      const hook = createRalphLoopHook(createMockPluginInput(), {
        checkSessionExists: async (sessionID: string) => {
          // Orphaned session doesn't exist, current session does
          return sessionID !== "orphaned-session-999"
        },
      })

      // #when - a new session goes idle (different from the orphaned session in state)
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "new-session-456" },
        },
      })

      // #then - orphaned state should be cleared
      expect(hook.getState()).toBeNull()
      // #then - no continuation injected (state was cleared, not resumed)
      expect(promptCalls.length).toBe(0)
    })

    test("should NOT clear state when original session still exists (different active session)", async () => {
      // #given - state file exists from a session that still exists
      const state: RalphLoopState = {
        active: true,
        iteration: 2,
        max_iterations: 50,
        completion_promise: "DONE",
        started_at: "2025-12-30T01:00:00Z",
        prompt: "Build something",
        session_id: "active-session-123", // This session still exists
      }
      writeState(TEST_DIR, state)

      // Mock sessionExists to return true for the active session
      const hook = createRalphLoopHook(createMockPluginInput(), {
        checkSessionExists: async (sessionID: string) => {
          // Original session still exists
          return sessionID === "active-session-123" || sessionID === "new-session-456"
        },
      })

      // #when - a different session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "new-session-456" },
        },
      })

      // #then - state should NOT be cleared (original session still active)
      expect(hook.getState()).not.toBeNull()
      expect(hook.getState()?.session_id).toBe("active-session-123")
      // #then - no continuation injected (it's a different session's loop)
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

      writeFileSync(transcriptPath, JSON.stringify({ type: "tool_result", tool_name: "write", tool_output: { output: "Task done <promise>COMPLETE</promise>" } }) + "\n")

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

    test("should detect completion promise via session messages API", async () => {
      // #given - active loop with assistant message containing completion promise
      mockSessionMessages = [
        { info: { role: "user" }, parts: [{ type: "text", text: "Build something" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "I have completed the task. <promise>API_DONE</promise>" }] },
      ]
      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => join(TEST_DIR, "nonexistent.jsonl"),
      })
      hook.startLoop("session-123", "Build something", { completionPromise: "API_DONE" })

      // #when - session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - loop completed via API detection, no continuation
      expect(promptCalls.length).toBe(0)
      expect(toastCalls.some((t) => t.title === "Ralph Loop Complete!")).toBe(true)
      expect(hook.getState()).toBeNull()

      // #then - messages API was called with correct session ID
      expect(messagesCalls.length).toBe(1)
      expect(messagesCalls[0].sessionID).toBe("session-123")
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

    test("should clear loop state on user abort (MessageAbortedError)", async () => {
      // #given - active loop
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Build something")
      expect(hook.getState()).not.toBeNull()

      // #when - user aborts (Ctrl+C)
      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID: "session-123",
            error: { name: "MessageAbortedError", message: "User aborted" },
          },
        },
      })

      // #then - loop state should be cleared immediately
      expect(hook.getState()).toBeNull()
    })

    test("should NOT set recovery mode on user abort", async () => {
      // #given - active loop
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Build something")

      // #when - user aborts (Ctrl+C)
      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID: "session-123",
            error: { name: "MessageAbortedError" },
          },
        },
      })

      // Start a new loop
      hook.startLoop("session-123", "New task")

      // #when - session goes idle immediately (should work, no recovery mode)
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-123" } },
      })

      // #then - continuation should be injected (not blocked by recovery)
      expect(promptCalls.length).toBe(1)
    })

    test("should only check LAST assistant message for completion", async () => {
      // #given - multiple assistant messages, only first has completion promise
      mockSessionMessages = [
        { info: { role: "user" }, parts: [{ type: "text", text: "Start task" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "I'll work on it. <promise>DONE</promise>" }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "Continue" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Working on more features..." }] },
      ]
      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => join(TEST_DIR, "nonexistent.jsonl"),
      })
      hook.startLoop("session-123", "Build something", { completionPromise: "DONE" })

      // #when - session goes idle
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-123" } },
      })

      // #then - loop should continue (last message has no completion promise)
      expect(promptCalls.length).toBe(1)
      expect(hook.getState()?.iteration).toBe(2)
    })

    test("should detect completion only in LAST assistant message", async () => {
      // #given - last assistant message has completion promise
      mockSessionMessages = [
        { info: { role: "user" }, parts: [{ type: "text", text: "Start task" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Starting work..." }] },
        { info: { role: "user" }, parts: [{ type: "text", text: "Continue" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Task complete! <promise>DONE</promise>" }] },
      ]
      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => join(TEST_DIR, "nonexistent.jsonl"),
      })
      hook.startLoop("session-123", "Build something", { completionPromise: "DONE" })

      // #when - session goes idle
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-123" } },
      })

      // #then - loop should complete (last message has completion promise)
      expect(promptCalls.length).toBe(0)
      expect(toastCalls.some((t) => t.title === "Ralph Loop Complete!")).toBe(true)
      expect(hook.getState()).toBeNull()
    })

    test("should allow starting new loop while previous loop is active (different session)", async () => {
      // #given - active loop in session A
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-A", "First task", { maxIterations: 10 })
      expect(hook.getState()?.session_id).toBe("session-A")
      expect(hook.getState()?.prompt).toBe("First task")

      // #when - start new loop in session B (without completing A)
      hook.startLoop("session-B", "Second task", { maxIterations: 20 })

      // #then - state should be overwritten with session B's loop
      expect(hook.getState()?.session_id).toBe("session-B")
      expect(hook.getState()?.prompt).toBe("Second task")
      expect(hook.getState()?.max_iterations).toBe(20)
      expect(hook.getState()?.iteration).toBe(1)

      // #when - session B goes idle
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-B" } },
      })

      // #then - continuation should be injected for session B
      expect(promptCalls.length).toBe(1)
      expect(promptCalls[0].sessionID).toBe("session-B")
      expect(promptCalls[0].text).toContain("Second task")
      expect(promptCalls[0].text).toContain("2/20")

      // #then - iteration incremented
      expect(hook.getState()?.iteration).toBe(2)
    })

    test("should allow starting new loop in same session (restart)", async () => {
      // #given - active loop in session A at iteration 5
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-A", "First task", { maxIterations: 10 })
      
      // Simulate some iterations
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-A" } },
      })
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-A" } },
      })
      expect(hook.getState()?.iteration).toBe(3)
      expect(promptCalls.length).toBe(2)

      // #when - start NEW loop in same session (restart)
      hook.startLoop("session-A", "Restarted task", { maxIterations: 50 })

      // #then - state should be reset to iteration 1 with new prompt
      expect(hook.getState()?.session_id).toBe("session-A")
      expect(hook.getState()?.prompt).toBe("Restarted task")
      expect(hook.getState()?.max_iterations).toBe(50)
      expect(hook.getState()?.iteration).toBe(1)

      // #when - session goes idle
      promptCalls = [] // Reset to check new continuation
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-A" } },
      })

      // #then - continuation should use new task
      expect(promptCalls.length).toBe(1)
      expect(promptCalls[0].text).toContain("Restarted task")
      expect(promptCalls[0].text).toContain("2/50")
    })

    test("should NOT detect completion from user message in transcript (issue #622)", async () => {
      // #given - transcript contains user message with template text that includes completion promise
      // This reproduces the bug where the RALPH_LOOP_TEMPLATE instructional text
      // containing `<promise>DONE</promise>` is recorded as a user message and
      // falsely triggers completion detection
      const transcriptPath = join(TEST_DIR, "transcript.jsonl")
      const templateText = `You are starting a Ralph Loop...
Output <promise>DONE</promise> when fully complete`
      const userEntry = JSON.stringify({
        type: "user",
        timestamp: new Date().toISOString(),
        content: templateText,
      })
      writeFileSync(transcriptPath, userEntry + "\n")

      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => transcriptPath,
      })
      hook.startLoop("session-123", "Build something", { completionPromise: "DONE" })

      // #when - session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - loop should CONTINUE (user message completion promise is instructional, not actual)
      expect(promptCalls.length).toBe(1)
      expect(hook.getState()?.iteration).toBe(2)
    })

    test("should NOT detect completion from continuation prompt in transcript (issue #622)", async () => {
      // #given - transcript contains continuation prompt (also a user message) with completion promise
      const transcriptPath = join(TEST_DIR, "transcript.jsonl")
      const continuationText = `RALPH LOOP 2/100
When FULLY complete, output: <promise>DONE</promise>
Original task: Build something`
      const userEntry = JSON.stringify({
        type: "user",
        timestamp: new Date().toISOString(),
        content: continuationText,
      })
      writeFileSync(transcriptPath, userEntry + "\n")

      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => transcriptPath,
      })
      hook.startLoop("session-123", "Build something", { completionPromise: "DONE" })

      // #when - session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - loop should CONTINUE (continuation prompt text is not actual completion)
      expect(promptCalls.length).toBe(1)
      expect(hook.getState()?.iteration).toBe(2)
    })

    test("should detect completion from tool_result entry in transcript", async () => {
      // #given - transcript contains a tool_result with completion promise
      const transcriptPath = join(TEST_DIR, "transcript.jsonl")
      const toolResultEntry = JSON.stringify({
        type: "tool_result",
        timestamp: new Date().toISOString(),
        tool_name: "write",
        tool_input: {},
        tool_output: { output: "Task complete! <promise>DONE</promise>" },
      })
      writeFileSync(transcriptPath, toolResultEntry + "\n")

      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => transcriptPath,
      })
      hook.startLoop("session-123", "Build something", { completionPromise: "DONE" })

      // #when - session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - loop should complete (tool_result contains actual completion output)
      expect(promptCalls.length).toBe(0)
      expect(toastCalls.some((t) => t.title === "Ralph Loop Complete!")).toBe(true)
      expect(hook.getState()).toBeNull()
    })

    test("should check transcript BEFORE API to optimize performance", async () => {
      // #given - transcript has completion promise
      const transcriptPath = join(TEST_DIR, "transcript.jsonl")
      writeFileSync(transcriptPath, JSON.stringify({ type: "tool_result", tool_name: "write", tool_output: { output: "<promise>DONE</promise>" } }) + "\n")
      mockSessionMessages = [
        { info: { role: "assistant" }, parts: [{ type: "text", text: "No promise here" }] },
      ]
      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => transcriptPath,
      })
      hook.startLoop("session-123", "Build something", { completionPromise: "DONE" })

      // #when - session goes idle
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-123" },
        },
      })

      // #then - should complete via transcript (API not called when transcript succeeds)
      expect(promptCalls.length).toBe(0)
      expect(hook.getState()).toBeNull()
      // API should NOT be called since transcript found completion
      expect(messagesCalls.length).toBe(0)
    })

    test("should show ultrawork completion toast", async () => {
      // #given - hook with ultrawork mode and completion in transcript
      const transcriptPath = join(TEST_DIR, "transcript.jsonl")
      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => transcriptPath,
      })
      writeFileSync(transcriptPath, JSON.stringify({ type: "tool_result", tool_name: "write", tool_output: { output: "<promise>DONE</promise>" } }) + "\n")
      hook.startLoop("test-id", "Build API", { ultrawork: true })

      // #when - idle event triggered
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "test-id" } } })

      // #then - ultrawork toast shown
      const completionToast = toastCalls.find(t => t.title === "ULTRAWORK LOOP COMPLETE!")
      expect(completionToast).toBeDefined()
      expect(completionToast!.message).toMatch(/JUST ULW ULW!/)
    })

    test("should show regular completion toast when ultrawork disabled", async () => {
      // #given - hook without ultrawork
      const transcriptPath = join(TEST_DIR, "transcript.jsonl")
      const hook = createRalphLoopHook(createMockPluginInput(), {
        getTranscriptPath: () => transcriptPath,
      })
      writeFileSync(transcriptPath, JSON.stringify({ type: "tool_result", tool_name: "write", tool_output: { output: "<promise>DONE</promise>" } }) + "\n")
      hook.startLoop("test-id", "Build API")

      // #when - idle event triggered
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "test-id" } } })

      // #then - regular toast shown
      expect(toastCalls.some(t => t.title === "Ralph Loop Complete!")).toBe(true)
    })

    test("should prepend ultrawork to continuation prompt when ultrawork=true", async () => {
      // #given - hook with ultrawork mode enabled
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Build API", { ultrawork: true })

      // #when - session goes idle (continuation triggered)
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-123" } },
      })

      // #then - prompt should start with "ultrawork "
      expect(promptCalls.length).toBe(1)
      expect(promptCalls[0].text).toMatch(/^ultrawork /)
    })

    test("should NOT prepend ultrawork to continuation prompt when ultrawork=false", async () => {
      // #given - hook without ultrawork mode
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Build API")

      // #when - session goes idle (continuation triggered)
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-123" } },
      })

      // #then - prompt should NOT start with "ultrawork "
      expect(promptCalls.length).toBe(1)
      expect(promptCalls[0].text).not.toMatch(/^ultrawork /)
    })
  })

  describe("API timeout protection", () => {
    test("should not hang when session.messages() throws", async () => {
      // #given - API that throws (simulates timeout error)
      let apiCallCount = 0
      const errorMock = {
        ...createMockPluginInput(),
        client: {
          ...createMockPluginInput().client,
          session: {
            ...createMockPluginInput().client.session,
            messages: async () => {
              apiCallCount++
              throw new Error("API timeout")
            },
          },
        },
      }
      const hook = createRalphLoopHook(errorMock as any, {
        getTranscriptPath: () => join(TEST_DIR, "nonexistent.jsonl"),
        apiTimeout: 100,
      })
      hook.startLoop("session-123", "Build something")

      // #when - session goes idle (API will throw)
      const startTime = Date.now()
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "session-123" } },
      })
      const elapsed = Date.now() - startTime

      // #then - should complete quickly (not hang for 10s)
      expect(elapsed).toBeLessThan(2000)
      // #then - loop should continue (API error = no completion detected)
      expect(promptCalls.length).toBe(1)
      expect(apiCallCount).toBeGreaterThan(0)
    })
  })
})
