import { describe, expect, it, mock } from "bun:test"
import { createSubmitDeliberationTool } from "./tool"
import type { ReasoningCoreClient } from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"

const MINIMAL_THEORY = JSON.stringify({
  premises: [{ formula: "problem(current)", kind: "ordinary" }],
  strict_rules: [],
  defeasible_rules: [{ id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" }],
  preferences: [],
  classical_negation: true,
})

const toolContext = {
  sessionID: "test-session",
  metadata: mock(() => {}),
} as unknown as Parameters<ReturnType<typeof createSubmitDeliberationTool>["execute"]>[1]

function createMockClient(overrides?: Partial<ReasoningCoreClient>): ReasoningCoreClient {
  return {
    argue: mock(async () => ({
      extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
      conclusions: { select_option_a: { status: "Accepted", proof_chain: [] } },
      semantics: "preferred",
    })),
    evaluate: mock(async () => ({ allow: true })),
    solve: mock(async () => ({
      stop_signal: "converged",
      argumentation_result: { conclusions: { select_option_a: { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
      iterations_used: 1,
      reasoning_trace: [],
    })),
    constrain: mock(async () => ({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
    kbQuery: mock(async () => ({
      count: 1,
      entries: [{
        tags: ["themis-deliberation", "reasoning"],
        content: {
          Insight: {
            lesson: "Prefer the option with fewer policy conflicts.",
            example: "Example: select_option_a dominated due to lower compliance risk.",
          },
        },
      }],
    })),
    kbAdd: mock(async () => ({ id: "kb-new-1" })),
    kbRemove: mock(async () => {}),
    check: mock(async () => ({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(async () => ({ session_active: true, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
    ...overrides,
  }
}

function buildArgs(id: string, theory?: string) {
  return {
    id,
    timestamp: new Date().toISOString(),
    problem_statement: "Choose a rollout policy for the feature flag.",
    options: ["Option A", "Option B"],
    constraints: ["Must remain compliant"],
    preferences: [],
    requested_semantics: "preferred" as const,
    ...(theory !== undefined ? { theory } : {}),
  }
}

describe("submit deliberation KB integration", () => {
  it("#when theory is absent #then it injects KB context into the formalizer request", async () => {
    const client = createMockClient()
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client })

    const result = await tool.execute(buildArgs("kb-context-miss"), toolContext)
    const parsed = JSON.parse(result)

    expect(client.kbQuery).toHaveBeenCalledTimes(1)
    expect(parsed.provenance.input_request.context).toContain("Relevant KB context")
    expect(parsed.provenance.input_request.context).toContain("Prefer the option with fewer policy conflicts")
  })

  it("#when deliberation succeeds #then it stores a learned pattern after the response", async () => {
    const client = createMockClient()
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client })

    const result = await tool.execute(buildArgs("kb-store-success", MINIMAL_THEORY), toolContext)
    const parsed = JSON.parse(result)

    expect(parsed.verdict).toBeDefined()
    expect(client.kbAdd).toHaveBeenCalledTimes(1)
    const kbAddCall = (client.kbAdd as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      layer: string
      tags: string[]
    }
    expect(kbAddCall.layer).toBe("Learned")
    expect(kbAddCall.tags).toContain("themis-deliberation")
    expect(kbAddCall.tags).toContain(`verdict:${parsed.verdict}`)
  })

  it("#when kb query fails #then the no-theory response still succeeds without injected context", async () => {
    const client = createMockClient({
      kbQuery: mock(async () => {
        throw new Error("kb unavailable")
      }),
    })
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client })

    const result = await tool.execute(buildArgs("kb-query-failure"), toolContext)
    const parsed = JSON.parse(result)

    expect(parsed.verdict).toBe("formalization_failed")
    expect(parsed.provenance.input_request.context).toBeUndefined()
  })

  it("#when kb add fails #then the deliberation response still returns", async () => {
    const client = createMockClient({
      kbAdd: mock(async () => {
        throw new Error("kb add unavailable")
      }),
    })
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client })

    const result = await tool.execute(buildArgs("kb-add-failure", MINIMAL_THEORY), toolContext)
    const parsed = JSON.parse(result)

    expect(parsed.verdict).toBeDefined()
    expect(client.kbAdd).toHaveBeenCalledTimes(1)
  })
})
