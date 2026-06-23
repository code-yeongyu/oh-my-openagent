import { describe, expect, it, mock } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReasoningCoreClient, ReasoningCoreSolveProblem } from "./reasoning-core-client"
import { evaluatePrometheusMomusGate, isPrometheusMomusGateCandidate } from "./prometheus-momus-gate"
import { writeAllowedMomusPattern } from "./prometheus-momus-kb-writer"
import type { CandidateAction } from "./types"

function createMockClient(overrides?: Partial<ReasoningCoreClient>): ReasoningCoreClient {
  return {
    evaluate: mock(() => Promise.resolve({ allow: true })),
    solve: mock((problem: ReasoningCoreSolveProblem) => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 4, total_count: 4 },
      iterations_used: 1,
      reasoning_trace: [{ problem }],
    })),
    constrain: mock(() => Promise.resolve({ domains: {}, solved: false, solved_count: 0, total_count: 4 })),
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

function createMomusCandidate(sessionID: string, prompt: string): CandidateAction {
  return {
    tool: "task",
    sessionID,
    agent: "prometheus",
    args: {
      prompt,
      load_skills: [],
      subagent_type: "momus",
      run_in_background: false,
    },
    context: { subagentType: "momus" },
  }
}

describe("Prometheus Momus gate", () => {
  it("detects Prometheus to Momus review delegations", () => {
    expect(isPrometheusMomusGateCandidate(createMomusCandidate("session-momus", ".sisyphus/plans/auth-plan.md"))).toBe(true)
    expect(isPrometheusMomusGateCandidate({
      ...createMomusCandidate("session-not-momus", ".sisyphus/plans/auth-plan.md"),
      context: { subagentType: "metis" },
    })).toBe(false)
  })

  it("allows Momus review delegation when a valid plan path and reviewable plan content are present", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-momus-allow-"))
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(
      planPath,
      `# Auth Plan

## Work Objectives

### Must NOT Have
- Do not change the existing Metis gate

## Execution Strategy

Wave 1
- Prepare the gate

## Final Verification Wave
- Tool: bun test
- Steps: run the targeted suite
- Expected: all tests pass
`,
    )

    const client = createMockClient()

    try {
      const verdict = await evaluatePrometheusMomusGate({
        client,
        candidate: createMomusCandidate("session-momus-allow", ".sisyphus/plans/auth-plan.md"),
        callID: "call-momus-allow",
        workspaceRoot: tempRoot,
        toolHistory: [
          {
            tool: "write",
            sessionID: "session-momus-allow",
            agent: "prometheus",
            args: { filePath: planPath, content: "# Auth Plan" },
          },
        ],
      })

      expect(verdict.allow).toBe(true)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("blocks Momus review delegation when no plan file is referenced", async () => {
    const client = createMockClient()

    const verdict = await evaluatePrometheusMomusGate({
      client,
      candidate: createMomusCandidate("session-momus-deny", "Please review this plan sometime"),
      callID: "call-momus-deny",
      workspaceRoot: process.cwd(),
      toolHistory: [],
    })

    expect(verdict.allow).toBe(false)
    expect(verdict.reason).toMatch(/plan file|review scope/i)
  })

  it("adds KB-derived review observations as defeasible support rules", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-momus-kb-"))
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(planPath, "# Auth Plan\n\n## Execution Strategy\n\nWave 1\n- Prepare the gate\n")

    const solveMock = mock((problem: ReasoningCoreSolveProblem) => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 4, total_count: 4 },
      iterations_used: 1,
      reasoning_trace: [{ problem }],
    }))

    const client = createMockClient({
      solve: solveMock,
      kbQuery: mock(() => Promise.resolve({ count: 1, entries: [{ tags: ["planning", "review", "review_prereq:qa_ready"] }] })),
    })

    try {
      await evaluatePrometheusMomusGate({
        client,
        candidate: createMomusCandidate("session-momus-kb", ".sisyphus/plans/auth-plan.md"),
        callID: "call-momus-kb",
        workspaceRoot: tempRoot,
        toolHistory: [{ tool: "write", sessionID: "session-momus-kb", agent: "prometheus", args: { filePath: planPath, content: "# Auth Plan" } }],
      })

      const solveInput = solveMock.mock.calls[0]?.[0]
      expect(client.kbQuery).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ["planning", "review"] }),
      )
      expect(solveInput.theory.defeasible_rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "kb-support-qa_ready" }),
        ]),
      )
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("treats unsupported plan_generation_completed as defeasible rather than strict", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "prometheus-momus-evidence-"))
    const planPath = join(tempRoot, ".sisyphus/plans/auth-plan.md")
    mkdirSync(join(tempRoot, ".sisyphus/plans"), { recursive: true })
    writeFileSync(planPath, "# Auth Plan\n\n## Execution Strategy\n\nWave 1\n- Prepare the gate\n")

    const solveMock = mock((problem: ReasoningCoreSolveProblem) => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 4, total_count: 4 },
      iterations_used: 1,
      reasoning_trace: [{ problem }],
    }))
    const client = createMockClient({ solve: solveMock })

    try {
      const verdict = await evaluatePrometheusMomusGate({
        client,
        candidate: createMomusCandidate("session-momus-evidence", ".sisyphus/plans/auth-plan.md"),
        callID: "call-momus-evidence",
        workspaceRoot: tempRoot,
        toolHistory: [],
      })

      expect(verdict.allow).toBe(true)
      const solveInput = solveMock.mock.calls[0]?.[0]
      expect(solveInput.theory.premises).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ formula: "plan_generation_completed(current)" }),
        ]),
      )
      expect(solveInput.theory.defeasible_rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "claim-support-plan_generation_completed" }),
        ]),
      )
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("writes a Momus review pattern to the KB Learned layer after a valid allow verdict", async () => {
    const kbAddMock = mock(() => Promise.resolve({ id: "kb_momus_1" }))
    const client = createMockClient({ kbAdd: kbAddMock })

    await writeAllowedMomusPattern({
      client,
      sessionID: "session-momus-write",
      verdict: {
        allow: true,
        proofArtifact: {
          review: {
            planPath: "/tmp/.sisyphus/plans/auth-plan.md",
            planContent: "# Auth Plan\n\n## Execution Strategy\n\nWave 1\n- Prepare the gate\n",
          },
          kbResult: { count: 2, entries: [] },
          evidence: { verified: [], unverified: ["plan_generation_completed"] },
          outcome: { stop_signal: "Solved" },
        },
      },
    })

    expect(kbAddMock).toHaveBeenCalledTimes(1)
    const entry = kbAddMock.mock.calls[0]?.[0]
    expect(entry.layer).toBe("Learned")
    expect(entry.tags).toContain("prometheus-momus-review")
    expect(entry.tags).toContain("planning")
    expect(entry.tags).toContain("review")
    expect(entry.tags).toContain("momus")
    expect(entry.tags).toContain("review_prereq:plan_generation_completed")
    expect(entry.content.Insight.problem_type).toBe("prometheus_momus_review")
  })

  it("does not propagate KB write failures for Momus review patterns", async () => {
    const kbAddMock = mock(() => Promise.reject(new Error("kb down")))
    const client = createMockClient({ kbAdd: kbAddMock })

    await expect(
      writeAllowedMomusPattern({
        client,
        sessionID: "session-momus-write-fail",
        verdict: {
          allow: true,
          proofArtifact: {
            review: {
              planPath: "/tmp/.sisyphus/plans/auth-plan.md",
              planContent: "# Auth Plan\n\n## Execution Strategy\n\nWave 1\n- Prepare the gate\n",
            },
            kbResult: { count: 0, entries: [] },
            evidence: { verified: ["plan_generation_completed"], unverified: [] },
            outcome: { stop_signal: "Solved" },
          },
        },
      }),
    ).resolves.toBeUndefined()

    expect(kbAddMock).toHaveBeenCalledTimes(1)
  })

  it("removes an exact duplicate Momus review pattern before writing a new one", async () => {
    const kbRemoveMock = mock(() => Promise.resolve())
    const kbAddMock = mock(() => Promise.resolve({ id: "kb_momus_new" }))
    const client = createMockClient({
      kbQuery: mock(() => Promise.resolve({
        count: 1,
        entries: [{
          id: "kb_momus_old",
          tags: ["prometheus-momus-review", "planning", "review", "momus", "review_prereq:plan_file_referenced", "review_prereq:plan_content_present", "review_prereq:review_scope_clear", "review_prereq:plan_generation_completed"],
          content: {
            Insight: {
              problem_type: "prometheus_momus_review",
              lesson: "Momus review delegation passed plan reference, content, scope, and generation checks with stop_signal=Solved and 2 prior review patterns consulted.",
              example: 'momus review: plan="/tmp/.sisyphus/plans/auth-plan.md", verified=[], unverified=[plan_generation_completed]',
            },
          },
        }],
      })),
      kbRemove: kbRemoveMock,
      kbAdd: kbAddMock,
    })

    await writeAllowedMomusPattern({
      client,
      sessionID: "session-momus-replace",
      verdict: {
        allow: true,
        proofArtifact: {
          review: {
            planPath: "/tmp/.sisyphus/plans/auth-plan.md",
            planContent: "# Auth Plan\n\n## Execution Strategy\n\nWave 1\n- Prepare the gate\n",
          },
          kbResult: { count: 2, entries: [] },
          evidence: { verified: [], unverified: ["plan_generation_completed"] },
          outcome: { stop_signal: "Solved" },
        },
      },
    })

    expect(kbRemoveMock).toHaveBeenCalledWith({ id: "kb_momus_old" })
    expect(kbAddMock).toHaveBeenCalledTimes(1)
  })

})
