import { describe, expect, test } from "bun:test"
import { getPlanProgress, readBoulderState } from "../../features/boulder-state"
import { classifyFinalWaveVerdict } from "./final-wave-approval-gate"
import {
  createFinalWaveAfterHandlerHarness,
  createFinalWaveMockPluginInput,
  registerFinalWaveTestEnvironment,
  writeFinalWavePlanState,
} from "./final-wave-approval-gate.test-support"
import { createAtlasHook } from "./index"
import { createToolExecuteAfterHandler } from "./tool-execute-after"

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
  const env = registerFinalWaveTestEnvironment({ resetAgentRegistration: true })

  const resolveParentSessionID = (taskSessionID: string): string => {
    if (taskSessionID === "ses_final_wave_review") return "atlas-final-wave-session"
    if (taskSessionID === "ses_feature_task") return "atlas-non-final-session"
    return "main-session-123"
  }

  function createMockPluginInput() {
    return createFinalWaveMockPluginInput({ directory: env.directory, resolveParentSessionID })
  }

  test("waits for explicit user approval after the last final-wave approval arrives", async () => {
    // given
    const sessionID = "atlas-final-wave-session"

    writeFinalWavePlanState({
      directory: env.directory,
      sessionID,
      planName: "final-wave-plan",
      planContent: `# Plan

## TODOs
- [x] 1. Ship the implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [x] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    })

    const mockInput = createMockPluginInput()
    const hook = createAtlasHook(mockInput, {
      directory: env.directory,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Tasks [4/4 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN] | VERDICT: APPROVE

<task_metadata>
session_id: ses_final_wave_review
</task_metadata>`,
      metadata: {},
    }

    // when - the final result enters the pause state, then the real idle path runs
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)
    expect(toolOutput.output).toContain("ses_final_wave_review")
    mockInput._promptMock.mockClear()
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then - idle observes the shared pause state and does not inject a continuation
    expect(mockInput._promptMock).not.toHaveBeenCalled()
  })

  test("does not dispatch completed-plan continuation when the plan reads complete while waiting for final-wave approval", async () => {
    // given
    const sessionID = "atlas-final-wave-session"

    writeFinalWavePlanState({
      directory: env.directory,
      sessionID,
      planName: "final-wave-complete-race-plan",
      planContent: `# Plan

## TODOs
- [x] 1. Ship the implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [x] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    })

    const mockInput = createMockPluginInput()
    const hook = createAtlasHook(mockInput, {
      directory: env.directory,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Tasks [4/4 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN] | VERDICT: APPROVE

<task_metadata>
session_id: ses_final_wave_review
</task_metadata>`,
      metadata: {},
    }

    // when - the last final-wave reviewer approves and parks the session in the approval wait
    const outputLengthBeforeApproval = toolOutput.output.length
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)
    expect(toolOutput.output.length).toBeGreaterThan(outputLengthBeforeApproval)

    // and the reviewer's F4 checkbox update lands after the pause, so the plan now reads complete
    const planPath = writeFinalWavePlanState({
      directory: env.directory,
      sessionID,
      planName: "final-wave-complete-race-plan",
      planContent: `# Plan

## TODOs
- [x] 1. Ship the implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [x] F3. **Real Manual QA** - \`unspecified-high\`
- [x] F4. **Scope Fidelity Check** - \`deep\`
`,
    })
    expect(getPlanProgress(planPath).isComplete).toBe(true)

    mockInput._promptMock.mockClear()
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then - the approval gate wins over the completed-plan branch: no completion nudge and no boulder completion
    expect(mockInput._promptMock).not.toHaveBeenCalled()
    expect(readBoulderState(env.directory)?.status).not.toBe("completed")
  })

  test("pauses for escalation when a final-wave reviewer rejects", async () => {
    // given
    const sessionID = "atlas-final-wave-session"

    writeFinalWavePlanState({
      directory: env.directory,
      sessionID,
      planName: "final-wave-reject-plan",
      planContent: `# Plan

## TODOs
- [x] 1. Ship the implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [ ] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    })

    const handler = createFinalWaveAfterHandlerHarness({
      sessionID,
      ctx: createMockPluginInput(),
      createHandler: createToolExecuteAfterHandler,
    })
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
    await handler.run(toolOutput)

    // then - output is wrapped and the boulder enters the pause state
    expect(toolOutput.output).toContain("<system-reminder>")
    expect(handler.sessionState.waitingForFinalWaveApproval).toBe(true)
  })

  test("keeps normal auto-continue instructions for non-final tasks", async () => {
    // given
    const sessionID = "atlas-non-final-session"

    writeFinalWavePlanState({
      directory: env.directory,
      sessionID,
      planName: "implementation-plan",
      planContent: `# Plan

## TODOs
- [x] 1. Setup
- [ ] 2. Implement feature

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. **Plan Compliance Audit** - \`oracle\`
- [ ] F2. **Code Quality Review** - \`unspecified-high\`
- [ ] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    })

    const mockInput = createMockPluginInput()
    const hook = createAtlasHook(mockInput, {
      directory: env.directory,
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
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then - non-final task output is wrapped and the boulder auto-continues
    expect(toolOutput.output).toContain("<system-reminder>")
    expect(mockInput._promptMock).toHaveBeenCalled()
  })
})
