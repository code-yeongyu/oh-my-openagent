import { afterAll, describe, expect, it, mock } from "bun:test"
import type { ReasoningCoreClient } from "./reasoning-core-client"

const mockLog = mock((_message: string, _data?: unknown) => {})
mock.module("../../shared/logger", () => ({ log: mockLog }))

afterAll(() => {
  mock.restore()
})

const { queryContext, storePattern } = await import("./kb-deliberation-bridge")

function createMockClient(overrides?: Partial<ReasoningCoreClient>): ReasoningCoreClient {
  return {
    argue: mock(async () => ({})),
    evaluate: mock(async () => ({ allow: true })),
    solve: mock(async () => ({
      stop_signal: "converged",
      constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
      iterations_used: 1,
      reasoning_trace: [],
      argumentation_result: undefined,
    })),
    constrain: mock(async () => ({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
    kbQuery: mock(async () => ({
      count: 1,
      entries: [{
        content: {
          Insight: {
            lesson: "Prefer options that preserve compliance evidence.",
            example: "Option A won when auditability was required.",
          },
        },
      }],
    })),
    kbAdd: mock(async () => ({ id: "kb-1" })),
    kbRemove: mock(async () => {}),
    check: mock(async () => ({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(async () => ({ session_active: true, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
    ...overrides,
  }
}

describe("kb deliberation bridge", () => {
  it("#when kb has prior insights #then queryContext formats them for formalization", async () => {
    const client = createMockClient()

    const result = await queryContext(client, "Choose a rollout policy")

    expect(client.kbQuery).toHaveBeenCalledTimes(1)
    expect(result).toContain("Relevant KB context from prior deliberations")
    expect(result).toContain("Prefer options that preserve compliance evidence")
    expect(result).toContain("Option A won when auditability was required")
  })

  it("#when kbQuery fails #then queryContext returns empty", async () => {
    const client = createMockClient({
      kbQuery: mock(async () => {
        throw new Error("kb down")
      }),
    })

    const result = await queryContext(client, "Choose a rollout policy")

    expect(result).toBe("")
  })

  it("#when storing a successful pattern #then storePattern writes to Learned layer", async () => {
    const client = createMockClient()

    await storePattern(
      client,
      {
        problem_statement: "Choose a rollout policy",
        options: ["Option A", "Option B"],
        constraints: ["Must remain compliant"],
        requested_semantics: "preferred",
      },
      "allow",
      { premises: [], strict_rules: [], defeasible_rules: [], preferences: [] },
    )

    expect(client.kbAdd).toHaveBeenCalledTimes(1)
    const call = (client.kbAdd as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      layer: string
      tags: string[]
      content: { Insight: { lesson: string } }
    }
    expect(call.layer).toBe("Learned")
    expect(call.tags).toContain("themis-deliberation")
    expect(call.tags).toContain("verdict:allow")
    expect(call.content.Insight.lesson).toContain("Choose a rollout policy")
  })

  it("#when kbAdd fails #then storePattern stays non-blocking", async () => {
    const client = createMockClient({
      kbAdd: mock(async () => {
        throw new Error("kb add down")
      }),
    })

    await storePattern(
      client,
      {
        problem_statement: "Choose a rollout policy",
        options: ["Option A", "Option B"],
        constraints: ["Must remain compliant"],
        requested_semantics: "preferred",
      },
      "allow",
      { premises: [], strict_rules: [], defeasible_rules: [], preferences: [] },
    )

    expect(client.kbAdd).toHaveBeenCalledTimes(1)
  })

  it("#when kbAdd fails #then log records severity warning and failure_kind kb_add", async () => {
    mockLog.mockClear()
    const client = createMockClient({
      kbAdd: mock(async () => {
        throw new Error("kb add down")
      }),
    })

    await storePattern(
      client,
      {
        problem_statement: "Choose a rollout policy",
        options: ["Option A", "Option B"],
        constraints: ["Must remain compliant"],
        requested_semantics: "preferred",
      },
      "allow",
      { premises: [], strict_rules: [], defeasible_rules: [], preferences: [] },
    )

    const failureCall = mockLog.mock.calls.find(([message]) => typeof message === "string" && message.includes("kb-add-failed"))
    expect(failureCall).toBeDefined()
    const payload = failureCall?.[1] as Record<string, unknown> | undefined
    expect(payload?.severity).toBe("warning")
    expect(payload?.failure_kind).toBe("kb_add")
    expect(payload?.error).toBe("kb add down")
  })

  it("#when kbQuery fails #then log records severity warning and failure_kind kb_query", async () => {
    mockLog.mockClear()
    const client = createMockClient({
      kbQuery: mock(async () => {
        throw new Error("kb query down")
      }),
    })

    await queryContext(client, "Choose a rollout policy")

    const failureCall = mockLog.mock.calls.find(([message]) => typeof message === "string" && message.includes("kb-query-failed"))
    expect(failureCall).toBeDefined()
    const payload = failureCall?.[1] as Record<string, unknown> | undefined
    expect(payload?.severity).toBe("warning")
    expect(payload?.failure_kind).toBe("kb_query")
    expect(payload?.error).toBe("kb query down")
  })
})
