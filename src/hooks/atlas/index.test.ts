import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createAtlasHook } from "./index"
import {
  writeBoulderState,
  clearBoulderState,
  readBoulderState,
} from "../../features/boulder-state"
import type { BoulderState } from "../../features/boulder-state"

import { MESSAGE_STORAGE } from "../../features/hook-message-injector"

describe("atlas hook", () => {
   const TEST_DIR = join(tmpdir(), "atlas-test-" + Date.now())
  const SISYPHUS_DIR = join(TEST_DIR, ".sisyphus")

  function createMockPluginInput(overrides?: { promptMock?: ReturnType<typeof mock> }) {
    const promptMock = overrides?.promptMock ?? mock(() => Promise.resolve())
    return {
      directory: TEST_DIR,
      client: {
        session: {
          prompt: promptMock,
        },
      },
      _promptMock: promptMock,
    } as unknown as Parameters<typeof createAtlasHook>[0] & { _promptMock: ReturnType<typeof mock> }
  }

  function setupMessageStorage(sessionID: string, agent: string): void {
    const messageDir = join(MESSAGE_STORAGE, sessionID)
    if (!existsSync(messageDir)) {
      mkdirSync(messageDir, { recursive: true })
    }
    const messageData = {
      agent,
      model: { providerID: "anthropic", modelID: "claude-opus-4-5" },
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
      // #given - hook and undefined output (e.g., from /review command)
      const hook = createAtlasHook(createMockPluginInput())

      // #when - calling with undefined output
      const result = await hook["tool.execute.after"](
        { tool: "delegate_task", sessionID: "session-123" },
        undefined as unknown as { title: string; output: string; metadata: Record<string, unknown> }
      )

      // #then - returns undefined without throwing
      expect(result).toBeUndefined()
    })

    test("should ignore non-delegate_task tools", async () => {
      // #given - hook and non-delegate_task tool
      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Test Tool",
        output: "Original output",
        metadata: {},
      }

      // #when
      await hook["tool.execute.after"](
        { tool: "other_tool", sessionID: "session-123" },
        output
      )

      // #then - output unchanged
      expect(output.output).toBe("Original output")
    })

     test("should not transform when caller is not Atlas", async () => {
       // #given - boulder state exists but caller agent in message storage is not Atlas
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

      // #when
      await hook["tool.execute.after"](
        { tool: "delegate_task", sessionID },
        output
      )

      // #then - output unchanged because caller is not orchestrator
      expect(output.output).toBe("Task completed successfully")
      
      cleanupMessageStorage(sessionID)
    })

     test("should append standalone verification when no boulder state but caller is Atlas", async () => {
       // #given - no boulder state, but caller is Atlas
       const sessionID = "session-no-boulder-test"
       setupMessageStorage(sessionID, "atlas")
      
      const hook = createAtlasHook(createMockPluginInput())
      const output = {
        title: "Sisyphus Task",
        output: "Task completed successfully",
        metadata: {},
      }

      // #when
      await hook["tool.execute.after"](
        { tool: "delegate_task", sessionID },
        output
      )

      // #then - standalone verification reminder appended
      expect(output.output).toContain("Task completed successfully")
      expect(output.output).toContain("MANDATORY:")
      expect(output.output).toContain("delegate_task(session_id=")
      
      cleanupMessageStorage(sessionID)
    })

     test("should transform output when caller is Atlas with boulder state", async () => {
       // #given - Atlas caller with boulder state
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

      // #when
      await hook["tool.execute.after"](
        { tool: "delegate_task", sessionID },
        output
      )

      // #then - output should be transformed (original output preserved for debugging)
      expect(output.output).toContain("Task completed successfully")
      expect(output.output).toContain("SUBAGENT WORK COMPLETED")
      expect(output.output).toContain("test-plan")
      expect(output.output).toContain("LIE")
      expect(output.output).toContain("delegate_task(session_id=")
      
      cleanupMessageStorage(sessionID)
    })

     test("should still transform when plan is complete (shows progress)", async () => {
       // #given - boulder state with complete plan, Atlas caller
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

      // #when
      await hook["tool.execute.after"](
        { tool: "delegate_task", sessionID },
        output
      )

      // #then - output transformed even when complete (shows 2/2 done)
      expect(output.output).toContain("SUBAGENT WORK COMPLETED")
      expect(output.output).toContain("2/2 done")
      expect(output.output).toContain("0 remaining")
      
      cleanupMessageStorage(sessionID)
    })

     test("should append session ID to boulder state if not present", async () => {
       // #given - boulder state without session-append-test, Atlas caller
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

      // #when
      await hook["tool.execute.after"](
        { tool: "delegate_task", sessionID },
        output
      )

      // #then - sessionID should be appended
      const updatedState = readBoulderState(TEST_DIR)
      expect(updatedState?.session_ids).toContain(sessionID)
      
      cleanupMessageStorage(sessionID)
    })

     test("should not duplicate existing session ID", async () => {
       // #given - boulder state already has session-dup-test, Atlas caller
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

      // #when
      await hook["tool.execute.after"](
        { tool: "delegate_task", sessionID },
        output
      )

      // #then - should still have only one sessionID
      const updatedState = readBoulderState(TEST_DIR)
      const count = updatedState?.session_ids.filter((id) => id === sessionID).length
      expect(count).toBe(1)
      
      cleanupMessageStorage(sessionID)
    })

     test("should include boulder.json path and notepad path in transformed output", async () => {
       // #given - boulder state, Atlas caller
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

      // #when
      await hook["tool.execute.after"](
        { tool: "delegate_task", sessionID },
        output
      )

      // #then - output should contain plan name and progress
      expect(output.output).toContain("my-feature")
      expect(output.output).toContain("1/3 done")
      expect(output.output).toContain("2 remaining")
      
      cleanupMessageStorage(sessionID)
    })

     test("should include session_id and checkbox instructions in reminder", async () => {
       // #given - boulder state, Atlas caller
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

      // #when
      await hook["tool.execute.after"](
        { tool: "delegate_task", sessionID },
        output
      )

      // #then - should include session_id instructions and verification
      expect(output.output).toContain("delegate_task(session_id=")
      expect(output.output).toContain("[x]")
      expect(output.output).toContain("MANDATORY:")
      
      cleanupMessageStorage(sessionID)
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
        // #given
        const hook = createAtlasHook(createMockPluginInput())
        const output = {
          title: "Write",
          output: "File written successfully",
          metadata: { filePath: "/path/to/code.ts" },
        }

        // #when
        await hook["tool.execute.after"](
          { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // #then
        expect(output.output).toContain("ORCHESTRATOR, not an IMPLEMENTER")
        expect(output.output).toContain("delegate_task")
        expect(output.output).toContain("delegate_task")
      })

      test("should append delegation reminder when orchestrator edits outside .sisyphus/", async () => {
        // #given
        const hook = createAtlasHook(createMockPluginInput())
        const output = {
          title: "Edit",
          output: "File edited successfully",
          metadata: { filePath: "/src/components/button.tsx" },
        }

        // #when
        await hook["tool.execute.after"](
          { tool: "Edit", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // #then
        expect(output.output).toContain("ORCHESTRATOR, not an IMPLEMENTER")
      })

      test("should NOT append reminder when orchestrator writes inside .sisyphus/", async () => {
        // #given
        const hook = createAtlasHook(createMockPluginInput())
        const originalOutput = "File written successfully"
        const output = {
          title: "Write",
          output: originalOutput,
          metadata: { filePath: "/project/.sisyphus/plans/work-plan.md" },
        }

        // #when
        await hook["tool.execute.after"](
          { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // #then
        expect(output.output).toBe(originalOutput)
        expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
      })

      test("should NOT append reminder when non-orchestrator writes outside .sisyphus/", async () => {
        // #given
        const nonOrchestratorSession = "non-orchestrator-session"
        setupMessageStorage(nonOrchestratorSession, "sisyphus-junior")
        
        const hook = createAtlasHook(createMockPluginInput())
        const originalOutput = "File written successfully"
        const output = {
          title: "Write",
          output: originalOutput,
          metadata: { filePath: "/path/to/code.ts" },
        }

        // #when
        await hook["tool.execute.after"](
          { tool: "Write", sessionID: nonOrchestratorSession },
          output
        )

        // #then
        expect(output.output).toBe(originalOutput)
        expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
        
        cleanupMessageStorage(nonOrchestratorSession)
      })

      test("should NOT append reminder for read-only tools", async () => {
        // #given
        const hook = createAtlasHook(createMockPluginInput())
        const originalOutput = "File content"
        const output = {
          title: "Read",
          output: originalOutput,
          metadata: { filePath: "/path/to/code.ts" },
        }

        // #when
        await hook["tool.execute.after"](
          { tool: "Read", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // #then
        expect(output.output).toBe(originalOutput)
      })

      test("should handle missing filePath gracefully", async () => {
        // #given
        const hook = createAtlasHook(createMockPluginInput())
        const originalOutput = "File written successfully"
        const output = {
          title: "Write",
          output: originalOutput,
          metadata: {},
        }

        // #when
        await hook["tool.execute.after"](
          { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
          output
        )

        // #then
        expect(output.output).toBe(originalOutput)
      })

      describe("cross-platform path validation (Windows support)", () => {
        test("should NOT append reminder when orchestrator writes inside .sisyphus\\ (Windows backslash)", async () => {
          // #given
          const hook = createAtlasHook(createMockPluginInput())
          const originalOutput = "File written successfully"
          const output = {
            title: "Write",
            output: originalOutput,
            metadata: { filePath: ".sisyphus\\plans\\work-plan.md" },
          }

          // #when
          await hook["tool.execute.after"](
            { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
            output
          )

          // #then
          expect(output.output).toBe(originalOutput)
          expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
        })

        test("should NOT append reminder when orchestrator writes inside .sisyphus with mixed separators", async () => {
          // #given
          const hook = createAtlasHook(createMockPluginInput())
          const originalOutput = "File written successfully"
          const output = {
            title: "Write",
            output: originalOutput,
            metadata: { filePath: ".sisyphus\\plans/work-plan.md" },
          }

          // #when
          await hook["tool.execute.after"](
            { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
            output
          )

          // #then
          expect(output.output).toBe(originalOutput)
          expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
        })

        test("should NOT append reminder for absolute Windows path inside .sisyphus\\", async () => {
          // #given
          const hook = createAtlasHook(createMockPluginInput())
          const originalOutput = "File written successfully"
          const output = {
            title: "Write",
            output: originalOutput,
            metadata: { filePath: "C:\\Users\\test\\project\\.sisyphus\\plans\\x.md" },
          }

          // #when
          await hook["tool.execute.after"](
            { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
            output
          )

          // #then
          expect(output.output).toBe(originalOutput)
          expect(output.output).not.toContain("ORCHESTRATOR, not an IMPLEMENTER")
        })

        test("should append reminder for Windows path outside .sisyphus\\", async () => {
          // #given
          const hook = createAtlasHook(createMockPluginInput())
          const output = {
            title: "Write",
            output: "File written successfully",
            metadata: { filePath: "C:\\Users\\test\\project\\src\\code.ts" },
          }

          // #when
          await hook["tool.execute.after"](
            { tool: "Write", sessionID: ORCHESTRATOR_SESSION },
            output
          )

          // #then
          expect(output.output).toContain("ORCHESTRATOR, not an IMPLEMENTER")
        })
      })
    })
  })

  describe("session.idle handler (boulder continuation)", () => {
    const MAIN_SESSION_ID = "main-session-123"

     beforeEach(() => {
       mock.module("../../features/claude-code-session-state", () => ({
         getMainSessionID: () => MAIN_SESSION_ID,
         subagentSessions: new Set<string>(),
       }))
       setupMessageStorage(MAIN_SESSION_ID, "atlas")
     })

    afterEach(() => {
      cleanupMessageStorage(MAIN_SESSION_ID)
    })

    test("should inject continuation when boulder has incomplete tasks", async () => {
      // #given - boulder state with incomplete plan
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

      // #when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // #then - should call prompt with continuation
      expect(mockInput._promptMock).toHaveBeenCalled()
      const callArgs = mockInput._promptMock.mock.calls[0][0]
      expect(callArgs.path.id).toBe(MAIN_SESSION_ID)
      expect(callArgs.body.parts[0].text).toContain("incomplete tasks")
      expect(callArgs.body.parts[0].text).toContain("2 remaining")
    })

    test("should not inject when no boulder state exists", async () => {
      // #given - no boulder state
      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // #when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // #then - should not call prompt
      expect(mockInput._promptMock).not.toHaveBeenCalled()
    })

    test("should not inject when boulder plan is complete", async () => {
      // #given - boulder state with complete plan
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

      // #when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // #then - should not call prompt
      expect(mockInput._promptMock).not.toHaveBeenCalled()
    })

    test("should skip when abort error occurred before idle", async () => {
      // #given - boulder state with incomplete plan
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

      // #when - send abort error then idle
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

      // #then - should not call prompt
      expect(mockInput._promptMock).not.toHaveBeenCalled()
    })

    test("should skip when background tasks are running", async () => {
      // #given - boulder state with incomplete plan
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

      // #when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // #then - should not call prompt
      expect(mockInput._promptMock).not.toHaveBeenCalled()
    })

    test("should clear abort state on message.updated", async () => {
      // #given - boulder with incomplete plan
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

      // #when - abort error, then message update, then idle
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

      // #then - should call prompt because abort state was cleared
      expect(mockInput._promptMock).toHaveBeenCalled()
    })

    test("should include plan progress in continuation prompt", async () => {
      // #given - boulder state with specific progress
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

      // #when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // #then - should include progress
      const callArgs = mockInput._promptMock.mock.calls[0][0]
      expect(callArgs.body.parts[0].text).toContain("2/4 completed")
      expect(callArgs.body.parts[0].text).toContain("2 remaining")
    })

     test("should not inject when last agent is not Atlas", async () => {
       // #given - boulder state with incomplete plan, but last agent is NOT Atlas
       const planPath = join(TEST_DIR, "test-plan.md")
       writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

       const state: BoulderState = {
         active_plan: planPath,
         started_at: "2026-01-02T10:00:00Z",
         session_ids: [MAIN_SESSION_ID],
         plan_name: "test-plan",
       }
       writeBoulderState(TEST_DIR, state)

       // #given - last agent is NOT Atlas
       cleanupMessageStorage(MAIN_SESSION_ID)
       setupMessageStorage(MAIN_SESSION_ID, "sisyphus")

       const mockInput = createMockPluginInput()
       const hook = createAtlasHook(mockInput)

       // #when
       await hook.handler({
         event: {
           type: "session.idle",
           properties: { sessionID: MAIN_SESSION_ID },
         },
       })

       // #then - should NOT call prompt because agent is not Atlas
       expect(mockInput._promptMock).not.toHaveBeenCalled()
     })

    test("should debounce rapid continuation injections (prevent infinite loop)", async () => {
      // #given - boulder state with incomplete plan
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

      // #when - fire multiple idle events in rapid succession (simulating infinite loop bug)
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

      // #then - should only call prompt ONCE due to debouncing
      expect(mockInput._promptMock).toHaveBeenCalledTimes(1)
    })

    test("should cleanup on session.deleted", async () => {
      // #given - boulder state
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

      // #when - create abort state then delete
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

      // #then - should call prompt because session state was cleaned
      expect(mockInput._promptMock).toHaveBeenCalled()
    })
  })
})
