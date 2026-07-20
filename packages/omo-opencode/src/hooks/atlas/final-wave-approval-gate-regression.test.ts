import { afterEach, beforeEach, describe, expect, mock, test, afterAll } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import type { BoulderState } from "../../features/boulder-state"
import { clearBoulderState, readBoulderState, writeBoulderState } from "../../features/boulder-state"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createTodoContinuationEnforcer } from "../todo-continuation-enforcer"

const TEST_STORAGE_ROOT = join(tmpdir(), `atlas-final-wave-regression-storage-${randomUUID()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE_ROOT, "message")
const TEST_PART_STORAGE = join(TEST_STORAGE_ROOT, "part")

mock.module("../../features/hook-message-injector/constants", () => ({
  OPENCODE_STORAGE: TEST_STORAGE_ROOT,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    const directoryPath = join(TEST_MESSAGE_STORAGE, sessionID)
    return existsSync(directoryPath) ? directoryPath : null
  },
}))

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
}))

afterAll(() => { mock.restore() })

const { createAtlasHook } = await import("./index")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

type AtlasHookContext = Parameters<typeof createAtlasHook>[0]

describe("Atlas final-wave approval gate regressions", () => {
  let testDirectory = ""
  let promptAsyncCalls = 0

  function createMockPluginInput(): AtlasHookContext {
    const client = createOpencodeClient({ baseUrl: "http://localhost" })

    Reflect.set(client.session, "prompt", async () => ({
      data: { info: {} as AssistantMessage, parts: [] },
      request: new Request("http://localhost/session/prompt"),
      response: new Response(),
    }))

    Reflect.set(client.session, "promptAsync", async () => {
      promptAsyncCalls += 1
      return {
      data: undefined,
      request: new Request("http://localhost/session/prompt_async"),
      response: new Response(),
      }
    })

    Reflect.set(client.session, "todo", async () => ({
      data: [
        { id: "todo-1", content: "Wait for final approval", status: "pending", priority: "high" },
      ],
      request: new Request("http://localhost/session/todo"),
      response: new Response(),
    }))

    Reflect.set(client.session, "messages", async () => ({
      data: [
        {
          info: {
            id: "msg-atlas-1",
            role: "user",
            agent: "atlas",
            model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
            finish: "stop",
          },
          parts: [{ type: "text", text: "Continue the final wave" }],
        },
      ],
      request: new Request("http://localhost/session/messages"),
      response: new Response(),
    }))

    Reflect.set(client.tui, "showToast", async () => ({
      data: undefined,
      request: new Request("http://localhost/tui/show-toast"),
      response: new Response(),
    }))

    Reflect.set(client.session, "get", async ({ path }: { path: { id: string } }) => {
      const parentID = path.id === "ses_nested_scope_review"
        ? "atlas-nested-final-wave-session"
        : path.id.startsWith("ses_parallel_review_")
          ? "atlas-parallel-final-wave-session"
          : "main-session-123"

      return {
        data: {
          id: path.id,
          parentID,
        } as Session,
        request: new Request(`http://localhost/session/${path.id}`),
        response: new Response(),
      }
    })

    return {
      directory: testDirectory,
      project: {} as AtlasHookContext["project"],
      worktree: testDirectory,
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost"),
      $: {} as AtlasHookContext["$"],
      client,
    }
  }

  function setupMessageStorage(sessionID: string): void {
    const messageDirectory = join(MESSAGE_STORAGE, sessionID)
    if (!existsSync(messageDirectory)) {
      mkdirSync(messageDirectory, { recursive: true })
    }

    writeFileSync(
      join(messageDirectory, "msg_test001.json"),
      JSON.stringify({
        agent: "atlas",
        model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      }),
    )
  }

  function writePlanState(sessionID: string, planName: string, planContent: string): void {
    const planPath = join(testDirectory, `${planName}.md`)
    writeFileSync(planPath, planContent)

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: planName,
      agent: "atlas",
    }

    writeBoulderState(testDirectory, state)
  }

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-final-wave-regression-${randomUUID()}`)
    mkdirSync(join(testDirectory, ".omo"), { recursive: true })
    promptAsyncCalls = 0
    releaseAllPromptAsyncReservationsForTesting()
    clearBoulderState(testDirectory)
  })

  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
    clearBoulderState(testDirectory)
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  test("waits for approval when nested plan checkboxes remain but the only pending top-level task is final-wave", async () => {
    // given
    const sessionID = "atlas-nested-final-wave-session"
    setupMessageStorage(sessionID)
    writePlanState(sessionID, "nested-final-wave-plan", `# Plan

## TODOs
- [x] 1. Implement feature

  **Acceptance Criteria**:
  - [ ] bun test src/feature.test.ts -> PASS

  **Evidence to Capture**:
  - [ ] Each evidence file named: task-1-happy-path.txt

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [x] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`

## Final Checklist
- [ ] All tests pass
`)

    const hook = createAtlasHook(createMockPluginInput(), {
      directory: testDirectory,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Tasks [1/1 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN] | VERDICT: APPROVE

<task_metadata>
session_id: ses_nested_scope_review
</task_metadata>`,
      metadata: {},
    }

    // when
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)

    // then
    expect(toolOutput.output).toContain("FINAL WAVE APPROVAL GATE")
    expect(toolOutput.output).toContain("explicit user approval")
    expect(toolOutput.output).not.toContain("STEP 8: PROCEED TO NEXT TASK")
  })

  test("waits for approval after the final parallel reviewer approves before plan checkboxes are updated", async () => {
    // given
    const sessionID = "atlas-parallel-final-wave-session"
    setupMessageStorage(sessionID)
    writePlanState(sessionID, "parallel-final-wave-plan", `# Plan

## TODOs
- [x] 1. Ship implementation
- [x] 2. Verify implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. **Plan Compliance Audit** - \`oracle\`
- [ ] F2. **Code Quality Review** - \`unspecified-high\`
- [ ] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`)

    const hook = createAtlasHook(createMockPluginInput(), {
      directory: testDirectory,
      isCallerOrchestrator: async () => true,
    })
    const firstThreeOutputs = [1, 2, 3].map((index) => ({
      title: `Final review ${index}`,
      output: `Reviewer ${index} | VERDICT: APPROVE

<task_metadata>
session_id: ses_parallel_review_${index}
</task_metadata>`,
      metadata: {},
    }))
    const lastOutput = {
      title: "Final review 4",
      output: `Reviewer 4 | VERDICT: APPROVE

<task_metadata>
session_id: ses_parallel_review_4
</task_metadata>`,
      metadata: {},
    }

    // when
    for (const toolOutput of firstThreeOutputs) {
      await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)
    }
    await hook["tool.execute.after"]({ tool: "task", sessionID }, lastOutput)

    // then
    for (const toolOutput of firstThreeOutputs) {
      expect(toolOutput.output).toContain("STEP 8: PROCEED TO NEXT TASK")
      expect(toolOutput.output).not.toContain("FINAL WAVE APPROVAL GATE")
    }
    expect(lastOutput.output).toContain("FINAL WAVE APPROVAL GATE")
    expect(lastOutput.output).toContain("explicit user approval")
    expect(lastOutput.output).not.toContain("STEP 8: PROCEED TO NEXT TASK")
  })

  test("keeps todo continuation silent while final-wave approval is pending", async () => {
    // given
    const sessionID = "atlas-final-wave-todo-session"
    setupMessageStorage(sessionID)
    writePlanState(sessionID, "todo-suppressed-final-wave-plan", `# Plan

## TODOs
- [x] 1. Ship implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [x] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`)

    const mockInput = createMockPluginInput()
    const atlasHook = createAtlasHook(mockInput, {
      directory: testDirectory,
      isCallerOrchestrator: async () => true,
    })
    const todoContinuation = createTodoContinuationEnforcer(mockInput)
    const toolOutput = {
      title: "Final review 4",
      output: `Reviewer 4 | VERDICT: APPROVE

<task_metadata>
session_id: ses_nested_scope_review
</task_metadata>`,
      metadata: {},
    }

    // when
    await atlasHook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)
    const pausedState = readBoulderState(testDirectory)
    await todoContinuation.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await new Promise((resolve) => setTimeout(resolve, 2200))

    // then
    expect(toolOutput.output).toContain("FINAL WAVE APPROVAL GATE")
    expect(pausedState?.pause?.reason).toBe("final_wave_approval")
    expect(promptAsyncCalls).toBe(0)

    await atlasHook.handler({
      event: {
        type: "message.updated",
        properties: { sessionID, info: { role: "user" } },
      },
    })
    expect(readBoulderState(testDirectory)?.pause).toBeUndefined()
  }, { timeout: 5000 })

  test("a later non-pausing subagent completion does not clear an active final-wave approval pause", async () => {
    // given - an active persisted pause from a prior final-wave approval gate
    const sessionID = "atlas-pause-clear-regression-session"
    setupMessageStorage(sessionID)
    // Plan still has implementation work pending, so a normal completion does not pause.
    writePlanState(sessionID, "pause-clear-regression-plan", `# Plan

## TODOs
- [ ] 1. Ship implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. **Plan Compliance Audit** - \`oracle\`
`)

    const { setBoulderPause } = await import("../../features/boulder-state")
    setBoulderPause(testDirectory, {
      reason: "final_wave_approval",
      sessionId: sessionID,
    })
    expect(readBoulderState(testDirectory)?.pause?.reason).toBe("final_wave_approval")

    const hook = createAtlasHook(createMockPluginInput(), {
      directory: testDirectory,
      isCallerOrchestrator: async () => true,
    })

    // when - a later non-pausing implementation-task completion arrives for the same orchestrator
    const implOutput = {
      title: "Implementation task done",
      output: `Implementation work shipped. Tests pass.

<task_metadata>
session_id: ses_pause_clear_impl_1
</task_metadata>`,
      metadata: {},
    }
    await hook["tool.execute.after"]({ tool: "task", sessionID }, implOutput)

    // then - pause is still set (reviewer fix: only an explicit user message clears it)
    const finalPause = readBoulderState(testDirectory)?.pause
    expect(finalPause?.reason).toBe("final_wave_approval")
    expect(finalPause?.session_id).toContain(sessionID)
  })
})
