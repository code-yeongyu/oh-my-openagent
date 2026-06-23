/// <reference path="../../../bun-test.d.ts" />

import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { DeliberationResponse } from "../../agents/themis/types"
import type { ReasoningCoreClient } from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import { createProcessedConclusionFixture } from "../../hooks/reasoning-core-policy-gate/epistemic-analysis-test-fixtures"

const { describe, it, expect, mock } = require("bun:test")

const MINIMAL_THEORY = JSON.stringify({
  premises: [{ formula: "problem(current)", kind: "ordinary" }],
  strict_rules: [],
  defeasible_rules: [
    { id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" },
  ],
  preferences: [],
  classical_negation: true,
})

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

function createMockClient(mockArgue: ReasoningCoreClient["argue"]): ReasoningCoreClient {
  return {
    argue: mockArgue,
    evaluate: mock(async () => ({ allow: true })),
    solve: mock(async () => ({
      stop_signal: "Solved",
      constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
      iterations_used: 1,
      reasoning_trace: [],
    })),
    constrain: mock(async () => ({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
    kbQuery: mock(async () => ({ count: 0, entries: [] })),
    kbAdd: mock(async () => ({ id: "kb-1" })),
    kbRemove: mock(async () => undefined),
    check: mock(async () => ({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(async () => ({ session_active: false, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
  }
}

const processConclusion = mock(({ conclusion }: { conclusion: string }) => createProcessedConclusionFixture(conclusion))
const runConsequenceLiftingSidecar = mock(() => ({
  policies: [],
  profiles: [],
  graph: { decisions: [], edges: [] },
  bundle: { selection: { selectedBySlot: {}, excluded: [] } },
  humility: { report: { capacity: "repairable", escalationReasons: [], summary: "No sidecar rationale available." } },
}))

mock.module("../../hooks/epistemic-state-interpreter/hook-v2-conclusion-processor", () => ({
  processConclusion,
}))

mock.module("../../hooks/consequence-lifting-sidecar", () => ({
  comparePolicies: () => ({ winner: "tie" }),
  runConsequenceLiftingSidecar,
}))

const { createSubmitDeliberationTool } = await import("./tool")

describe("createSubmitDeliberationTool epistemic analysis", () => {
  it("#when processed conclusions include piano outputs #then response surfaces epistemic_analysis", async () => {
    const mockArgue = mock(async () => ({
      extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
      conclusions: { select_option_a: { status: "Accepted", proof_chain: [] } },
      semantics: "grounded",
    }))

    const tool = createSubmitDeliberationTool({
      workspaceRoot: "/tmp",
      client: createMockClient(mockArgue),
    })

    const result = await tool.execute({
      id: "epistemic-analysis-test",
      timestamp: new Date().toISOString(),
      problem_statement: "Test deliberation",
      options: ["Option A"],
      constraints: [],
      preferences: [],
      requested_semantics: "grounded",
      theory: MINIMAL_THEORY,
    }, toolContext)

    const parsed = JSON.parse(result) as DeliberationResponse

    expect(processConclusion).toHaveBeenCalledTimes(1)
    expect(parsed.epistemic_analysis).toEqual({
      piano_a: { select_option_a: "plausibile" },
      piano_b: { select_option_a: 0.87 },
      piano_c: {
        etico: {
          deontological: { select_option_a: 1 },
          consequentialist: { select_option_a: 0.8 },
          virtue_ethics: { select_option_a: 0.8 },
        },
        morale: {
          select_option_a: {
            score: 0.8,
            label: "giustificabile",
            contesto_sociale: "general",
            comprensione_destinatari: "high",
            impatto_cascata: 0.2,
            intenzione: "benevola",
            trasparenza: 0.9,
            fiducia_risultante: 0.8,
            reason: "socially_acceptable",
          },
        },
        pragmatico: {
          select_option_a: {
            score: 0.7,
            label: "conveniente",
            beneficio_proprio: 0.7,
            beneficio_controparte: 0.6,
            costo_proprio: 0.1,
            costo_controparte: 0.2,
            pesatura: { proprio: 0.6, controparte: 0.4 },
          },
        },
      },
      piano_d: {
        synthesis: "Dominant conclusion: select_option_a (margin 1.0000).",
        dominant_conclusion: "select_option_a",
        confidence: 0.85,
      },
    })
  })
})
