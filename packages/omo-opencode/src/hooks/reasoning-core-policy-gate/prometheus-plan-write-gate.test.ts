import { afterEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _resetForTesting, setSessionAgent } from "../../features/claude-code-session-state/state"
import { createToolExecuteBeforeHandler } from "../../plugin/tool-execute-before"
import type { ReasoningCoreClient, ReasoningCoreSolveProblem } from "./reasoning-core-client"
import { evaluatePrometheusPlanWriteGate } from "./prometheus-plan-write-gate"
import type { CandidateAction } from "./types"
import { createReasoningCorePolicyGateHook } from "./hook"

const REASONING_CORE_BINARY = "/Users/unluckyg/Documents/reasoning-core/target/release/reasoning-core"

function restoreReasoningCoreBinaryPath(originalBinaryPath: string | undefined): void {
  if (originalBinaryPath === undefined) {
    delete process.env.REASONING_CORE_BINARY_PATH
    return
  }

  process.env.REASONING_CORE_BINARY_PATH = originalBinaryPath
}

function createMockClient(overrides?: Partial<ReasoningCoreClient>): ReasoningCoreClient {
  return {
    evaluate: mock(() => Promise.resolve({ allow: true })),
    solve: mock((problem: ReasoningCoreSolveProblem) => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 6, total_count: 6 },
      iterations_used: 1,
      reasoning_trace: [{ problem }],
    })),
    constrain: mock(() => Promise.resolve({ domains: {}, solved: false, solved_count: 0, total_count: 6 })),
    kbQuery: mock(() => Promise.resolve({ count: 0, entries: [] })),
    kbAdd: mock(() => Promise.resolve({ id: "kb_test_123" })),
    kbRemove: mock(() => Promise.resolve()),
    check: mock(() => Promise.resolve({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(() => Promise.resolve({ session_active: true, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
    ...overrides,
  }
}

function buildWriteCandidate(sessionID: string, filePath: string, content: string): CandidateAction {
  return {
    tool: "write",
    sessionID,
    agent: "prometheus",
    args: { filePath, content },
  }
}

describe("Prometheus plan write gate", () => {
  afterEach(() => {
    _resetForTesting()
  })

  it("allows Prometheus plan generation when all prerequisites are satisfied", async () => {
    const originalBinaryPath = process.env.REASONING_CORE_BINARY_PATH
    process.env.REASONING_CORE_BINARY_PATH = REASONING_CORE_BINARY
    setSessionAgent("session-plan-write-allow", "Prometheus (Plan Builder)")

    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-plan-write-allow-"))
    const draftPath = join(tempRoot, ".sisyphus/drafts/auth-plan.md")
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")

    mkdirSync(join(tempRoot, ".sisyphus/drafts"), { recursive: true })
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(
      draftPath,
      `# Draft: Auth Plan

## Requirements (confirmed)
- Add host-controlled plan clearance gate

## Technical Decisions
- Dependencies: reasoning-core client, Prometheus write/edit flow

## Research Findings
- src/agents/prometheus/plan-generation.ts drives the transition
- src/hooks/reasoning-core-policy-gate/hook.ts already gates Metis

## Open Questions
- none

## Scope Boundaries
- INCLUDE: pre-plan clearance before .sisyphus/plans writes
- EXCLUDE: changes to the existing Metis gate
`,
    )

    try {
      const reasoningCorePolicyGate = createReasoningCorePolicyGateHook({
        mode: "stdio",
        binaryPath: REASONING_CORE_BINARY,
        workspaceRoot: tempRoot,
      })

      const handler = createToolExecuteBeforeHandler({
        ctx: {} as never,
        hooks: { reasoningCorePolicyGate } as never,
      })

      const result = handler(
        { tool: "write", sessionID: "session-plan-write-allow", callID: "call-plan-write-allow" },
        {
          args: {
            filePath: planPath,
            content: `# Auth Plan

## Context

### Original Request
Add a second host-controlled clearance gate.

### Interview Summary
Research and scope are complete.

### Metis Review
- Gap addressed: no unresolved blockers remain
`,
          },
        },
      )

      await expect(result).resolves.toBeUndefined()
    } finally {
      restoreReasoningCoreBinaryPath(originalBinaryPath)
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("blocks Prometheus plan generation and lists missing prerequisites when interview context is incomplete", async () => {
    const originalBinaryPath = process.env.REASONING_CORE_BINARY_PATH
    process.env.REASONING_CORE_BINARY_PATH = REASONING_CORE_BINARY
    setSessionAgent("session-plan-write-deny", "Prometheus (Plan Builder)")

    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-plan-write-deny-"))
    const draftPath = join(tempRoot, ".sisyphus/drafts/auth-plan.md")
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")

    mkdirSync(join(tempRoot, ".sisyphus/drafts"), { recursive: true })
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(
      draftPath,
      `# Draft: Auth Plan

## Requirements (confirmed)
- Add a gate

## Technical Decisions
- none

## Research Findings
- none

## Open Questions
- Which dependencies are affected?

## Scope Boundaries
- INCLUDE: gate logic only
`,
    )

    try {
      const reasoningCorePolicyGate = createReasoningCorePolicyGateHook({
        mode: "stdio",
        binaryPath: REASONING_CORE_BINARY,
        workspaceRoot: tempRoot,
      })

      const handler = createToolExecuteBeforeHandler({
        ctx: {} as never,
        hooks: { reasoningCorePolicyGate } as never,
      })

      await expect(
        handler(
          { tool: "write", sessionID: "session-plan-write-deny", callID: "call-plan-write-deny" },
          {
            args: {
              filePath: planPath,
              content: `# Auth Plan

## Context

### Metis Review
- Placeholder only
`,
            },
          },
        ),
      ).rejects.toThrow(/missing prerequisites:/)
    } finally {
      restoreReasoningCoreBinaryPath(originalBinaryPath)
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("allows Prometheus plan generation when reasoning-core is unavailable", async () => {
    const originalBinaryPath = process.env.REASONING_CORE_BINARY_PATH
    process.env.REASONING_CORE_BINARY_PATH = "/nonexistent"
    setSessionAgent("session-plan-write-fallback", "Prometheus (Plan Builder)")

    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-plan-write-fallback-"))
    const draftPath = join(tempRoot, ".sisyphus/drafts/auth-plan.md")
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")

    mkdirSync(join(tempRoot, ".sisyphus/drafts"), { recursive: true })
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(
      draftPath,
      `# Draft: Auth Plan

## Requirements (confirmed)
- Add host-controlled plan clearance gate

## Technical Decisions
- Dependencies: reasoning-core client, Prometheus write/edit flow

## Research Findings
- src/agents/prometheus/plan-generation.ts drives the transition

## Open Questions
- none

## Scope Boundaries
- INCLUDE: pre-plan clearance before .sisyphus/plans writes
- EXCLUDE: changes to the existing Metis gate
`,
    )

    try {
      const reasoningCorePolicyGate = createReasoningCorePolicyGateHook({
        mode: "stdio",
        binaryPath: "/nonexistent",
        workspaceRoot: tempRoot,
      })

      const handler = createToolExecuteBeforeHandler({
        ctx: {} as never,
        hooks: { reasoningCorePolicyGate } as never,
      })

      const result = handler(
        { tool: "write", sessionID: "session-plan-write-fallback", callID: "call-plan-write-fallback" },
        {
          args: {
            filePath: planPath,
            content: `# Auth Plan

## Context

### Metis Review
- Gap addressed: no unresolved blockers remain
`,
          },
        },
      )

      await expect(result).resolves.toBeUndefined()
    } finally {
      restoreReasoningCoreBinaryPath(originalBinaryPath)
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("allows incremental edits on an existing plan with valid structure even when the draft is incomplete", async () => {
    const originalBinaryPath = process.env.REASONING_CORE_BINARY_PATH
    process.env.REASONING_CORE_BINARY_PATH = REASONING_CORE_BINARY
    setSessionAgent("session-plan-edit-allow", "Prometheus (Plan Builder)")

    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-plan-edit-allow-"))
    const draftPath = join(tempRoot, ".sisyphus/drafts/auth-plan.md")
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")

    mkdirSync(join(tempRoot, ".sisyphus/drafts"), { recursive: true })
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(
      draftPath,
      `# Draft: Auth Plan

## Requirements (confirmed)
- Add a gate

## Technical Decisions
- none

## Research Findings
- none

## Open Questions
- Which dependencies are affected?

## Scope Boundaries
- INCLUDE: gate logic only
`,
    )
    writeFileSync(
      planPath,
      `# Auth Plan

## Context

### Original Request
Add a second host-controlled clearance gate.

### Interview Summary
Research and scope are complete.

### Metis Review
- Gap addressed: no unresolved blockers remain

## Work Objectives

### Must NOT Have
- Do not change the existing Metis gate

## Execution Strategy

Wave 1
- Prepare the gate

## Final Verification Wave
`,
    )

    try {
      const reasoningCorePolicyGate = createReasoningCorePolicyGateHook({
        mode: "stdio",
        binaryPath: REASONING_CORE_BINARY,
        workspaceRoot: tempRoot,
      })

      const handler = createToolExecuteBeforeHandler({
        ctx: {} as never,
        hooks: { reasoningCorePolicyGate } as never,
      })

      const result = handler(
        { tool: "edit", sessionID: "session-plan-edit-allow", callID: "call-plan-edit-allow" },
        {
          args: {
            filePath: planPath,
            oldString: "## Final Verification Wave",
            newString: "- [ ] Refine the plan incrementally\n\n## Final Verification Wave",
          },
        },
      )

      await expect(result).resolves.toBeUndefined()
    } finally {
      restoreReasoningCoreBinaryPath(originalBinaryPath)
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("blocks destructive edits that remove the plan wave structure", async () => {
    const originalBinaryPath = process.env.REASONING_CORE_BINARY_PATH
    process.env.REASONING_CORE_BINARY_PATH = REASONING_CORE_BINARY
    setSessionAgent("session-plan-edit-deny", "Prometheus (Plan Builder)")

    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-plan-edit-deny-"))
    const draftPath = join(tempRoot, ".sisyphus/drafts/auth-plan.md")
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")

    mkdirSync(join(tempRoot, ".sisyphus/drafts"), { recursive: true })
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(
      draftPath,
      `# Draft: Auth Plan

## Requirements (confirmed)
- Add host-controlled plan clearance gate

## Technical Decisions
- Dependencies: reasoning-core client, Prometheus write/edit flow

## Research Findings
- src/agents/prometheus/plan-generation.ts drives the transition

## Open Questions
- none

## Scope Boundaries
- INCLUDE: pre-plan clearance before .sisyphus/plans writes
- EXCLUDE: changes to the existing Metis gate
`,
    )
    writeFileSync(
      planPath,
      `# Auth Plan

## Context

### Original Request
Add a second host-controlled clearance gate.

### Interview Summary
Research and scope are complete.

### Metis Review
- Gap addressed: no unresolved blockers remain

## Work Objectives

### Must NOT Have
- Do not change the existing Metis gate

## Execution Strategy

Wave 1
- Prepare the gate

## Final Verification Wave
`,
    )

    try {
      const reasoningCorePolicyGate = createReasoningCorePolicyGateHook({
        mode: "stdio",
        binaryPath: REASONING_CORE_BINARY,
        workspaceRoot: tempRoot,
      })

      const handler = createToolExecuteBeforeHandler({
        ctx: {} as never,
        hooks: { reasoningCorePolicyGate } as never,
      })

      await expect(
        handler(
          { tool: "edit", sessionID: "session-plan-edit-deny", callID: "call-plan-edit-deny" },
          {
            args: {
              filePath: planPath,
              oldString: "Wave 1\n- Prepare the gate",
              newString: "No execution waves remain",
            },
          },
        ),
      ).rejects.toThrow(/structure|wave/i)
    } finally {
      restoreReasoningCoreBinaryPath(originalBinaryPath)
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("adds KB-derived prerequisite observations as defeasible support rules", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-plan-kb-enrichment-"))
    const draftPath = join(tempRoot, ".sisyphus/drafts/auth-plan.md")
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")

    mkdirSync(join(tempRoot, ".sisyphus/drafts"), { recursive: true })
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(
      draftPath,
      `# Draft: Auth Plan

## Requirements (confirmed)
- Add host-controlled plan clearance gate

## Technical Decisions
- Dependencies: reasoning-core client, Prometheus write/edit flow

## Research Findings
- src/agents/prometheus/plan-generation.ts drives the transition

## Open Questions
- none

## Scope Boundaries
- INCLUDE: pre-plan clearance before .sisyphus/plans writes
- EXCLUDE: changes to the existing Metis gate
`,
    )

    const solveMock = mock((problem: ReasoningCoreSolveProblem) => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 6, total_count: 6 },
      iterations_used: 1,
      reasoning_trace: [{ problem }],
    }))
    const client = createMockClient({
      solve: solveMock,
      kbQuery: mock(() => Promise.resolve({
        count: 1,
        entries: [{ tags: ["planning", "prereq:acceptance_criteria_defined"] }],
      })),
    })

    try {
      await evaluatePrometheusPlanWriteGate({
        client,
        candidate: buildWriteCandidate("session-kb-enriched", planPath, "# Auth Plan\n\n### Metis Review\n- Gap addressed: no unresolved blockers remain\n"),
        callID: "call-kb-enriched",
        workspaceRoot: tempRoot,
        toolHistory: [],
        mutationKind: "write",
      })

      const solveInput = solveMock.mock.calls[0]?.[0]
      expect(solveInput.theory.defeasible_rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "kb-support-acceptance_criteria_defined" }),
        ]),
      )
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("treats unsupported codebase exploration claims as defeasible rather than strict", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-plan-evidence-"))
    const draftPath = join(tempRoot, ".sisyphus/drafts/auth-plan.md")
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")

    mkdirSync(join(tempRoot, ".sisyphus/drafts"), { recursive: true })
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(
      draftPath,
      `# Draft: Auth Plan

## Requirements (confirmed)
- Add host-controlled plan clearance gate

## Technical Decisions
- Dependencies: reasoning-core client, Prometheus write/edit flow

## Research Findings
- src/agents/prometheus/plan-generation.ts drives the transition

## Open Questions
- none

## Scope Boundaries
- INCLUDE: pre-plan clearance before .sisyphus/plans writes
- EXCLUDE: changes to the existing Metis gate
`,
    )

    const solveMock = mock((problem: ReasoningCoreSolveProblem) => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 6, total_count: 6 },
      iterations_used: 1,
      reasoning_trace: [{ problem }],
    }))
    const client = createMockClient({ solve: solveMock })

    try {
      const verdict = await evaluatePrometheusPlanWriteGate({
        client,
        candidate: buildWriteCandidate("session-evidence", planPath, "# Auth Plan\n\n### Metis Review\n- Gap addressed: no unresolved blockers remain\n"),
        callID: "call-evidence",
        workspaceRoot: tempRoot,
        toolHistory: [],
        mutationKind: "write",
      })

      expect(verdict.allow).toBe(true)
      const solveInput = solveMock.mock.calls[0]?.[0]
      expect(solveInput.theory.premises).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ formula: "codebase_explored(current)" }),
        ]),
      )
      expect(solveInput.theory.defeasible_rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "claim-support-codebase_explored" }),
        ]),
      )
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  describe("infrastructure_fail_mode behavior", () => {
    function buildPlanCandidate(filePath: string): CandidateAction {
      return {
        tool: "write",
        sessionID: "fail-mode-session",
        agent: "prometheus",
        args: { filePath, content: "# Test plan" },
      }
    }

    it("when reasoning-core call fails and fail_mode is open (default) #then returns allow=true with fallbackAllow proofArtifact", async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "plan-write-fail-open-"))
      const planPath = join(tempRoot, ".sisyphus/plans/test.md")
      mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
      writeFileSync(planPath, "")

      try {
        const client = createMockClient({
          kbQuery: mock(() => Promise.reject(new Error("reasoning-core call failed: connection timed out"))),
        })

        const verdict = await evaluatePrometheusPlanWriteGate({
          client,
          candidate: buildPlanCandidate(planPath),
          callID: "call-fail-open",
          workspaceRoot: tempRoot,
          toolHistory: [],
          mutationKind: "write",
        })

        expect(verdict.allow).toBe(true)
        expect(verdict.proofArtifact).toMatchObject({ fallbackAllow: true })
      } finally {
        rmSync(tempRoot, { recursive: true, force: true })
      }
    })

    it("when reasoning-core call fails and fail_mode is closed #then returns allow=false with structured rationale", async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "plan-write-fail-closed-"))
      const planPath = join(tempRoot, ".sisyphus/plans/test.md")
      mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
      writeFileSync(planPath, "")

      try {
        const client = createMockClient({
          kbQuery: mock(() => Promise.reject(new Error("reasoning-core call failed: connection timed out"))),
        })

        const verdict = await evaluatePrometheusPlanWriteGate({
          client,
          candidate: buildPlanCandidate(planPath),
          callID: "call-fail-closed",
          workspaceRoot: tempRoot,
          toolHistory: [],
          mutationKind: "write",
          infrastructureFailMode: "closed",
        })

        expect(verdict.allow).toBe(false)
        expect((verdict.reason ?? "").includes("fail-closed")).toBe(true)
        expect((verdict.reason ?? "").includes("call failed")).toBe(true)
        expect(verdict.proofArtifact).toMatchObject({ fallbackAllow: false, failMode: "closed" })
      } finally {
        rmSync(tempRoot, { recursive: true, force: true })
      }
    })

    it("when reasoning-core fails with non-infrastructure error and fail_mode is closed #then still rejects normally", async () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "plan-write-non-infra-"))
      const planPath = join(tempRoot, ".sisyphus/plans/test.md")
      mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
      writeFileSync(planPath, "")

      try {
        const client = createMockClient({
          kbQuery: mock(() => Promise.reject(new Error("validation error: malformed query"))),
        })

        const verdict = await evaluatePrometheusPlanWriteGate({
          client,
          candidate: buildPlanCandidate(planPath),
          callID: "call-non-infra",
          workspaceRoot: tempRoot,
          toolHistory: [],
          mutationKind: "write",
          infrastructureFailMode: "closed",
        })

        expect(verdict.allow).toBe(false)
        expect((verdict.reason ?? "").includes("validation error")).toBe(true)
        expect((verdict.reason ?? "").includes("fail-closed")).toBe(false)
      } finally {
        rmSync(tempRoot, { recursive: true, force: true })
      }
    })
  })
})
