import { afterAll, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createFinalWaveAfterHandlerHarness,
  createFinalWaveMockPluginInput,
  registerFinalWaveTestEnvironment,
  writeFinalWavePlanState,
} from "./final-wave-approval-gate.test-support"

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

const { createToolExecuteAfterHandler } = await import("./tool-execute-after")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

describe("Atlas final-wave approval gate regressions", () => {
  const env = registerFinalWaveTestEnvironment()

  const resolveParentSessionID = (taskSessionID: string): string => {
    if (taskSessionID === "ses_nested_scope_review") return "atlas-nested-final-wave-session"
    if (taskSessionID.startsWith("ses_parallel_review_")) return "atlas-parallel-final-wave-session"
    return "main-session-123"
  }

  function createHandler(sessionID: string) {
    return createFinalWaveAfterHandlerHarness({
      sessionID,
      ctx: createFinalWaveMockPluginInput({ directory: env.directory, resolveParentSessionID }),
      createHandler: createToolExecuteAfterHandler,
    })
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

  test("waits for approval when nested plan checkboxes remain but the only pending top-level task is final-wave", async () => {
    // given
    const sessionID = "atlas-nested-final-wave-session"
    setupMessageStorage(sessionID)
    writeFinalWavePlanState({
      directory: env.directory,
      sessionID,
      planName: "nested-final-wave-plan",
      planContent: `# Plan

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
`,
    })

    const handler = createHandler(sessionID)
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Tasks [1/1 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN] | VERDICT: APPROVE

<task_metadata>
session_id: ses_nested_scope_review
</task_metadata>`,
      metadata: {},
    }

    // when
    await handler.run(toolOutput)

    // then - nested non-top-level checkboxes do not block the approval wait state
    expect(handler.sessionState.waitingForFinalWaveApproval).toBe(true)
  })

  test("waits for approval after the final parallel reviewer approves before plan checkboxes are updated", async () => {
    // given
    const sessionID = "atlas-parallel-final-wave-session"
    setupMessageStorage(sessionID)
    writeFinalWavePlanState({
      directory: env.directory,
      sessionID,
      planName: "parallel-final-wave-plan",
      planContent: `# Plan

## TODOs
- [x] 1. Ship implementation
- [x] 2. Verify implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. **Plan Compliance Audit** - \`oracle\`
- [ ] F2. **Code Quality Review** - \`unspecified-high\`
- [ ] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    })

    const handler = createHandler(sessionID)
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

    // when - three of the four final-wave reviewers approve
    for (const toolOutput of firstThreeOutputs) {
      await handler.run(toolOutput)
    }

    // then - not every reviewer has approved yet, so the session has not paused
    expect(handler.sessionState.waitingForFinalWaveApproval).toBe(false)

    // when - the last reviewer approves
    await handler.run(lastOutput)

    // then - the session flips into the approval-wait state
    expect(handler.sessionState.waitingForFinalWaveApproval).toBe(true)
  })
})
