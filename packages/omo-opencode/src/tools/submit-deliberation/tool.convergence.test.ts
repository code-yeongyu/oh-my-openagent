import { describe, expect, it, mock } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createSubmitDeliberationTool } from "./tool"
import type {
  ReasoningCoreClient,
  ReasoningCoreMetacognitiveVerdict,
  ReasoningCoreSolveOutcome,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"

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

describe("createSubmitDeliberationTool convergence", () => {
  it("#when solve succeeds #then runs reason_check and marks response converged", async () => {
    const check = mock(async (): Promise<ReasoningCoreMetacognitiveVerdict> => ({
      signal: "Solved",
      iteration: 3,
      reason: "solution found",
    }))
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client: createClient({ check }) })

    const result = await tool.execute(buildArgs("converged-check"), toolContext)
    const parsed = JSON.parse(result)
    const firstCall = check.mock.calls[0]
    if (!firstCall) {
      throw new Error("reason_check was not called")
    }
    const state = (firstCall as unknown[])[1]

    expect(check).toHaveBeenCalledTimes(1)
    expect(state).toEqual({ iteration: 3, domain_reduction_rate: 0.5, domains_solved: 1, domains_total: 2, extensions_count: 1 })
    expect(parsed.convergence).toBe("converged")
  })

  it("#when reason_check reports looping #then response marks convergence as looping", async () => {
    const check = mock(async (): Promise<ReasoningCoreMetacognitiveVerdict> => ({
      signal: "Looping",
      iteration: 3,
      reason: "iteration cap hit",
    }))
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client: createClient({ check }) })

    const result = await tool.execute(buildArgs("looping-check"), toolContext)
    const parsed = JSON.parse(result)

    expect(parsed.convergence).toBe("looping")
  })

  it("#when reason_check reports continue #then response marks convergence as not_converged", async () => {
    const check = mock(async (): Promise<ReasoningCoreMetacognitiveVerdict> => ({
      signal: "Continue",
      iteration: 3,
      reason: "partial progress",
    }))
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client: createClient({ check }) })

    const result = await tool.execute(buildArgs("not-converged-check"), toolContext)
    const parsed = JSON.parse(result)

    expect(parsed.convergence).toBe("not_converged")
  })

  it("#when reason_check reports a fundamental conflict #then response becomes unable_to_converge", async () => {
    const check = mock(async (): Promise<ReasoningCoreMetacognitiveVerdict> => ({
      signal: "Conflict",
      iteration: 3,
      reason: "fundamental conflict between constraints",
    }))
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client: createClient({ check }) })

    const result = await tool.execute(buildArgs("unable-to-converge-check"), toolContext)
    const parsed = JSON.parse(result)

    expect(parsed.convergence).toBe("unable_to_converge")
    expect(parsed.verdict).toBe("unable_to_converge")
  })

  it("#when solve falls back to argue #then reason_check is skipped", async () => {
    const solve = mock(async () => {
      throw new Error("solve unavailable")
    })
    const check = mock(async (): Promise<ReasoningCoreMetacognitiveVerdict> => ({
      signal: "Solved",
      iteration: 3,
      reason: "solution found",
    }))
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client: createClient({ solve, check }) })

    const result = await tool.execute(buildArgs("fallback-check"), toolContext)
    const parsed = JSON.parse(result)

    expect(check).not.toHaveBeenCalled()
    expect(parsed.convergence).toBeUndefined()
  })
})
