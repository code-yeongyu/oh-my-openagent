/// <reference path="../../../bun-test.d.ts" />

import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { MultiPlaneHookConfig } from "../../hooks/epistemic-state-interpreter/hook-v2"
import * as proofArtifactParserModule from "../../hooks/epistemic-state-interpreter/proof-artifact-parser"
import {
  _resetMultiPlaneStoreForTesting,
  getMultiPlaneAnnotations,
  getSessionHooks,
} from "../../hooks/epistemic-state-interpreter/annotation-store-v2"
import { _resetHookStoreForTesting } from "../../hooks/epistemic-state-interpreter/hook-store"

const { afterEach, describe, expect, it, mock, spyOn } = require("bun:test")

import {
  createReasonArgueToolWithDeps,
  createReasonSolveToolWithDeps,
} from "./tools"

const mockArgue = mock(async () => ({ accepted: ["p"] }))
const mockSolve = mock(async () => ({
  stop_signal: "Solved",
  constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
  iterations_used: 1,
  reasoning_trace: [],
}))

const metadata = mock(() => {})

const multiPlaneConfig: MultiPlaneHookConfig = {
  enabled: true,
  epistemic_gate_mode: "annotation",
  plausibilita_threshold: 0.6,
  ethical_value_hierarchy: ["vita_umana", "autonomia"],
  pragmatic_weights: { peso_proprio: 0.6, peso_controparte: 0.4 },
  moral_context_defaults: {
    default_audience: "general",
    require_audience_model: false,
  },
  transition_thresholds: {
    advancement_min_strength: 1,
    retrocession_min_strength: 2,
    expulsion_min_strength: 3,
    reopening_min_strength: 2,
  },
  confidence_weights: {
    extensionRatio: 0.4,
    proofChainDepth: 0.3,
    ruleStrength: 0.3,
  },
}

const toolContext: ToolContext = {
  sessionID: "ses-test",
  messageID: "msg-test",
  agent: "test-agent",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata,
  ask: async () => {},
}

afterEach(() => {
  mockArgue.mockClear()
  mockSolve.mockClear()
  metadata.mockClear()
  _resetMultiPlaneStoreForTesting()
  _resetHookStoreForTesting()
})

function createMockClient() {
  return {
    argue: mockArgue,
    evaluate: mock(async () => ({ allow: true })),
    solve: mockSolve,
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

function buildConclusion(status: string, ruleKind: "strict" | "defeasible") {
  return {
    conclusion: "",
    status,
    proof_chain: [
      {
        conclusion: "support",
        from: [],
        rule_id: ruleKind === "strict" ? "s1" : "d1",
        rule_kind: ruleKind,
      },
    ],
  }
}

function buildProofArtifact() {
  return {
    theory: {},
    result: {
      semantics: "preferred",
      extensions: [
        { index: 0, accepted_conclusions: ["accept(alpha)"] },
        { index: 1, accepted_conclusions: ["accept(alpha)"] },
      ],
      conclusions: {
        "accept(alpha)": {
          ...buildConclusion("Accepted", "strict"),
          conclusion: "accept(alpha)",
        },
        "reject(beta)": {
          ...buildConclusion("Rejected", "defeasible"),
          conclusion: "reject(beta)",
        },
      },
    },
  }
}

describe("reasoning-core wrapper tools", () => {
  it("calls reasoning-core argue and formats the result", async () => {
    const reasonArgue = createReasonArgueToolWithDeps(undefined, { client: createMockClient() as never })
    const args = {
      theory: {
        premises: [{ formula: "p" }],
        classical_negation: true,
      },
      semantics: "preferred" as const,
    }

    const result = await reasonArgue.execute(args, toolContext)

    expect(mockArgue).toHaveBeenCalledWith(args)
    expect(metadata).toHaveBeenCalledWith({ title: "ASPIC+ Argumentation Result" })
    expect(result).toBe(JSON.stringify({ accepted: ["p"] }, null, 2))
  })

  it("calls reasoning-core solve and formats the result", async () => {
    const reasonSolve = createReasonSolveToolWithDeps(undefined, { client: createMockClient() as never })
    const args = {
      description: "Solve the puzzle",
      variables: [{ name: "x", domain: [1, 2] }],
      theory: { premises: [] },
      max_iterations: 3,
    }

    const result = await reasonSolve.execute(args, toolContext)

    expect(mockSolve).toHaveBeenCalledWith({
      ...args,
      initial_constraints: [],
      incremental_constraints: undefined,
    })
    expect(metadata).toHaveBeenCalledWith({ title: "Constraint Reasoning Result" })
    expect(result).toBe(
      JSON.stringify(
        {
          stop_signal: "Solved",
          constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
          iterations_used: 1,
          reasoning_trace: [],
        },
        null,
        2,
      ),
    )
  })

  it("runs the epistemic pipeline after reason_argue when config is enabled", async () => {
    const resultPayload = buildProofArtifact()
    mockArgue.mockResolvedValueOnce(resultPayload)

    const reasonArgue = createReasonArgueToolWithDeps(multiPlaneConfig, { client: createMockClient() as never })
    const args = {
      theory: {
        premises: [{ formula: "p" }],
        classical_negation: true,
      },
      semantics: "preferred" as const,
    }

    const result = await reasonArgue.execute(args, toolContext)
    const annotations = getMultiPlaneAnnotations("ses-test")
    const hooks = getSessionHooks("ses-test")

    const parsed = JSON.parse(result)
    expect(parsed.core).toEqual(resultPayload)
    expect(parsed.deliberative).toBeDefined()
    expect(annotations).toHaveLength(2)
    expect(hooks).toHaveLength(2)
    expect(annotations.every((annotation) => annotation.callID.startsWith("reason-argue-"))).toBe(true)
  })

  it("injects derived preferences on a follow-up reason_argue call", async () => {
    mockArgue.mockResolvedValueOnce(buildProofArtifact())
    mockArgue.mockResolvedValueOnce({ accepted: ["q"] })

    const reasonArgue = createReasonArgueToolWithDeps(multiPlaneConfig, { client: createMockClient() as never })

    await reasonArgue.execute(
      {
        theory: {
          premises: [{ formula: "p" }],
          classical_negation: true,
        },
        semantics: "preferred",
      },
      toolContext,
    )

    expect(getMultiPlaneAnnotations("ses-test")).toHaveLength(2)

    const followUpArgs = {
      theory: {
        premises: [{ formula: "q" }],
        classical_negation: true,
      },
      semantics: "preferred" as const,
    }

    await reasonArgue.execute(followUpArgs, toolContext)

    const secondCallArgs = mockArgue.mock.calls[1]?.[0] as {
      theory: { preferences?: Array<{ superior: string; inferior: string }> }
    }

    expect(secondCallArgs.theory.preferences).toEqual([
      { superior: "accept(alpha)", inferior: "reject(beta)" },
    ])
  })

  it("returns the reasoning-core solve result even when the epistemic pipeline fails", async () => {
    const parserSpy = spyOn(proofArtifactParserModule, "parseProofArtifact").mockImplementation(() => {
      throw new Error("pipeline failed")
    })

    const resultPayload = buildProofArtifact()
    mockSolve.mockResolvedValueOnce(resultPayload)

    const reasonSolve = createReasonSolveToolWithDeps(multiPlaneConfig, { client: createMockClient() as never })
    const args = {
      description: "Solve the puzzle",
      variables: [{ name: "x", domain: [1, 2] }],
      theory: { premises: [] },
      max_iterations: 3,
    }

    const result = await reasonSolve.execute(args, toolContext)

    expect(result).toBe(JSON.stringify(resultPayload, null, 2))
    expect(getMultiPlaneAnnotations("ses-test")).toHaveLength(0)

    parserSpy.mockRestore()
  })
})
