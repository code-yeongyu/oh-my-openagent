import { describe, expect, it, mock } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { DeliberationResponse } from "../../agents/themis/types"
import type { ReasoningCoreClient, ReasoningCoreMetacognitiveVerdict, ReasoningCoreSolveOutcome } from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import type { DeliberationRoundResult } from "./deliberation-round"
import { createSubmitDeliberationTool } from "./tool"

const MINIMAL_THEORY = JSON.stringify({
  premises: [{ formula: "problem(current)", kind: "ordinary" }],
  strict_rules: [],
  defeasible_rules: [
    { id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" },
  ],
  preferences: [],
  classical_negation: true,
})

const DEFAULT_SOLVE_OUTCOME: ReasoningCoreSolveOutcome = {
  stop_signal: "Solved",
  argumentation_result: {
    conclusions: { select_option_a: { status: "Accepted" } },
  },
  constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 2 },
  iterations_used: 3,
  reasoning_trace: [{ step: "init" }, { step: "solve" }],
}

const toolContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata: mock(() => {}),
  ask: async () => {},
}

function buildArgs(id: string) {
  return {
    id,
    timestamp: new Date().toISOString(),
    problem_statement: "Test deliberation",
    options: ["Option A", "Option B"],
    constraints: [],
    preferences: [],
    requested_semantics: "preferred" as const,
    theory: MINIMAL_THEORY,
  }
}

function createClient(overrides: Partial<ReasoningCoreClient> = {}): ReasoningCoreClient {
  return {
    argue: mock(async () => ({
      extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
      conclusions: { select_option_a: { status: "Accepted", proof_chain: [] } },
      semantics: "preferred",
    })),
    evaluate: mock(async () => ({ allow: true })),
    solve: mock(async () => DEFAULT_SOLVE_OUTCOME),
    constrain: mock(async () => ({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
    kbQuery: mock(async () => ({ count: 0, entries: [] })),
    kbAdd: mock(async () => ({ id: "kb-1" })),
    kbRemove: mock(async () => undefined),
    check: mock(async (): Promise<ReasoningCoreMetacognitiveVerdict> => ({
      signal: "Solved",
      iteration: DEFAULT_SOLVE_OUTCOME.iterations_used,
      reason: "solution found",
    })),
    status: mock(async () => ({ session_active: false, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
    ...overrides,
  }
}

describe("createSubmitDeliberationTool AGM fallback", () => {
  it("#when convergence verification fails but AGM revision succeeds #then returns the revised response", async () => {
    const roundResponse: DeliberationResponse = {
      verdict: "selected",
      rationale: "Recovered after removing a weak premise.",
      proof_chain: [],
      sidecar_trace: {},
      provenance: {
        semantics: "preferred",
        iterations: 1,
        timestamp: new Date().toISOString(),
        input_request: buildArgs("agm-convergence-revision"),
      },
      bundle: { selected_option: "Option A", burdens: [], mitigations: [], guardrails: [] },
    }
    const agmRevision = mock(async () => ({
      response: {
        ...roundResponse,
        verdict: "converged_after_revision" as const,
        revised_premises: ["problem(current)"],
      },
      convergence: "converged" as const,
    }))
    const runRound = mock(async (): Promise<DeliberationRoundResult> => ({
      response: {
        ...roundResponse,
        verdict: "unable_to_converge",
      },
      convergence: { convergence: "unable_to_converge", verdict: "unable_to_converge" },
      preferenceCycle: { detected: false, path: [] },
      semanticsComparison: {
        grounded_set: [],
        preferred_extensions: [],
        stable_extensions: [],
        complete_extensions: [],
        certainty_gradient: { certain: [], defensible: [], contested: [] },
      },
    }))

    const check = mock(async (): Promise<ReasoningCoreMetacognitiveVerdict> => ({
      signal: "Conflict",
      iteration: 3,
      reason: "fundamental conflict between constraints",
    }))
    const tool = createSubmitDeliberationTool({
      workspaceRoot: "/tmp",
      client: createClient({ check }),
      runRound,
      applyAgmRevision: agmRevision,
    })

    const result = await tool.execute(buildArgs("agm-convergence-revision"), toolContext)
    const parsed = JSON.parse(result)

    expect(runRound).toHaveBeenCalledTimes(1)
    expect(agmRevision).toHaveBeenCalledTimes(1)
    expect(parsed.verdict).toBe("converged_after_revision")
    expect(parsed.rationale).toBe("Recovered after removing a weak premise.")
    expect(parsed.revised_premises).toEqual(["problem(current)"])
  })
})
