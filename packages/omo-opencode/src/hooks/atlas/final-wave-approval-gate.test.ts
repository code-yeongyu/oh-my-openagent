import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import type { BoulderState } from "../../features/boulder-state"
import { clearBoulderState, writeBoulderState } from "../../features/boulder-state"
import { classifyFinalWaveVerdict } from "./final-wave-approval-gate"
import { createAtlasHook } from "./index"

type AtlasHookContext = Parameters<typeof createAtlasHook>[0]
type PromptMock = ReturnType<typeof mock>

describe("classifyFinalWaveVerdict", () => {
  test("returns approve when the output carries an APPROVE verdict", () => {
    // given
    const output = "Tasks [4/4 compliant] | VERDICT: APPROVE"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("approve")
  })

  test("returns reject when the output carries a REJECT verdict", () => {
    // given
    const output = "Tasks [2/4 compliant] | VERDICT: REJECT"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("reject")
  })

  test("returns missing when the output has no verdict token", () => {
    // given
    const output = "Implementation finished successfully with all checks green"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })

  test("returns missing when the output ends on a bash call with no verdict", () => {
    // given
    const output = `Ran the test suite

\`\`\`bash
bun test packages/omo-opencode/src/hooks/atlas/final-wave-approval-gate.test.ts
\`\`\``

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })

  test("matches the approve verdict case-insensitively", () => {
    // given
    const output = "summary line\nverdict: approve"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("approve")
  })

  test("matches the reject verdict case-insensitively", () => {
    // given
    const output = "summary line\nVeRdIcT: ReJeCt"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("reject")
  })

  test("returns missing when approve and reject tokens both appear", () => {
    // given
    const output = "VERDICT: REJECT then revised to VERDICT: APPROVE"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })

  test("returns missing when the output only repeats the verdict instruction", () => {
    // given
    const output = "Please emit VERDICT: APPROVE or VERDICT: REJECT before finishing."

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })
})

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

    Reflect.set(client.tui, "showToast", async () => ({
      data: undefined,
      request: new Request("http://localhost/tui/show-toast"),
      response: new Response(),
    }))

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

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-final-wave-test-${randomUUID()}`)
    mkdirSync(join(testDirectory, ".omo"), { recursive: true })
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
    const hook = createAtlasHook(mockInput, { directory: testDirectory, isCallerOrchestrator: async () => true })
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

  })

  test("pauses for escalation when a final-wave reviewer rejects", async () => {
    // given
    const sessionID = "atlas-final-wave-session"

    const planPath = join(testDirectory, "final-wave-reject-plan.md")
    writeFileSync(
      planPath,
      `# Plan

## TODOs
- [x] 1. Ship the implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [ ] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    )

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "final-wave-reject-plan",
      agent: "atlas",
    }
    writeBoulderState(testDirectory, state)

    const mockInput = createMockPluginInput()
    const hook = createAtlasHook(mockInput, { directory: testDirectory, isCallerOrchestrator: async () => true })
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Manual QA could not verify the shipped behavior.

Tasks [3/4 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN] | VERDICT: REJECT

<task_metadata>
session_id: ses_final_wave_review
</task_metadata>`,
      metadata: {},
    }

    // when
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then
    expect(toolOutput.output).toContain("FINAL REVIEW REJECTED")
    expect(toolOutput.output).toContain("Boulder paused")
    expect(toolOutput.output).toContain("VERDICT: REJECT")
    expect(toolOutput.output).not.toContain("COMPLETION GATE")
    expect(toolOutput.output).not.toContain("STEP 8")
    expect(mockInput._promptMock).not.toHaveBeenCalled()
  })

  test("keeps normal auto-continue instructions for non-final tasks", async () => {
    // given
    const sessionID = "atlas-non-final-session"

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

    const hook = createAtlasHook(createMockPluginInput(), {
      directory: testDirectory,
      isCallerOrchestrator: async () => true,
    })
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

  })
})
