import { describe, expect, it, mock } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { DeliberationRequest, DeliberationResponse } from "../../agents/themis/types"
import type { ReasoningCoreClient } from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import type { DeliberationRoundResult } from "./deliberation-round"
import { createSubmitDeliberationTool } from "./tool"

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
    theory: JSON.stringify({
      premises: [{ formula: "problem(current)", kind: "ordinary" }],
      strict_rules: [],
      defeasible_rules: [],
      preferences: [],
      classical_negation: true,
    }),
  }
}

function buildRequest(id: string): DeliberationRequest {
  return {
    ...buildArgs(id),
  }
}

describe("createSubmitDeliberationTool AGM fallback no_selectable_bundle", () => {
  it("#when the initial round returns no selectable bundle but AGM revision succeeds #then returns the revised response", async () => {
    const initialRequest = buildRequest("agm-no-bundle")
    const initialResponse: DeliberationResponse = {
      verdict: "no_selectable_bundle",
      rationale: "No unique bundle selected.",
      proof_chain: [],
      sidecar_trace: {},
      provenance: {
        semantics: "preferred",
        iterations: 1,
        timestamp: new Date().toISOString(),
        input_request: initialRequest,
      },
      bundle: null,
    }
    const runRound = mock(async (): Promise<DeliberationRoundResult> => ({
      response: initialResponse,
      convergence: null,
      preferenceCycle: { detected: false, path: [] },
      semanticsComparison: {
        grounded_set: [],
        preferred_extensions: [],
        stable_extensions: [],
        complete_extensions: [],
        certainty_gradient: { certain: [], defensible: [], contested: [] },
      },
    }))
    const agmRevision = mock(async () => ({
      response: {
        ...initialResponse,
        verdict: "converged_after_revision" as const,
        rationale: "Recovered after dropping a weak premise.",
        bundle: { selected_option: "Option A", burdens: [], mitigations: [], guardrails: [] },
        revised_premises: ["problem(current)"],
      },
      convergence: "converged" as const,
    }))
    const client: ReasoningCoreClient = {
      argue: mock(async () => ({})),
      evaluate: mock(async () => ({ allow: true })),
      solve: mock(async () => ({
        stop_signal: "Solved",
        argumentation_result: { conclusions: {} },
        constraint_state: { domains: {}, solved: true, solved_count: 0, total_count: 0 },
        iterations_used: 1,
        reasoning_trace: [],
      })),
      constrain: mock(async () => ({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
      kbQuery: mock(async () => ({ count: 0, entries: [] })),
      kbAdd: mock(async () => ({ id: "kb-1" })),
      kbRemove: mock(async () => undefined),
      check: mock(async () => ({ signal: "Solved", iteration: 1, reason: "done" })),
      status: mock(async () => ({ session_active: false, domains: {}, is_solved: false, reasoning_history: [] })),
      disposeSession: mock(() => {}),
      disposeAll: mock(() => {}),
      dispose: mock(() => {}),
    }
    const tool = createSubmitDeliberationTool({
      workspaceRoot: "/tmp",
      client,
      runRound,
      applyAgmRevision: agmRevision,
    })

    const result = await tool.execute(buildArgs("agm-no-bundle"), toolContext)
    const parsed = JSON.parse(result)

    expect(runRound).toHaveBeenCalledTimes(1)
    expect(agmRevision).toHaveBeenCalledTimes(1)
    expect(parsed.verdict).toBe("converged_after_revision")
    expect(parsed.rationale).toBe("Recovered after dropping a weak premise.")
    expect(parsed.revised_premises).toEqual(["problem(current)"])
  })
})
