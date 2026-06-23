import { describe, expect, it, mock } from "bun:test"
import type { ReasoningCoreClient, ReasoningCoreSolveProblem } from "./reasoning-core-client"
import { evaluatePrometheusPlanningGate } from "./prometheus-metis-gate"
import { writeAllowedConsultationPattern } from "./prometheus-metis-kb-writer"
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

function createMetisCandidate(sessionID: string, prompt: string): CandidateAction {
  return {
    tool: "task",
    sessionID,
    agent: "prometheus",
    args: {
      description: "Consult Metis",
      prompt,
      load_skills: [],
      subagent_type: "metis",
      run_in_background: false,
    },
    context: { subagentType: "metis" },
  }
}

describe("Prometheus Metis gate", () => {
  it("adds KB-derived consultation observations as defeasible support rules", async () => {
    const solveMock = mock((problem: ReasoningCoreSolveProblem) => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 4, total_count: 4 },
      iterations_used: 1,
      reasoning_trace: [{ problem }],
    }))
    const client = createMockClient({
      solve: solveMock,
      kbQuery: mock(() => Promise.resolve({
        count: 1,
        entries: [{ tags: ["planning", "metis", "prereq:test_strategy_defined"] }],
      })),
    })

    await evaluatePrometheusPlanningGate({
      client,
      candidate: createMetisCandidate(
        "session-metis-kb",
        `Review this planning session:\n**Goal**: Build the feature\n**Discussed**: We scoped the work\n**My Understanding**: Implement the next slice\n**Research**: Found existing constraints and tests.`,
      ),
      callID: "call-metis-kb",
      toolHistory: [],
    })

    const solveInput = solveMock.mock.calls[0]?.[0]
    expect(client.kbQuery).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["planning", "metis"] }),
    )
    expect(solveInput.theory.defeasible_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "kb-support-test_strategy_defined" }),
      ]),
    )
  })

  it("treats unsupported research claims as defeasible rather than strict", async () => {
    const solveMock = mock((problem: ReasoningCoreSolveProblem) => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 4, total_count: 4 },
      iterations_used: 1,
      reasoning_trace: [{ problem }],
    }))
    const client = createMockClient({ solve: solveMock })

    const verdict = await evaluatePrometheusPlanningGate({
      client,
      candidate: createMetisCandidate(
        "session-metis-evidence",
        `Review this planning session:\n**Goal**: Build the feature\n**Discussed**: We scoped the work\n**My Understanding**: Implement the next slice\n**Research**: Found existing constraints and tests.`,
      ),
      callID: "call-metis-evidence",
      toolHistory: [],
    })

    expect(verdict.allow).toBe(true)
    const solveInput = solveMock.mock.calls[0]?.[0]
    expect(solveInput.theory.premises).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ formula: "research_present(current)" }),
      ]),
    )
    expect(solveInput.theory.defeasible_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "claim-support-research_present" }),
      ]),
    )
  })

  it("writes a consultation pattern to the KB Learned layer after a valid allow verdict", async () => {
    const kbAddMock = mock(() => Promise.resolve({ id: "kb_metis_1" }))
    const client = createMockClient({ kbAdd: kbAddMock })

    await writeAllowedConsultationPattern({
      client,
      sessionID: "session-metis-write",
      verdict: {
        allow: true,
        proofArtifact: {
          sections: {
            goal: "Build the feature",
            discussed: "Scoped the work",
            understanding: "Implement the next slice",
            research: "Found existing constraints and tests",
          },
          kbResult: { count: 2, entries: [] },
          evidence: { verified: [], unverified: ["research_present"] },
          outcome: { stop_signal: "Solved" },
        },
      },
    })

    expect(kbAddMock).toHaveBeenCalledTimes(1)
    const entry = kbAddMock.mock.calls[0]?.[0]
    expect(entry.layer).toBe("Learned")
    expect(entry.tags).toContain("prometheus-metis-consultation")
    expect(entry.tags).toContain("planning")
    expect(entry.tags).toContain("metis")
    expect(entry.tags).toContain("prereq:research_present")
    expect(entry.content.Insight.problem_type).toBe("prometheus_metis_consultation")
  })

  it("does not propagate KB write failures for consultation patterns", async () => {
    const kbAddMock = mock(() => Promise.reject(new Error("kb down")))
    const client = createMockClient({ kbAdd: kbAddMock })

    await expect(
      writeAllowedConsultationPattern({
        client,
        sessionID: "session-metis-write-fail",
        verdict: {
          allow: true,
          proofArtifact: {
            sections: {
              goal: "Build the feature",
              discussed: "Scoped the work",
              understanding: "Implement the next slice",
              research: "Found existing constraints and tests",
            },
            kbResult: { count: 0, entries: [] },
            evidence: { verified: ["research_present"], unverified: [] },
            outcome: { stop_signal: "Solved" },
          },
        },
      }),
    ).resolves.toBeUndefined()

    expect(kbAddMock).toHaveBeenCalledTimes(1)
  })

  it("removes an exact duplicate consultation pattern before writing a new one", async () => {
    const kbRemoveMock = mock(() => Promise.resolve())
    const kbAddMock = mock(() => Promise.resolve({ id: "kb_metis_new" }))
    const client = createMockClient({
      kbQuery: mock(() => Promise.resolve({
        count: 1,
        entries: [{
          id: "kb_metis_old",
          tags: ["prometheus-metis-consultation", "planning", "metis", "prereq:goal_present", "prereq:discussion_present", "prereq:understanding_present", "prereq:research_present"],
          content: {
            Insight: {
              problem_type: "prometheus_metis_consultation",
              lesson: "Metis consultation passed goal/discussed/understanding/research with stop_signal=Solved and 2 prior consultation patterns consulted.",
              example: 'metis consultation: goal="Build the feature", research="Found existing constraints and tests", verified=[], unverified=[research_present]',
            },
          },
        }],
      })),
      kbRemove: kbRemoveMock,
      kbAdd: kbAddMock,
    })

    await writeAllowedConsultationPattern({
      client,
      sessionID: "session-metis-replace",
      verdict: {
        allow: true,
        proofArtifact: {
          sections: {
            goal: "Build the feature",
            discussed: "Scoped the work",
            understanding: "Implement the next slice",
            research: "Found existing constraints and tests",
          },
          kbResult: { count: 2, entries: [] },
          evidence: { verified: [], unverified: ["research_present"] },
          outcome: { stop_signal: "Solved" },
        },
      },
    })

    expect(kbRemoveMock).toHaveBeenCalledWith({ id: "kb_metis_old" })
    expect(kbAddMock).toHaveBeenCalledTimes(1)
  })
})
