import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readState, writeState, clearState, incrementIteration } from "./storage"
import { createReviewLoopHook } from "./index"
import type { ReviewLoopState } from "./types"

describe("review-loop storage", () => {
  const TEST_DIR = join(tmpdir(), "review-loop-test-" + Date.now())

  beforeEach(() => {
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

  describe("readState", () => {
    test("should parse target_branch from frontmatter YAML", () => {
      //#given - a state file with target_branch in frontmatter
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR against dev",
        target_branch: "dev",
        pr_files: ["src/file1.ts", "src/file2.ts"],
      }
      writeState(TEST_DIR, state)

      //#when - read state
      const result = readState(TEST_DIR)

      //#then - target_branch should be parsed correctly
      expect(result).not.toBeNull()
      expect(result?.target_branch).toBe("dev")
    })

    test("should parse pr_files as YAML array from frontmatter", () => {
      //#given - a state file with pr_files array
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "main",
        pr_files: ["src/hooks/review-loop/index.ts", "src/hooks/review-loop/storage.ts", "src/hooks/review-loop/types.ts"],
      }
      writeState(TEST_DIR, state)

      //#when - read state
      const result = readState(TEST_DIR)

      //#then - pr_files should be parsed as array
      expect(result).not.toBeNull()
      expect(Array.isArray(result?.pr_files)).toBe(true)
      expect(result?.pr_files).toEqual(["src/hooks/review-loop/index.ts", "src/hooks/review-loop/storage.ts", "src/hooks/review-loop/types.ts"])
    })

    test("should return null for non-existent state file", () => {
      //#given - no state file exists
      //#when - read state
      const result = readState(TEST_DIR)

      //#then - should return null
      expect(result).toBeNull()
    })

    test("should handle empty pr_files array", () => {
      //#given - state with empty pr_files
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: [],
      }
      writeState(TEST_DIR, state)

      //#when - read state
      const result = readState(TEST_DIR)

      //#then - pr_files should be empty array
      expect(result?.pr_files).toEqual([])
    })
  })

  describe("writeState", () => {
    test("should serialize pr_files as YAML array in frontmatter", () => {
      //#given - a state with pr_files
      const state: ReviewLoopState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR against dev",
        target_branch: "dev",
        pr_files: ["src/file1.ts", "src/file2.ts"],
      }

      //#when - write state
      const success = writeState(TEST_DIR, state)

      //#then - write should succeed
      expect(success).toBe(true)

      //#then - file should contain pr_files as YAML array
      const filePath = join(TEST_DIR, ".sisyphus/review-loop.local.md")
      const content = require("node:fs").readFileSync(filePath, "utf-8")
      expect(content).toContain("pr_files:")
      expect(content).toContain("- src/file1.ts")
      expect(content).toContain("- src/file2.ts")
    })

    test("should include target_branch in frontmatter", () => {
      //#given - a state with target_branch
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "main",
        pr_files: ["src/file1.ts"],
      }

      //#when - write state
      writeState(TEST_DIR, state)

      //#then - file should contain target_branch
      const filePath = join(TEST_DIR, ".sisyphus/review-loop.local.md")
      const content = require("node:fs").readFileSync(filePath, "utf-8")
      expect(content).toContain("target_branch: main")
    })

    test("should write to .sisyphus/review-loop.local.md by default", () => {
      //#given - a state
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: [],
      }

      //#when - write state
      writeState(TEST_DIR, state)

      //#then - file should exist at correct path
      const filePath = join(TEST_DIR, ".sisyphus/review-loop.local.md")
      expect(existsSync(filePath)).toBe(true)
    })

    test("should create parent directories if they don't exist", () => {
      //#given - a state and non-existent parent directory
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: [],
      }

      //#when - write state
      const success = writeState(TEST_DIR, state)

      //#then - should succeed and create directories
      expect(success).toBe(true)
      const filePath = join(TEST_DIR, ".sisyphus/review-loop.local.md")
      expect(existsSync(filePath)).toBe(true)
    })
  })

  describe("clearState", () => {
    test("should delete state file", () => {
      //#given - existing state file
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: [],
      }
      writeState(TEST_DIR, state)

      //#when - clear state
      const success = clearState(TEST_DIR)

      //#then - should succeed and file should not exist
      expect(success).toBe(true)
      expect(readState(TEST_DIR)).toBeNull()
    })

    test("should return true even if file doesn't exist", () => {
      //#given - no state file
      //#when - clear state
      const success = clearState(TEST_DIR)

      //#then - should return true
      expect(success).toBe(true)
    })
  })

  describe("incrementIteration", () => {
    test("should increment iteration and persist to file", () => {
      //#given - existing state with iteration 1
      const state: ReviewLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR",
        target_branch: "dev",
        pr_files: ["src/file1.ts"],
      }
      writeState(TEST_DIR, state)

      //#when - increment iteration
      const result = incrementIteration(TEST_DIR)

      //#then - should return state with iteration 2
      expect(result).not.toBeNull()
      expect(result?.iteration).toBe(2)

      //#then - persisted state should also have iteration 2
      const readBack = readState(TEST_DIR)
      expect(readBack?.iteration).toBe(2)
    })

    test("should return null if no state exists", () => {
      //#given - no state file
      //#when - increment iteration
      const result = incrementIteration(TEST_DIR)

      //#then - should return null
      expect(result).toBeNull()
    })

    test("should preserve all other fields when incrementing", () => {
      //#given - state with all fields
      const state: ReviewLoopState = {
        active: true,
        iteration: 3,
        max_iterations: 10,
        completion_promise: "REVIEW_COMPLETE",
        started_at: "2026-02-06T15:00:00Z",
        prompt: "Review PR against dev",
        session_id: "ses_123",
        target_branch: "dev",
        pr_files: ["src/file1.ts", "src/file2.ts"],
      }
      writeState(TEST_DIR, state)

      //#when - increment iteration
      const result = incrementIteration(TEST_DIR)

      //#then - all fields should be preserved except iteration
      expect(result?.active).toBe(true)
      expect(result?.max_iterations).toBe(10)
      expect(result?.completion_promise).toBe("REVIEW_COMPLETE")
      expect(result?.started_at).toBe("2026-02-06T15:00:00Z")
      expect(result?.prompt).toBe("Review PR against dev")
      expect(result?.session_id).toBe("ses_123")
      expect(result?.target_branch).toBe("dev")
      expect(result?.pr_files).toEqual(["src/file1.ts", "src/file2.ts"])
    })
  })
})

describe("review-loop hook", () => {
  const TEST_DIR = join(tmpdir(), "review-loop-hook-test-" + Date.now())
  let promptCalls: Array<{ sessionID: string; text: string; agent?: string; model?: { providerID: string; modelID: string } }>
  let toastCalls: Array<{ title: string; message: string; variant: string }>
  let messagesCalls: Array<{ sessionID: string }>
  let mockSessionMessages: Array<{ info?: { role?: string }; parts?: Array<{ type: string; text?: string }> }>

  function createMockPluginInput() {
    return {
      client: {
        session: {
          prompt: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }>; agent?: string; model?: { providerID: string; modelID: string } } }) => {
            promptCalls.push({
              sessionID: opts.path.id,
              text: opts.body.parts[0].text,
              agent: opts.body.agent,
              model: opts.body.model,
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
    } as unknown as Parameters<typeof createReviewLoopHook>[0]
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

  //#region Test 1: startLoop creates state with target_branch, pr_files, session_id
  test("startLoop creates state with target_branch, pr_files, session_id", () => {
    //#given - a hook instance
    const hook = createReviewLoopHook(createMockPluginInput())

    //#when - start loop with target branch and pr files
    const success = hook.startLoop("session-123", "dev", ["src/file1.ts", "src/file2.ts"])

    //#then - state should be written with correct fields
    expect(success).toBe(true)
    const state = hook.getState()
    expect(state).not.toBeNull()
    expect(state?.active).toBe(true)
    expect(state?.iteration).toBe(1)
    expect(state?.session_id).toBe("session-123")
    expect(state?.target_branch).toBe("dev")
    expect(state?.pr_files).toEqual(["src/file1.ts", "src/file2.ts"])
    expect(state?.max_iterations).toBe(10) // DEFAULT_MAX_ITERATIONS
    expect(state?.completion_promise).toBe("REVIEW_COMPLETE") // DEFAULT_COMPLETION_PROMISE
  })
  //#endregion

  //#region Test 2: cancelLoop clears state for matching session
  test("cancelLoop clears state for matching session", () => {
    //#given - active loop
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    //#when - cancel loop
    const success = hook.cancelLoop("session-123")

    //#then - loop cancelled
    expect(success).toBe(true)
    expect(hook.getState()).toBeNull()
  })
  //#endregion

  //#region Test 3: cancelLoop returns false for non-matching session
  test("cancelLoop returns false for non-matching session", () => {
    //#given - active loop for session-123
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    //#when - try to cancel for different session
    const success = hook.cancelLoop("session-456")

    //#then - cancel should fail
    expect(success).toBe(false)
    expect(hook.getState()).not.toBeNull()
  })
  //#endregion

  //#region Test 4: getState returns current state
  test("getState returns current state", () => {
    //#given - a hook with active loop
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "main", ["src/a.ts", "src/b.ts"])

    //#when - get state
    const state = hook.getState()

    //#then - state should be returned correctly
    expect(state).not.toBeNull()
    expect(state?.active).toBe(true)
    expect(state?.target_branch).toBe("main")
    expect(state?.pr_files).toEqual(["src/a.ts", "src/b.ts"])
  })
  //#endregion

  //#region Test 5: event(session.idle) detects completion promise → clears state
  test("event(session.idle) detects completion promise via transcript → clears state", async () => {
    //#given - active loop with transcript containing completion
    const transcriptPath = join(TEST_DIR, "transcript.jsonl")
    const hook = createReviewLoopHook(createMockPluginInput(), {
      getTranscriptPath: () => transcriptPath,
    })
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    writeFileSync(
      transcriptPath,
      JSON.stringify({ type: "tool_result", tool_name: "write", tool_output: { output: "All done <promise>REVIEW_COMPLETE</promise>" } }) + "\n"
    )

    //#when - session goes idle
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-123" } },
    })

    //#then - loop completed, no continuation
    expect(promptCalls.length).toBe(0)
    expect(toastCalls.some((t) => t.title === "Review Loop Complete!")).toBe(true)
    expect(hook.getState()).toBeNull()
  })
  //#endregion

  //#region Test 6: event(session.idle) increments iteration when no completion
  test("event(session.idle) increments iteration when no completion detected", async () => {
    //#given - active loop state with no completion in transcript
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts", "src/file2.ts"])

    //#when - session goes idle
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-123" } },
    })

    //#then - continuation should be injected
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].sessionID).toBe("session-123")
    expect(promptCalls[0].text).toContain("REVIEW LOOP")
    expect(promptCalls[0].text).toContain("2/10")

    //#then - iteration should be incremented
    const state = hook.getState()
    expect(state?.iteration).toBe(2)
  })
  //#endregion

  //#region Test 7: event(session.idle) stops at max iterations
  test("event(session.idle) stops at max iterations", async () => {
    //#given - loop at max iteration
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    const state = hook.getState()!
    state.iteration = 10 // DEFAULT_MAX_ITERATIONS
    writeState(TEST_DIR, state)

    //#when - session goes idle
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-123" } },
    })

    //#then - no continuation injected
    expect(promptCalls.length).toBe(0)

    //#then - warning toast shown
    expect(toastCalls.length).toBe(1)
    expect(toastCalls[0].title).toBe("Review Loop Stopped")
    expect(toastCalls[0].variant).toBe("warning")

    //#then - state should be cleared
    expect(hook.getState()).toBeNull()
  })
  //#endregion

  //#region Test 8: event(session.idle) skips when in recovery mode
  test("event(session.idle) skips when in recovery mode", async () => {
    //#given - active loop and session in recovery
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "session-123", error: new Error("test") },
      },
    })

    //#when - session goes idle immediately
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-123" } },
    })

    //#then - no continuation injected (recovery mode)
    expect(promptCalls.length).toBe(0)
  })
  //#endregion

  //#region Test 9: event(session.idle) skips when session doesn't match
  test("event(session.idle) skips when session doesn't match", async () => {
    //#given - loop owned by session-123
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    //#when - different session goes idle
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-456" } },
    })

    //#then - no continuation injected
    expect(promptCalls.length).toBe(0)
  })
  //#endregion

  //#region Test 10: event(session.deleted) clears state for matching session
  test("event(session.deleted) clears state for matching session", async () => {
    //#given - active loop
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    //#when - session deleted
    await hook.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: "session-123" } },
      },
    })

    //#then - state should be cleared
    expect(hook.getState()).toBeNull()
  })
  //#endregion

  //#region Test 11: event(session.error) MessageAbortedError → clears state
  test("event(session.error) MessageAbortedError clears state immediately", async () => {
    //#given - active loop
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts"])
    expect(hook.getState()).not.toBeNull()

    //#when - user aborts (Ctrl+C)
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "session-123",
          error: { name: "MessageAbortedError", message: "User aborted" },
        },
      },
    })

    //#then - loop state should be cleared immediately
    expect(hook.getState()).toBeNull()
  })
  //#endregion

  //#region Test 12: event(session.error) sets recovery mode
  test("event(session.error) sets recovery mode for non-abort errors", async () => {
    //#given - active loop
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    //#when - generic error occurs
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "session-123", error: { name: "Error", message: "something failed" } },
      },
    })

    //#then - subsequent idle should be skipped (recovery mode)
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-123" } },
    })
    expect(promptCalls.length).toBe(0)
  })
  //#endregion

  //#region Test 13: Continuation prompt includes target_branch and pr_files
  test("continuation prompt includes target_branch and pr_files", async () => {
    //#given - active loop with specific target branch and PR files
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/hooks/review-loop/index.ts", "src/hooks/review-loop/storage.ts"])

    //#when - session goes idle
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-123" } },
    })

    //#then - continuation prompt should include target branch and file list
    expect(promptCalls.length).toBe(1)
    const promptText = promptCalls[0].text
    expect(promptText).toContain("dev") // target branch
    expect(promptText).toContain("src/hooks/review-loop/index.ts")
    expect(promptText).toContain("src/hooks/review-loop/storage.ts")
    expect(promptText).toContain("<promise>REVIEW_COMPLETE</promise>")
  })
  //#endregion

  //#region Bonus: Completion detection via session messages API (fallback)
  test("detects completion via session messages API when transcript unavailable", async () => {
    //#given - active loop with assistant message containing completion promise
    mockSessionMessages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "Review the PR" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Review complete. <promise>REVIEW_COMPLETE</promise>" }] },
    ]
    const hook = createReviewLoopHook(createMockPluginInput(), {
      getTranscriptPath: () => join(TEST_DIR, "nonexistent.jsonl"),
    })
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    //#when - session goes idle
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-123" } },
    })

    //#then - loop completed via API detection, no continuation
    expect(promptCalls.length).toBe(0)
    expect(toastCalls.some((t) => t.title === "Review Loop Complete!")).toBe(true)
    expect(hook.getState()).toBeNull()
    expect(messagesCalls.length).toBe(1)
  })
  //#endregion

  //#region Bonus: Toast shows iteration counter
  test("shows iteration toast during continuation", async () => {
    //#given - active loop
    const hook = createReviewLoopHook(createMockPluginInput())
    hook.startLoop("session-123", "dev", ["src/file1.ts"])

    //#when - session goes idle
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "session-123" } },
    })

    //#then - iteration toast shown
    expect(toastCalls.some((t) => t.title === "Review Loop" && t.message.includes("2/10"))).toBe(true)
  })
  //#endregion
})
