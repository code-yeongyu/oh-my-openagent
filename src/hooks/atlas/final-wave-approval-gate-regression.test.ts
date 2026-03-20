import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import type { BoulderState } from "../../features/boulder-state"
import { clearBoulderState, writeBoulderState } from "../../features/boulder-state"

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

const { createAtlasHook } = await import("./index")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

type AtlasHookContext = Parameters<typeof createAtlasHook>[0]

describe("Atlas final-wave approval gate regressions", () => {
  let testDirectory = ""

  function createMockPluginInput(): AtlasHookContext {
    const client = createOpencodeClient({ baseUrl: "http://localhost" })

    Reflect.set(client.session, "prompt", async () => ({
      data: { info: {} as AssistantMessage, parts: [] },
      request: new Request("http://localhost/session/prompt"),
      response: new Response(),
    }))

    Reflect.set(client.session, "promptAsync", async () => ({
      data: undefined,
      request: new Request("http://localhost/session/prompt_async"),
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
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
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
    mkdirSync(join(testDirectory, ".sisyphus"), { recursive: true })
    clearBoulderState(testDirectory)
  })

  afterEach(() => {
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

    const hook = createAtlasHook(createMockPluginInput())
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

    const hook = createAtlasHook(createMockPluginInput())
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
})
