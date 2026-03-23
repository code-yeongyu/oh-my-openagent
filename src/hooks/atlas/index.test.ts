import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import {
  writeBoulderState,
  clearBoulderState,
  readBoulderState,
} from "../../features/boulder-state"
import type { BoulderState } from "../../features/boulder-state"
import { _resetForTesting, subagentSessions, updateSessionAgent } from "../../features/claude-code-session-state"
import type { PendingTaskRef } from "./types"

const TEST_STORAGE_ROOT = join(tmpdir(), `atlas-message-storage-${randomUUID()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE_ROOT, "message")
const TEST_PART_STORAGE = join(TEST_STORAGE_ROOT, "part")

mock.module("../../features/hook-message-injector/constants", () => ({
  OPENCODE_STORAGE: TEST_STORAGE_ROOT,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    const dir = join(TEST_MESSAGE_STORAGE, sessionID)
    return existsSync(dir) ? dir : null
  },
}))

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
}))

const { createAtlasHook } = await import("./index")
const { createToolExecuteAfterHandler } = await import("./tool-execute-after")
const { createToolExecuteBeforeHandler } = await import("./tool-execute-before")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

describe("atlas hook", () => {
  let TEST_DIR: string
  let SISYPHUS_DIR: string

  function createMockPluginInput(overrides?: {
    promptMock?: ReturnType<typeof mock>
    sessionGetMock?: ReturnType<typeof mock>
  }) {
    const promptMock = overrides?.promptMock ?? mock(() => Promise.resolve())
    const sessionGetMock = overrides?.sessionGetMock ?? mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id.startsWith("ses_") ? "session-1" : "main-session-123",
      },
    }))
    return {
      directory: TEST_DIR,
      client: {
        session: {
          get: sessionGetMock,
          prompt: promptMock,
          promptAsync: promptMock,
        },
      },
      _promptMock: promptMock,
      _sessionGetMock: sessionGetMock,
    } as unknown as Parameters<typeof createAtlasHook>[0] & {
      _promptMock: ReturnType<typeof mock>
      _sessionGetMock: ReturnType<typeof mock>
    }
  }

  function setupMessageStorage(sessionID: string, agent: string): void {
    const messageDir = join(MESSAGE_STORAGE, sessionID)
    if (!existsSync(messageDir)) {
      mkdirSync(messageDir, { recursive: true })
    }
    const messageData = {
      agent,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    }
    writeFileSync(join(messageDir, "msg_test001.json"), JSON.stringify(messageData))
  }

  function cleanupMessageStorage(sessionID: string): void {
    const messageDir = join(MESSAGE_STORAGE, sessionID)
    if (existsSync(messageDir)) {
      rmSync(messageDir, { recursive: true, force: true })
    }
  }

  beforeEach(() => {
    TEST_DIR = join(tmpdir(), `atlas-test-${randomUUID()}`)
    SISYPHUS_DIR = join(TEST_DIR, ".sisyphus")
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    if (!existsSync(SISYPHUS_DIR)) {
      mkdirSync(SISYPHUS_DIR, { recursive: true })
    }
    clearBoulderState(TEST_DIR)
  })

  afterEach(() => {
    clearBoulderState(TEST_DIR)
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("tool.execute.after handler", () => {
    test("should handle undefined output gracefully (issue #1035)", async () => {
      // given - hook and undefined output (e.g., from /review command)
      const hook = createAtlasHook(createMockPluginInput())

      // when - calling with undefined output
      const result = await hook["tool.execute.after"](
        { tool: "task", sessionID: "session-123" },
        undefined as unknown as { title: string; output: string; metadata: Record<string, unknown> }
      )

      // then - returns undefined without throwing
      expect(result).toBeUndefined()
    })

    test("should ignore non-task tools", async () => {
      // given - hook and non-task tool
      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Test Tool",
        output: "Original output",
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "other_tool", sessionID: "session-123" },
        output
      )

      // then - output unchanged
      expect(output.output).toBe("Original output")
    })

     test("should not transform when caller is not Atlas", async () => {
       // given - boulder state exists but caller agent in message storage is not Atlas
       const sessionID = "session-non-orchestrator-test"
       setupMessageStorage(sessionID, "other-agent")
      
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: "Task completed successfully",
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then - output unchanged because caller is not orchestrator
      expect(output.output).toBe("Task completed successfully")
      
      cleanupMessageStorage(sessionID)
    })

     test("should append standalone verification when no boulder state but caller is Atlas", async () => {
       // given - no boulder state, but caller is Atlas
       const sessionID = "session-no-boulder-test"
       setupMessageStorage(sessionID, "atlas")
      
      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: "Task completed successfully",
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then - standalone verification reminder appended
      expect(output.output).toContain("Task completed successfully")
      expect(output.output).toContain("LYING")
      expect(output.output).toContain("PHASE 1")
      
      cleanupMessageStorage(sessionID)
    })

     test("should transform output when caller is Atlas with boulder state", async () => {
       // given - Atlas caller with boulder state
       const sessionID = "session-transform-test"
       setupMessageStorage(sessionID, "atlas")
      
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: "Task completed successfully",
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then - output should be transformed (original output preserved for debugging)
      expect(output.output).toContain("Task completed successfully")
      expect(output.output).toContain("SUBAGENT WORK COMPLETED")
      expect(output.output).toContain("test-plan")
      expect(output.output).toContain("LYING")
      expect(output.output).toContain("PHASE 1")
      
      cleanupMessageStorage(sessionID)
    })

     test("should still transform when plan is complete (shows progress)", async () => {
       // given - boulder state with complete plan, Atlas caller
       const sessionID = "session-complete-plan-test"
       setupMessageStorage(sessionID, "atlas")
      
      const planPath = join(TEST_DIR, "complete-plan.md")
      writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [x] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "complete-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: "Original output",
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then - output transformed even when complete (shows 2/2 done)
      expect(output.output).toContain("SUBAGENT WORK COMPLETED")
      expect(output.output).toContain("2/2 done")
      expect(output.output).toContain("0 remaining")
      
      cleanupMessageStorage(sessionID)
    })

     test("should append session ID to boulder state if not present", async () => {
       // given - boulder state without session-append-test, Atlas caller
       const sessionID = "session-append-test"
       setupMessageStorage(sessionID, "atlas")
      
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: "Task output",
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then - sessionID should be appended
      const updatedState = readBoulderState(TEST_DIR)
      expect(updatedState?.session_ids).toContain(sessionID)
      
      cleanupMessageStorage(sessionID)
    })

     test("should not duplicate existing session ID", async () => {
       // given - boulder state already has session-dup-test, Atlas caller
       const sessionID = "session-dup-test"
       setupMessageStorage(sessionID, "atlas")
      
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [sessionID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: "Task output",
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then - should still have only one sessionID
      const updatedState = readBoulderState(TEST_DIR)
      const count = updatedState?.session_ids.filter((id) => id === sessionID).length
      expect(count).toBe(1)
      
      cleanupMessageStorage(sessionID)
    })

     test("should include boulder.json path and notepad path in transformed output", async () => {
       // given - boulder state, Atlas caller
       const sessionID = "session-path-test"
       setupMessageStorage(sessionID, "atlas")
      
      const planPath = join(TEST_DIR, "my-feature.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2\n- [x] Task 3")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "my-feature",
      }
      writeBoulderState(TEST_DIR, state)

      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: "Task completed",
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then - output should contain plan name and progress
      expect(output.output).toContain("my-feature")
      expect(output.output).toContain("1/3 done")
      expect(output.output).toContain("2 remaining")
      
      cleanupMessageStorage(sessionID)
    })

     test("should include session_id and checkbox instructions in reminder", async () => {
       // given - boulder state, Atlas caller
       const sessionID = "session-resume-test"
       setupMessageStorage(sessionID, "atlas")
      
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: "Task completed",
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then - should include verification instructions
      expect(output.output).toContain("LYING")
     expect(output.output).toContain("PHASE 1")
     expect(output.output).toContain("PHASE 2")
      
      cleanupMessageStorage(sessionID)
    })

    test("should clean pending task refs when a task returns background launch output", async () => {
      // given - direct handlers with shared pending maps
      const sessionID = "session-bg-launch-cleanup-test"
      setupMessageStorage(sessionID, "atlas")

      const planPath = join(TEST_DIR, "background-cleanup-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
`)
      writeBoulderState(TEST_DIR, {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "background-cleanup-plan",
      })

      const pendingFilePaths = new Map<string, string>()
      const pendingTaskRefs = new Map<string, PendingTaskRef>()
      const beforeHandler = createToolExecuteBeforeHandler({
        ctx: createMockPluginInput(),
        pendingFilePaths,
        pendingTaskRefs,
      })
      const afterHandler = createToolExecuteAfterHandler({
        ctx: createMockPluginInput(),
        pendingFilePaths,
        pendingTaskRefs,
        autoCommit: true,
        getState: () => ({ promptFailureCount: 0 }),
      })

      // when - the task is captured before execution
      await beforeHandler(
        { tool: "task", sessionID, callID: "call-bg-launch" },
        { args: { prompt: "Implement auth flow" } }
      )
      expect(pendingTaskRefs.size).toBe(1)

      // and the task returns a background launch result
      await afterHandler(
        { tool: "task", sessionID, callID: "call-bg-launch" },
        {
          title: "Sisyphus Task",
          output: "Background task launched.\n\nSession ID: ses_bg_12345",
          metadata: {},
        }
      )

      // then - the pending task ref is still cleaned up
      expect(pendingTaskRefs.size).toBe(0)

      cleanupMessageStorage(sessionID)
    })

     test("should persist preferred subagent session for the current top-level task", async () => {
       // given - boulder state with a current top-level task, Atlas caller
       const sessionID = "session-task-session-track-test"
       setupMessageStorage(sessionID, "atlas")

      const planPath = join(TEST_DIR, "task-session-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
  - [ ] nested acceptance checkbox
`)

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "task-session-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: `Task completed successfully

<task_metadata>
session_id: ses_auth_flow_123
</task_metadata>`,
        metadata: {
          agent: "sisyphus-junior",
          category: "deep",
        },
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then
     const updatedState = readBoulderState(TEST_DIR)
      expect(updatedState?.task_sessions?.["todo:1"]?.session_id).toBe("ses_auth_flow_123")
      expect(updatedState?.task_sessions?.["todo:1"]?.task_title).toBe("Implement auth flow")
      expect(updatedState?.task_sessions?.["todo:1"]?.agent).toBe("sisyphus-junior")
      expect(updatedState?.task_sessions?.["todo:1"]?.category).toBe("deep")

      cleanupMessageStorage(sessionID)
    })

     test("should preserve the delegated task key even after the plan advances to the next task", async () => {
       // given - Atlas caller starts task 1, then the plan advances before task output is processed
       const sessionID = "session-stable-task-key-test"
       setupMessageStorage(sessionID, "atlas")

      const planPath = join(TEST_DIR, "stable-task-key-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
- [ ] 2. Add API validation
`)

      writeBoulderState(TEST_DIR, {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "stable-task-key-plan",
      })

      const hook = createAtlasHook(createMockPluginInput())

      // when - Atlas delegates task 1
      await hook["tool.execute.before"](
        { tool: "task", sessionID, callID: "call-task-1" },
        { args: { prompt: "Implement auth flow" } }
      )

      // and the plan is advanced before the task output is processed
      writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Implement auth flow
- [ ] 2. Add API validation
`)

      await hook["tool.execute.after"](
        { tool: "task", sessionID, callID: "call-task-1" },
        {
          title: "Sisyphus Task",
          output: `Task completed successfully

<task_metadata>
session_id: ses_auth_flow_123
</task_metadata>`,
          metadata: {
            agent: "sisyphus-junior",
            category: "deep",
          },
        }
      )

      // then - the completed task session is still recorded against task 1, not task 2
     const updatedState = readBoulderState(TEST_DIR)
      expect(updatedState?.task_sessions?.["todo:1"]?.session_id).toBe("ses_auth_flow_123")
      expect(updatedState?.task_sessions?.["todo:2"]).toBeUndefined()

      cleanupMessageStorage(sessionID)
    })

     test("should not overwrite the current task mapping when task() explicitly resumes an older session", async () => {
       // given - current plan is on task 2, but Atlas explicitly resumes an older session for a previous task
       const sessionID = "session-cross-task-resume-test"
       setupMessageStorage(sessionID, "atlas")

      const planPath = join(TEST_DIR, "cross-task-resume-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Implement auth flow
- [ ] 2. Add API validation
`)

      writeBoulderState(TEST_DIR, {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "cross-task-resume-plan",
      })

      const hook = createAtlasHook(createMockPluginInput())

      // when - Atlas resumes an explicit prior session
      await hook["tool.execute.before"](
        { tool: "task", sessionID, callID: "call-resume-old-task" },
        { args: { prompt: "Follow up on previous task", session_id: "ses_old_task_111" } }
      )

      const output = {
        title: "Sisyphus Task",
        output: `Task continued successfully

<task_metadata>
session_id: ses_old_task_111
</task_metadata>`,
        metadata: {
          agent: "sisyphus-junior",
          category: "deep",
        },
      }
      await hook["tool.execute.after"](
        { tool: "task", sessionID, callID: "call-resume-old-task" },
        output
      )

      // then - Atlas does not poison task 2's preferred session mapping
      const updatedState = readBoulderState(TEST_DIR)
      expect(updatedState?.task_sessions?.["todo:2"]).toBeUndefined()
      expect(output.output).not.toContain('task(session_id="ses_old_task_111"')

      cleanupMessageStorage(sessionID)
    })

    test("should not reuse an explicitly resumed session id in completion reminders", async () => {
      // given - current plan is on task 2 with an existing tracked session
      const sessionID = "session-explicit-resume-reminder-test"
      setupMessageStorage(sessionID, "atlas")

      const planPath = join(TEST_DIR, "explicit-resume-reminder-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Implement auth flow
- [ ] 2. Add API validation
`)

      writeBoulderState(TEST_DIR, {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "explicit-resume-reminder-plan",
        task_sessions: {
          "todo:2": {
            task_key: "todo:2",
            task_label: "2",
            task_title: "Add API validation",
            session_id: "ses_tracked_current_task",
            updated_at: "2026-01-02T10:00:00Z",
          },
        },
      })

      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: `Task continued successfully

<task_metadata>
session_id: ses_old_task_111
</task_metadata>`,
        metadata: {},
      }

      // when
      await hook["tool.execute.before"](
        { tool: "task", sessionID, callID: "call-explicit-resume-reminder" },
        { args: { prompt: "Follow up on previous task", session_id: "ses_old_task_111" } }
      )
      await hook["tool.execute.after"](
        { tool: "task", sessionID, callID: "call-explicit-resume-reminder" },
        output
      )

      // then
      expect(output.output).not.toContain('task(session_id="ses_old_task_111"')
      expect(output.output).toContain("ses_tracked_current_task")

      cleanupMessageStorage(sessionID)
    })

    test("should skip persistence when multiple in-flight task calls claim the same top-level task", async () => {
      // given
      const sessionID = "session-parallel-task-collision-test"
      setupMessageStorage(sessionID, "atlas")

      const planPath = join(TEST_DIR, "parallel-task-collision-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
- [ ] 2. Add API validation
`)

      writeBoulderState(TEST_DIR, {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "parallel-task-collision-plan",
      })

      const pendingFilePaths = new Map<string, string>()
      const pendingTaskRefs = new Map<string, PendingTaskRef>()
      const beforeHandler = createToolExecuteBeforeHandler({
        ctx: createMockPluginInput(),
        pendingFilePaths,
        pendingTaskRefs,
      })
      const afterHandler = createToolExecuteAfterHandler({
        ctx: createMockPluginInput(),
        pendingFilePaths,
        pendingTaskRefs,
        autoCommit: true,
        getState: () => ({ promptFailureCount: 0 }),
      })

      // when - two task() calls start before either one completes
      await beforeHandler(
        { tool: "task", sessionID, callID: "call-task-first" },
        { args: { prompt: "Implement auth flow part 1" } }
      )
      await beforeHandler(
        { tool: "task", sessionID, callID: "call-task-second" },
        { args: { prompt: "Implement auth flow part 2" } }
      )

      const secondPendingTaskRef = pendingTaskRefs.get("call-task-second")

      await afterHandler(
        { tool: "task", sessionID, callID: "call-task-second" },
        {
          title: "Sisyphus Task",
          output: `Task completed successfully

<task_metadata>
session_id: ses_parallel_collision_222
</task_metadata>`,
          metadata: {},
        }
      )

      // then
      expect(secondPendingTaskRef).toEqual({
        kind: "skip",
        reason: "ambiguous_task_key",
        task: {
          key: "todo:1",
          label: "1",
          title: "Implement auth flow",
        },
      })
      const updatedState = readBoulderState(TEST_DIR)
      expect(updatedState?.task_sessions?.["todo:1"]).toBeUndefined()

      cleanupMessageStorage(sessionID)
    })

    test("should ignore extracted session ids that are outside the active boulder lineage", async () => {
      // given
      const sessionID = "session-untrusted-session-id-test"
      setupMessageStorage(sessionID, "atlas")

      const planPath = join(TEST_DIR, "untrusted-session-id-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
`)

      writeBoulderState(TEST_DIR, {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "untrusted-session-id-plan",
      })

      const hook = createAtlasHook(createMockPluginInput({
        sessionGetMock: mock(async ({ path }: { path: { id: string } }) => ({
          data: {
            id: path.id,
            parentID: path.id === "ses_untrusted_999" ? "session-outside-lineage" : "main-session-123",
          },
        })),
      }))
      const output = {
        title: "Sisyphus Task",
        output: `Task completed successfully

<task_metadata>
session_id: ses_untrusted_999
</task_metadata>`,
        metadata: {},
      }

      // when
      await hook["tool.execute.after"](
        { tool: "task", sessionID },
        output
      )

      // then
      const updatedState = readBoulderState(TEST_DIR)
      expect(updatedState?.task_sessions?.["todo:1"]).toBeUndefined()
      expect(output.output).not.toContain('task(session_id="ses_untrusted_999"')
      expect(output.output).toContain('task(session_id="<session_id>"')

      cleanupMessageStorage(sessionID)
    })

    describe("completion gate output ordering", () => {
      const COMPLETION_GATE_SESSION = "completion-gate-order-test"

      beforeEach(() => {
        setupMessageStorage(COMPLETION_GATE_SESSION, "atlas")
      })

      afterEach(() => {
        cleanupMessageStorage(COMPLETION_GATE_SESSION)
      })

      test("should include completion gate before Subagent Response in transformed boulder output", async () => {
        // given - Atlas caller with boulder state
        const planPath = join(TEST_DIR, "test-plan.md")
        writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

        const state: BoulderState = {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: ["session-1"],
          plan_name: "test-plan",
        }
        writeBoulderState(TEST_DIR, state)

        const hook = createAtlasHook(createMockPluginInput())
        const output = {
          title: "Sisyphus Task",
          output: "Task completed successfully",
          metadata: {},
        }

        // when
        await hook["tool.execute.after"](
          { tool: "task", sessionID: COMPLETION_GATE_SESSION },
          output
        )

        // then - completion gate should appear BEFORE Subagent Response
        const subagentResponseIndex = output.output.indexOf("**Subagent Response:**")
        const completionGateIndex = output.output.indexOf("COMPLETION GATE")

        expect(completionGateIndex).toBeGreaterThanOrEqual(0)
        expect(subagentResponseIndex).toBeGreaterThanOrEqual(0)
        expect(completionGateIndex).toBeLessThan(subagentResponseIndex)
      })

      test("should include completion gate before verification phase text", async () => {
        // given - Atlas caller with boulder state
        const planPath = join(TEST_DIR, "test-plan.md")
        writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

        const state: BoulderState = {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: ["session-1"],
          plan_name: "test-plan",
        }
        writeBoulderState(TEST_DIR, state)

        const hook = createAtlasHook(createMockPluginInput())
        const output = {
          title: "Sisyphus Task",
          output: "Task completed successfully",
          metadata: {},
        }

        // when
        await hook["tool.execute.after"](
          { tool: "task", sessionID: COMPLETION_GATE_SESSION },
          output
        )

        // then - completion gate should appear BEFORE verification phase text
        const completionGateIndex = output.output.indexOf("COMPLETION GATE")
        const lyingIndex = output.output.indexOf("LYING")
        const phase1Index = output.output.indexOf("PHASE 1")

        expect(completionGateIndex).toBeGreaterThanOrEqual(0)
        expect(lyingIndex).toBeGreaterThanOrEqual(0)
        expect(completionGateIndex).toBeLessThan(lyingIndex)
        if (phase1Index !== -1) {
          expect(completionGateIndex).toBeLessThan(phase1Index)
        }
      })

      test("should not contain old STEP 7 MARK COMPLETION IN PLAN FILE text", async () => {
        // given - Atlas caller with boulder state
        const planPath = join(TEST_DIR, "test-plan.md")
        writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

        const state: BoulderState = {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: ["session-1"],
          plan_name: "test-plan",
        }
        writeBoulderState(TEST_DIR, state)

        const hook = createAtlasHook(createMockPluginInput())
        const output = {
          title: "Sisyphus Task",
          output: "Task completed successfully",
          metadata: {},
        }

        // when
        await hook["tool.execute.after"](
          { tool: "task", sessionID: COMPLETION_GATE_SESSION },
          output
        )

        // then - old STEP 7 MARK COMPLETION IN PLAN FILE should be absent
        expect(output.output).not.toContain("STEP 7: MARK COMPLETION IN PLAN FILE")
        expect(output.output).not.toContain("MARK COMPLETION IN PLAN FILE")
      })
    })

    describe("Write/Edit tool direct work reminder", () => {
      const ORCHESTRATOR_SESSION = "orchestrator-write-test"

       beforeEach(() => {
         setupMessageStorage(ORCHESTRATOR_SESSION, "atlas")
       })

      afterEach(() => {
        cleanupMessageStorage(ORCHESTRATOR_SESSION)
      })

      test("should append delegation reminder when orchestrator writes outside .sisyphus/", async () => {
        // given
        const hook = createAtlasHook(createMockPluginInput())
        const output = {
          title: "Write",
          output: "File written successfully",
          metadata: { filePath: "/path/to/code.ts" },
        }

        // when
        await hook["tool.execute.after"](
          { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // then
        expect(output.output).toContain("ORCHESTRATOR, not an IMPLEMENTER")
        expect(output.output).toContain("task")
        expect(output.output).toContain("task")
      })

      test("should append delegation reminder when orchestrator edits outside .sisyphus/", async () => {
        // given
        const hook = createAtlasHook(createMockPluginInput())
        const output = {
          title: "Edit",
          output: "File edited successfully",
          metadata: { filePath: "/src/components/button.tsx" },
        }

        // when
        await hook["tool.execute.after"](
          { tool: "Edit", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // then
        expect(output.output).toContain("ORCHESTRATOR, not an IMPLEMENTER")
      })

      test("should NOT append reminder when orchestrator writes inside .sisyphus/", async () => {
        // given
        const hook = createAtlasHook(createMockPluginInput())
        const originalOutput = "File written successfully"
        const output = {
          title: "Write",
          output: originalOutput,
          metadata: { filePath: "/project/.sisyphus/plans/work-plan.md" },
        }

        // when
        await hook["tool.execute.after"](
          { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // then
        expect(output.output).toBe(originalOutput)
        expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
      })

      test("should NOT append reminder when non-orchestrator writes outside .sisyphus/", async () => {
        // given
        const nonOrchestratorSession = "non-orchestrator-session"
        setupMessageStorage(nonOrchestratorSession, "sisyphus-junior")
        
        const hook = createAtlasHook(createMockPluginInput())
        const originalOutput = "File written successfully"
        const output = {
          title: "Write",
          output: originalOutput,
          metadata: { filePath: "/path/to/code.ts" },
        }

        // when
        await hook["tool.execute.after"](
          { tool: "Write", sessionID: nonOrchestratorSession },
          output
        )

        // then
        expect(output.output).toBe(originalOutput)
        expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
        
        cleanupMessageStorage(nonOrchestratorSession)
      })

      test("should NOT append reminder for read-only tools", async () => {
        // given
        const hook = createAtlasHook(createMockPluginInput())
        const originalOutput = "File content"
        const output = {
          title: "Read",
          output: originalOutput,
          metadata: { filePath: "/path/to/code.ts" },
        }

        // when
        await hook["tool.execute.after"](
          { tool: "Read", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // then
        expect(output.output).toBe(originalOutput)
      })

      test("should handle missing filePath gracefully", async () => {
        // given
        const hook = createAtlasHook(createMockPluginInput())
        const originalOutput = "File written successfully"
        const output = {
          title: "Write",
          output: originalOutput,
          metadata: {},
        }

        // when
        await hook["tool.execute.after"](
          { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // then
        expect(output.output).toBe(originalOutput)
      })

      describe("cross-platform path validation (Windows support)", () => {
        test("should NOT append reminder when orchestrator writes inside .sisyphus\\ (Windows backslash)", async () => {
          // given
          const hook = createAtlasHook(createMockPluginInput())
          const originalOutput = "File written successfully"
          const output = {
            title: "Write",
            output: originalOutput,
            metadata: { filePath: ".sisyphus\\plans\\work-plan.md" },
          }

          // when
          await hook["tool.execute.after"](
            { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
            output
          )

          // then
          expect(output.output).toBe(originalOutput)
          expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
        })

        test("should NOT append reminder when orchestrator writes inside .sisyphus with mixed separators", async () => {
          // given
          const hook = createAtlasHook(createMockPluginInput())
          const originalOutput = "File written successfully"
          const output = {
            title: "Write",
            output: originalOutput,
            metadata: { filePath: ".sisyphus\\plans/work-plan.md" },
          }

          // when
          await hook["tool.execute.after"](
            { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
            output
          )

          // then
          expect(output.output).toBe(originalOutput)
          expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
        })

        test("should NOT append reminder for absolute Windows path inside .sisyphus\\", async () => {
          // given
          const hook = createAtlasHook(createMockPluginInput())
          const originalOutput = "File written successfully"
          const output = {
            title: "Write",
            output: originalOutput,
            metadata: { filePath: "C:\\Users\\test\\project\\.sisyphus\\plans\\x.md" },
          }

          // when
          await hook["tool.execute.after"](
            { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
            output
          )

          // then
          expect(output.output).toBe(originalOutput)
          expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
        })

        test("should append reminder for Windows path outside .sisyphus\\", async () => {
          // given
          const hook = createAtlasHook(createMockPluginInput())
          const output = {
            title: "Write",
            output: "File written successfully",
            metadata: { filePath: "C:\\Users\\test\\project\\src\\code.ts" },
          }

          // when
          await hook["tool.execute.after"](
            { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
            output
          )

          // then
          expect(output.output).toContain("ORCHESTRATOR, not an IMPLEMENTER")
        })
      })
    })
  })

  describe("session.idle handler (boulder continuation)", () => {
    const MAIN_SESSION_ID = "main-session-123"

    async function flushMicrotasks(): Promise<void> {
      await Promise.resolve()
      await Promise.resolve()
    }

     beforeEach(() => {
       _resetForTesting()
       subagentSessions.clear()
       setupMessageStorage(MAIN_SESSION_ID, "atlas")
     })

    afterEach(() => {
      cleanupMessageStorage(MAIN_SESSION_ID)
      _resetForTesting()
    })

    test("should inject continuation when boulder has incomplete tasks", async () => {
      // given - boulder state with incomplete plan
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should call prompt with continuation
      expect(mockInput._promptMock).toHaveBeenCalled()
      const callArgs = mockInput._promptMock.mock.calls[0][0]
      expect(callArgs.path.id).toBe(MAIN_SESSION_ID)
      expect(callArgs.body.parts[0].text).toContain("incomplete tasks")
      expect(callArgs.body.parts[0].text).toContain("2 remaining")
    })

    test("should not inject when no boulder state exists", async () => {
      // given - no boulder state
      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should not call prompt
      expect(mockInput._promptMock).not.toHaveBeenCalled()
    })

    test("should not inject when main session is not in boulder session_ids", async () => {
      // given - boulder state exists but current (main) session is NOT in session_ids
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["some-other-session-id"],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when - main session fires idle but is NOT in boulder's session_ids
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should NOT call prompt because session is not part of this boulder
      expect(mockInput._promptMock).not.toHaveBeenCalled()
    })

    test("should append subagent session to boulder before injecting continuation", async () => {
      // given - active boulder plan with another registered session and current session tracked as subagent
      const subagentSessionID = "subagent-session-456"
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)
      subagentSessions.add(subagentSessionID)
      updateSessionAgent(subagentSessionID, "atlas")

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when - subagent session goes idle before parent task output appends it
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: subagentSessionID },
        },
      })

      // then - session is registered into boulder and continuation is injected
      expect(readBoulderState(TEST_DIR)?.session_ids).toContain(subagentSessionID)
      expect(mockInput._promptMock).toHaveBeenCalled()
      const callArgs = mockInput._promptMock.mock.calls[0][0]
      expect(callArgs.path.id).toBe(subagentSessionID)
    })

    test("should inject when registered boulder session has incomplete tasks even if last agent differs", async () => {
      cleanupMessageStorage(MAIN_SESSION_ID)
      setupMessageStorage(MAIN_SESSION_ID, "hephaestus")

      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
        agent: "atlas",
      }
      writeBoulderState(TEST_DIR, state)

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      expect(mockInput._promptMock).toHaveBeenCalled()
      const callArgs = mockInput._promptMock.mock.calls[0][0]
      expect(callArgs.path.id).toBe(MAIN_SESSION_ID)
      expect(callArgs.body.parts[0].text).toContain("2 remaining")
    })

    test("should not inject when boulder plan is complete", async () => {
      // given - boulder state with complete plan
      const planPath = join(TEST_DIR, "complete-plan.md")
      writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [x] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "complete-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should not call prompt
      expect(mockInput._promptMock).not.toHaveBeenCalled()
    })

    test("should skip when abort error occurred before idle", async () => {
      // given - boulder state with incomplete plan
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when - send abort error then idle
      await hook.handler({
        event: {
          type: "session.error",
          properties: {
            sessionID: MAIN_SESSION_ID,
            error: { name: "AbortError", message: "aborted" },
          },
        },
      })
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should not call prompt
      expect(mockInput._promptMock).not.toHaveBeenCalled()
    })

     test("should skip when background tasks are running", async () => {
       // given - boulder state with incomplete plan
       const planPath = join(TEST_DIR, "test-plan.md")
       writeFileSync(planPath, "# Plan\n- [ ] Task 1")

       const state: BoulderState = {
         active_plan: planPath,
         started_at: "2026-01-02T10:00:00Z",
         session_ids: [MAIN_SESSION_ID],
         plan_name: "test-plan",
       }
       writeBoulderState(TEST_DIR, state)

       const mockBackgroundManager = {
         getTasksByParentSession: () => [{ status: "running" }],
       }

       const mockInput = createMockPluginInput()
       const hook = createAtlasHook(mockInput, {
         directory: TEST_DIR,
         backgroundManager: mockBackgroundManager as any,
       })

       // when
       await hook.handler({
         event: {
           type: "session.idle",
           properties: { sessionID: MAIN_SESSION_ID },
         },
       })

       // then - should not call prompt
       expect(mockInput._promptMock).not.toHaveBeenCalled()
     })

     test("should skip when continuation is stopped via isContinuationStopped", async () => {
       // given - boulder state with incomplete plan
       const planPath = join(TEST_DIR, "test-plan.md")
       writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

       const state: BoulderState = {
         active_plan: planPath,
         started_at: "2026-01-02T10:00:00Z",
         session_ids: [MAIN_SESSION_ID],
         plan_name: "test-plan",
       }
       writeBoulderState(TEST_DIR, state)

       const mockInput = createMockPluginInput()
       const hook = createAtlasHook(mockInput, {
         directory: TEST_DIR,
         isContinuationStopped: (sessionID: string) => sessionID === MAIN_SESSION_ID,
       })

       // when
       await hook.handler({
         event: {
           type: "session.idle",
           properties: { sessionID: MAIN_SESSION_ID },
         },
       })

       // then - should not call prompt because continuation is stopped
       expect(mockInput._promptMock).not.toHaveBeenCalled()
     })

    test("should clear abort state on message.updated", async () => {
      // given - boulder with incomplete plan
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when - abort error, then message update, then idle
      await hook.handler({
        event: {
          type: "session.error",
          properties: {
            sessionID: MAIN_SESSION_ID,
            error: { name: "AbortError" },
          },
        },
      })
      await hook.handler({
        event: {
          type: "message.updated",
          properties: { info: { sessionID: MAIN_SESSION_ID, role: "user" } },
        },
      })
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should call prompt because abort state was cleared
      expect(mockInput._promptMock).toHaveBeenCalled()
    })

    test("should include plan progress in continuation prompt", async () => {
      // given - boulder state with specific progress
      const planPath = join(TEST_DIR, "progress-plan.md")
      writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [x] Task 2\n- [ ] Task 3\n- [ ] Task 4")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "progress-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should include progress
      const callArgs = mockInput._promptMock.mock.calls[0][0]
      expect(callArgs.body.parts[0].text).toContain("2/4 completed")
      expect(callArgs.body.parts[0].text).toContain("2 remaining")
    })

    test("should include preferred reuse session in continuation prompt for current top-level task", async () => {
      // given - boulder state with tracked preferred session
      const planPath = join(TEST_DIR, "preferred-session-plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Implement auth flow
`)

      writeBoulderState(TEST_DIR, {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "preferred-session-plan",
        task_sessions: {
          "todo:1": {
            task_key: "todo:1",
            task_label: "1",
            task_title: "Implement auth flow",
            session_id: "ses_auth_flow_123",
            updated_at: "2026-01-02T10:00:00Z",
          },
        },
      })

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then
      const callArgs = mockInput._promptMock.mock.calls[0][0]
      expect(callArgs.body.parts[0].text).toContain("Preferred reuse session for current top-level plan task")
      expect(callArgs.body.parts[0].text).toContain("ses_auth_flow_123")
    })

    test("should inject when last agent is sisyphus and boulder targets atlas explicitly", async () => {
       // given - boulder explicitly set to atlas, but last agent is sisyphus (initial state after /start-work)
       const planPath = join(TEST_DIR, "test-plan.md")
       writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

       const state: BoulderState = {
         active_plan: planPath,
         started_at: "2026-01-02T10:00:00Z",
         session_ids: [MAIN_SESSION_ID],
         plan_name: "test-plan",
         agent: "atlas",
       }
       writeBoulderState(TEST_DIR, state)

       // given - last agent is sisyphus (typical state right after /start-work)
       cleanupMessageStorage(MAIN_SESSION_ID)
       setupMessageStorage(MAIN_SESSION_ID, "sisyphus")

       const mockInput = createMockPluginInput()
       const hook = createAtlasHook(mockInput)

       // when
       await hook.handler({
         event: {
           type: "session.idle",
           properties: { sessionID: MAIN_SESSION_ID },
         },
       })

       // then - should call prompt because sisyphus is always allowed for atlas boulders
       expect(mockInput._promptMock).toHaveBeenCalled()
     })

    test("should inject when registered atlas boulder session last agent does not match", async () => {
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

       const state: BoulderState = {
         active_plan: planPath,
         started_at: "2026-01-02T10:00:00Z",
         session_ids: [MAIN_SESSION_ID],
         plan_name: "test-plan",
         agent: "atlas",
       }
       writeBoulderState(TEST_DIR, state)

       cleanupMessageStorage(MAIN_SESSION_ID)
       setupMessageStorage(MAIN_SESSION_ID, "hephaestus")

       const mockInput = createMockPluginInput()
       const hook = createAtlasHook(mockInput)

      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      expect(mockInput._promptMock).toHaveBeenCalled()
    })

     test("should inject when last agent matches boulder agent even if non-Atlas", async () => {
       // given - boulder state expects sisyphus and last agent is sisyphus
       const planPath = join(TEST_DIR, "test-plan.md")
       writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

       const state: BoulderState = {
         active_plan: planPath,
         started_at: "2026-01-02T10:00:00Z",
         session_ids: [MAIN_SESSION_ID],
         plan_name: "test-plan",
         agent: "sisyphus",
       }
       writeBoulderState(TEST_DIR, state)

       cleanupMessageStorage(MAIN_SESSION_ID)
       setupMessageStorage(MAIN_SESSION_ID, "sisyphus")

       const mockInput = createMockPluginInput()
       const hook = createAtlasHook(mockInput)

       // when
       await hook.handler({
         event: {
           type: "session.idle",
           properties: { sessionID: MAIN_SESSION_ID },
         },
       })

       // then - should call prompt for sisyphus
       expect(mockInput._promptMock).toHaveBeenCalled()
       const callArgs = mockInput._promptMock.mock.calls[0][0]
       expect(callArgs.body.agent).toBe("sisyphus")
     })

    test("should debounce rapid continuation injections (prevent infinite loop)", async () => {
      // given - boulder state with incomplete plan
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when - fire multiple idle events in rapid succession (simulating infinite loop bug)
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should only call prompt ONCE due to debouncing
      expect(mockInput._promptMock).toHaveBeenCalledTimes(1)
    })

    test("should stop continuation after 10 consecutive prompt failures (issue #1355)", async () => {
      //#given - boulder state with incomplete plan and prompt always fails
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const promptMock = mock((): Promise<void> => Promise.reject(new Error("Bad Request")))
      const mockInput = createMockPluginInput({ promptMock })
      const hook = createAtlasHook(mockInput)

      const originalDateNow = Date.now
      let now = 0
      Date.now = () => now

      try {
        //#when - idle fires repeatedly, past cooldown each time
        for (let i = 0; i < 10; i++) {
          await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
          await flushMicrotasks()
          now += 6000
        }

        await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
        await flushMicrotasks()

        //#then - should attempt only 10 times, then disable continuation
        expect(promptMock).toHaveBeenCalledTimes(10)
      } finally {
        Date.now = originalDateNow
      }
    })

    test("should reset prompt failure counter on success and only stop after 10 consecutive failures", async () => {
      //#given - boulder state with incomplete plan
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const promptMock = mock((): Promise<void> => Promise.reject(new Error("Bad Request")))
      promptMock.mockImplementationOnce(() => Promise.reject(new Error("Bad Request")))
      promptMock.mockImplementationOnce(() => Promise.resolve())

      const mockInput = createMockPluginInput({ promptMock })
      const hook = createAtlasHook(mockInput)

      const originalDateNow = Date.now
      let now = 0
      Date.now = () => now

      try {
        //#when - fail, succeed (reset), then fail 10 times (disable), then attempt again
        for (let i = 0; i < 13; i++) {
          await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
          await flushMicrotasks()
          now += 6000
        }

        //#then - 12 prompt attempts; 13th idle is skipped after 10 consecutive failures
        expect(promptMock).toHaveBeenCalledTimes(12)
      } finally {
        Date.now = originalDateNow
      }
    })

    test("should keep skipping continuation during 5-minute backoff after 10 consecutive failures", async () => {
      //#given - boulder state with incomplete plan and prompt always fails
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const promptMock = mock(() => Promise.reject(new Error("Bad Request")))
      const mockInput = createMockPluginInput({ promptMock })
      const hook = createAtlasHook(mockInput)

      const originalDateNow = Date.now
      let now = 0
      Date.now = () => now

      try {
        //#when - 11th idle occurs inside 5-minute backoff window
        for (let i = 0; i < 10; i++) {
          await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
          await flushMicrotasks()
          now += 6000
        }

        now += 60000

        await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
        await flushMicrotasks()

        //#then - 11th attempt should still be skipped
        expect(promptMock).toHaveBeenCalledTimes(10)
      } finally {
        Date.now = originalDateNow
      }
    })

    test("should retry continuation after 5-minute backoff expires following 10 consecutive failures", async () => {
      //#given - boulder state with incomplete plan and prompt always fails
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const promptMock = mock(() => Promise.reject(new Error("Bad Request")))
      const mockInput = createMockPluginInput({ promptMock })
      const hook = createAtlasHook(mockInput)

      const originalDateNow = Date.now
      let now = 0
      Date.now = () => now

      try {
        //#when - 11th idle occurs after 5+ minutes
        for (let i = 0; i < 10; i++) {
          await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
          await flushMicrotasks()
          now += 6000
        }

        now += 300000

        await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
        await flushMicrotasks()

        //#then - 11th attempt should run after backoff expiration
        expect(promptMock).toHaveBeenCalledTimes(11)
      } finally {
        Date.now = originalDateNow
      }
    })

    test("should reset prompt failure counter after successful retry beyond backoff window", async () => {
      //#given - boulder state with incomplete plan and success on first retry after backoff
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const promptMock = mock((): Promise<void> => Promise.reject(new Error("Bad Request")))
      for (let i = 0; i < 10; i++) {
        promptMock.mockImplementationOnce(() => Promise.reject(new Error("Bad Request")))
      }
      promptMock.mockImplementationOnce(() => Promise.resolve(undefined))
      const mockInput = createMockPluginInput({ promptMock })
      const hook = createAtlasHook(mockInput)

      const originalDateNow = Date.now
      let now = 0
      Date.now = () => now

      try {
        //#when - fail 10 times, recover after backoff with success, then fail 10 times again
        for (let i = 0; i < 10; i++) {
          await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
          await flushMicrotasks()
          now += 6000
        }

        now += 300000

        await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
        await flushMicrotasks()
        now += 6000

        for (let i = 0; i < 10; i++) {
          await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
          await flushMicrotasks()
          now += 6000
        }

        await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
        await flushMicrotasks()

        //#then - success retry resets counter, so 10 additional failures are allowed before skip
        expect(promptMock).toHaveBeenCalledTimes(21)
      } finally {
        Date.now = originalDateNow
      }
    })

    test("should reset continuation failure state on session.compacted event", async () => {
      //#given - boulder state with incomplete plan and prompt always fails
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const promptMock = mock(() => Promise.reject(new Error("Bad Request")))
      const mockInput = createMockPluginInput({ promptMock })
      const hook = createAtlasHook(mockInput)

      const originalDateNow = Date.now
      let now = 0
      Date.now = () => now

      try {
        //#when - 10 failures disable continuation, then compaction resets it
        for (let i = 0; i < 10; i++) {
          await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
          await flushMicrotasks()
          now += 6000
        }

        await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
        await flushMicrotasks()

        await hook.handler({ event: { type: "session.compacted", properties: { sessionID: MAIN_SESSION_ID } } })
        now += 6000

        await hook.handler({ event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } } })
        await flushMicrotasks()

        //#then - 10 attempts + 1 after compaction (11 total)
        expect(promptMock).toHaveBeenCalledTimes(11)
      } finally {
        Date.now = originalDateNow
      }
    })

    test("should cleanup on session.deleted", async () => {
      // given - boulder state
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when - create abort state then delete
      await hook.handler({
        event: {
          type: "session.error",
          properties: {
            sessionID: MAIN_SESSION_ID,
            error: { name: "AbortError" },
          },
        },
      })
      await hook.handler({
        event: {
          type: "session.deleted",
          properties: { info: { id: MAIN_SESSION_ID } },
        },
      })

      // Re-create boulder after deletion
      writeBoulderState(TEST_DIR, state)

      // Trigger idle - should inject because state was cleaned up
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should call prompt because session state was cleaned
      expect(mockInput._promptMock).toHaveBeenCalled()
    })

    test("should inject when session agent was updated to atlas by start-work even if message storage agent differs", async () => {
      // given - boulder targets atlas, but nearest stored message still says hephaestus
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
        agent: "atlas",
      }
      writeBoulderState(TEST_DIR, state)

      cleanupMessageStorage(MAIN_SESSION_ID)
      setupMessageStorage(MAIN_SESSION_ID, "hephaestus")
      updateSessionAgent(MAIN_SESSION_ID, "atlas")

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should continue because start-work updated session agent to atlas
      expect(mockInput._promptMock).toHaveBeenCalled()
    })

    describe("delayed retry timer (abort-stuck fix)", () => {
      const capturedTimers = new Map<number, { callback: Function; cleared: boolean }>()
      let nextFakeId = 99000
      const originalSetTimeout = globalThis.setTimeout
      const originalClearTimeout = globalThis.clearTimeout

      beforeEach(() => {
        capturedTimers.clear()
        nextFakeId = 99000

        globalThis.setTimeout = ((callback: Function, delay?: number, ...args: unknown[]) => {
          const normalized = typeof delay === "number" ? delay : 0
          if (normalized >= 5000) {
            const id = nextFakeId++
            capturedTimers.set(id, { callback: () => callback(...args), cleared: false })
            return id as unknown as ReturnType<typeof setTimeout>
          }
          return originalSetTimeout(callback as Parameters<typeof originalSetTimeout>[0], delay)
        }) as unknown as typeof setTimeout

        globalThis.clearTimeout = ((id?: number | ReturnType<typeof setTimeout>) => {
          if (typeof id === "number" && capturedTimers.has(id)) {
            capturedTimers.get(id)!.cleared = true
            capturedTimers.delete(id)
            return
          }
          originalClearTimeout(id as Parameters<typeof originalClearTimeout>[0])
        }) as unknown as typeof clearTimeout
      })

      afterEach(() => {
        globalThis.setTimeout = originalSetTimeout
        globalThis.clearTimeout = originalClearTimeout
      })

      async function firePendingTimers(): Promise<void> {
        for (const [id, entry] of capturedTimers) {
          if (!entry.cleared) {
            capturedTimers.delete(id)
            await entry.callback()
          }
        }
        await flushMicrotasks()
      }

      test("should schedule delayed retry when cooldown blocks idle for incomplete boulder", async () => {
        // given - boulder with incomplete plan
        const planPath = join(TEST_DIR, "test-plan.md")
        writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

        const state: BoulderState = {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [MAIN_SESSION_ID],
          plan_name: "test-plan",
        }
        writeBoulderState(TEST_DIR, state)

        const mockInput = createMockPluginInput()
        const hook = createAtlasHook(mockInput)

        // when - first idle injects, second idle within cooldown schedules retry timer
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })

        // then - fire pending timer and verify retry
        await firePendingTimers()
        expect(mockInput._promptMock).toHaveBeenCalledTimes(2)
      })

      test("should not schedule duplicate retry timers for rapid idle events", async () => {
        // given - boulder with incomplete plan
        const planPath = join(TEST_DIR, "test-plan.md")
        writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

        const state: BoulderState = {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [MAIN_SESSION_ID],
          plan_name: "test-plan",
        }
        writeBoulderState(TEST_DIR, state)

        const mockInput = createMockPluginInput()
        const hook = createAtlasHook(mockInput)

        // when - first idle injects, then 3 rapid idles within cooldown
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })

        // then - only one retry fires despite multiple cooldown-blocked idles
        await firePendingTimers()
        expect(mockInput._promptMock).toHaveBeenCalledTimes(2)
      })

      test("should not retry if plan completes before timer fires", async () => {
        // given - boulder with incomplete plan
        const planPath = join(TEST_DIR, "test-plan.md")
        writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

        const state: BoulderState = {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [MAIN_SESSION_ID],
          plan_name: "test-plan",
        }
        writeBoulderState(TEST_DIR, state)

        const mockInput = createMockPluginInput()
        const hook = createAtlasHook(mockInput)

        // when - first idle injects, second schedules retry, then plan completes before timer fires
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })

        writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [x] Task 2")

        // then - retry sees complete plan and bails out
        await firePendingTimers()
        expect(mockInput._promptMock).toHaveBeenCalledTimes(1)
      })

      test("should cleanup pending retry timer on session.deleted", async () => {
        // given - boulder with incomplete plan, schedule retry timer
        const planPath = join(TEST_DIR, "test-plan.md")
        writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

        const state: BoulderState = {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [MAIN_SESSION_ID],
          plan_name: "test-plan",
        }
        writeBoulderState(TEST_DIR, state)

        const mockInput = createMockPluginInput()
        const hook = createAtlasHook(mockInput)

        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })

        // when - delete session before timer fires
        await hook.handler({
          event: { type: "session.deleted", properties: { info: { id: MAIN_SESSION_ID } } },
        })

        // then - timer was cleared, prompt called only once
        await firePendingTimers()
        expect(mockInput._promptMock).toHaveBeenCalledTimes(1)
      })

      test("should cleanup pending retry timer on session.compacted", async () => {
        // given - boulder with incomplete plan, schedule retry timer
        const planPath = join(TEST_DIR, "test-plan.md")
        writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

        const state: BoulderState = {
          active_plan: planPath,
          started_at: "2026-01-02T10:00:00Z",
          session_ids: [MAIN_SESSION_ID],
          plan_name: "test-plan",
        }
        writeBoulderState(TEST_DIR, state)

        const mockInput = createMockPluginInput()
        const hook = createAtlasHook(mockInput)

        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })
        await hook.handler({
          event: { type: "session.idle", properties: { sessionID: MAIN_SESSION_ID } },
        })

        // when - compact session before timer fires
        await hook.handler({
          event: { type: "session.compacted", properties: { sessionID: MAIN_SESSION_ID } },
        })

        // then - timer was cleared, prompt called only once
        await firePendingTimers()
        expect(mockInput._promptMock).toHaveBeenCalledTimes(1)
      })
    })
  })
})
