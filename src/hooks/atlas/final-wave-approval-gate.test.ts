import { afterEach, beforeEach, describe, expect, mock, test, afterAll } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import type { BoulderState } from "../../features/boulder-state"
import { clearBoulderState, writeBoulderState } from "../../features/boulder-state"

const TEST_STORAGE_ROOT = join(tmpdir(), `atlas-final-wave-storage-${randomUUID()}`)
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
type PromptMock = ReturnType<typeof mock>

describe("Atlas final verification approval gate", () => {
  let testDirectory = ""

  function createMockPluginInput(): AtlasHookContext & { _promptMock: PromptMock } {
    const client = createOpencodeClient({ baseUrl: "http://localhost" })
    const promptMock = mock((input: unknown) => input)

    Reflect.set(client.session, "prompt", async (input: unknown) => {
      promptMock(input)
      return {
        data: { info: {} as AssistantMessage, parts: [] },
        request: new Request("http://localhost/session/prompt"),
        response: new Response(),
      }
    })

    Reflect.set(client.session, "promptAsync", async (input: unknown) => {
      promptMock(input)
      return {
        data: undefined,
        request: new Request("http://localhost/session/prompt_async"),
        response: new Response(),
      }
    })

    Reflect.set(client.session, "get", async ({ path }: { path: { id: string } }) => {
      const parentID = path.id === "ses_final_wave_review"
        ? "atlas-final-wave-session"
        : path.id === "ses_feature_task"
          ? "atlas-non-final-session"
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
      serverUrl: new URL("http://localhost"),
      $: {} as AtlasHookContext["$"],
      client,
      _promptMock: promptMock,
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
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      }),
    )
  }

  function cleanupMessageStorage(sessionID: string): void {
    const messageDirectory = join(MESSAGE_STORAGE, sessionID)
    if (existsSync(messageDirectory)) {
      rmSync(messageDirectory, { recursive: true, force: true })
    }
  }

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-final-wave-test-${randomUUID()}`)
    mkdirSync(join(testDirectory, ".sisyphus"), { recursive: true })
    clearBoulderState(testDirectory)
  })

  afterEach(() => {
    clearBoulderState(testDirectory)
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  test("waits for explicit user approval after the last final-wave approval arrives", async () => {
    // given
    const sessionID = "atlas-final-wave-session"
    setupMessageStorage(sessionID)

    const planPath = join(testDirectory, "final-wave-plan.md")
    writeFileSync(
      planPath,
      `# Plan

## TODOs
- [x] 1. Ship the implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [x] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    )

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "final-wave-plan",
      agent: "atlas",
    }
    writeBoulderState(testDirectory, state)

    const mockInput = createMockPluginInput()
    const hook = createAtlasHook(mockInput)
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Tasks [4/4 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN] | VERDICT: APPROVE

<task_metadata>
session_id: ses_final_wave_review
</task_metadata>`,
      metadata: {},
    }

    // when
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then
    expect(toolOutput.output).toContain("FINAL WAVE APPROVAL GATE")
    expect(toolOutput.output).toContain("explicit user approval")
    expect(toolOutput.output).not.toContain("STEP 8: PROCEED TO NEXT TASK")
    expect(mockInput._promptMock).not.toHaveBeenCalled()

    cleanupMessageStorage(sessionID)
  })

  test("keeps normal auto-continue instructions for non-final tasks", async () => {
    // given
    const sessionID = "atlas-non-final-session"
    setupMessageStorage(sessionID)

    const planPath = join(testDirectory, "implementation-plan.md")
    writeFileSync(
      planPath,
      `# Plan

## TODOs
- [x] 1. Setup
- [ ] 2. Implement feature

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. **Plan Compliance Audit** - \`oracle\`
- [ ] F2. **Code Quality Review** - \`unspecified-high\`
- [ ] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    )

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "implementation-plan",
      agent: "atlas",
    }
    writeBoulderState(testDirectory, state)

    const hook = createAtlasHook(createMockPluginInput())
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Implementation finished successfully

<task_metadata>
session_id: ses_feature_task
</task_metadata>`,
      metadata: {},
    }

    // when
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)

    // then
    expect(toolOutput.output).toContain("COMPLETION GATE")
    expect(toolOutput.output).toContain("STEP 8: PROCEED TO NEXT TASK")
    expect(toolOutput.output).not.toContain("FINAL WAVE APPROVAL GATE")

    cleanupMessageStorage(sessionID)
  })
})
