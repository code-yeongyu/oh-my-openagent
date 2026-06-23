/// <reference path="../../hooks/reasoning-core-policy-gate/bun-test.d.ts" />

import { describe, it, expect, mock } from "bun:test"
import { createSubmitDeliberationTool } from "./tool"
import type { ReasoningCoreSolveOutcome } from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import {
  FormalizationError,
  type FormalizationProvenance,
  type FormalizationResult,
  type SemanticFormalizationService,
  type Theory,
} from "../../hooks/reasoning-core-policy-gate/semantic-formalization-service"

const MINIMAL_THEORY = JSON.stringify({
  premises: [{ formula: "problem(current)", kind: "ordinary" }],
  strict_rules: [],
  defeasible_rules: [
    { id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" },
  ],
  preferences: [],
  classical_negation: true,
})

const CYCLIC_PREFERENCE_THEORY = JSON.stringify({
  premises: [{ formula: "problem(current)", kind: "ordinary" }],
  strict_rules: [],
  defeasible_rules: [
    { id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" },
  ],
  preferences: [
    { superior: "A", inferior: "B" },
    { superior: "B", inferior: "C" },
    { superior: "C", inferior: "A" },
  ],
  classical_negation: true,
})

const ACYCLIC_PREFERENCE_THEORY = JSON.stringify({
  premises: [{ formula: "problem(current)", kind: "ordinary" }],
  strict_rules: [],
  defeasible_rules: [
    { id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" },
  ],
  preferences: [
    { superior: "A", inferior: "B" },
    { superior: "B", inferior: "C" },
  ],
  classical_negation: true,
})

const VALUE_TAGGED_THEORY = JSON.stringify({
  premises: [{ formula: "patient(case_1) @value:safety", kind: "ordinary" }],
  strict_rules: [],
  defeasible_rules: [
    { id: "rule_autonomy", antecedents: ["patient(case_1)"], consequent: "select_option_a @value:autonomy" },
    { id: "rule_safety", antecedents: ["patient(case_1)"], consequent: "select_option_b @value:safety" },
  ],
  preferences: [],
  classical_negation: true,
})

const toolContext = {
  sessionID: "test-session",
  metadata: mock(() => {}),
} as unknown as Parameters<ReturnType<typeof createSubmitDeliberationTool>["execute"]>[1]

type SubmitDeliberationArgs = Parameters<ReturnType<typeof createSubmitDeliberationTool>["execute"]>[0]

function buildArgsBase(id: string, theory?: string): SubmitDeliberationArgs {
  return {
    id,
    timestamp: new Date().toISOString(),
    problem_statement: "Test deliberation",
    options: ["Option A", "Option B"],
    constraints: [],
    preferences: [],
    context: undefined,
    requested_semantics: "preferred" as const,
    ...(theory !== undefined ? { theory } : {}),
  }
}

function buildArgs(id: string, theory?: string, overrides: Partial<SubmitDeliberationArgs> = {}): SubmitDeliberationArgs {
  return {
    ...buildArgsBase(id, theory),
    ...overrides,
  }
}

function buildFormalizationResult(theoryOverrides?: Partial<Theory>, provenanceOverrides?: Partial<FormalizationProvenance>): FormalizationResult {
  const theory: Theory = {
    premises: [{ formula: "problem(current)", kind: "ordinary" }],
    strict_rules: [],
    defeasible_rules: [
      { id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" },
    ],
    preferences: [],
    classical_negation: true,
    ...theoryOverrides,
  }
  const provenance: FormalizationProvenance = {
    model_id: "stub-formalizer",
    prompt_version: "test-1",
    schema_version: 1,
    mode: "permissive",
    cache_hit: false,
    iterations_attempted: 1,
    ...provenanceOverrides,
  }
  return { theory, provenance }
}

describe("createSubmitDeliberationTool", () => {
  it("#when no theory provided and no Formalizer service wired #then returns formalization_failed with instructions", async () => {
    const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp" })
    const result = await tool.execute(buildArgs("no-theory-test"), toolContext)
    const parsed = JSON.parse(result)

    expect(parsed.verdict).toBe("formalization_failed")
    expect(parsed.rationale.includes("subagent_type")).toBe(true)
    expect(parsed.rationale.includes("formalizer")).toBe(true)
    expect(parsed.rationale.includes("mcp_task")).toBe(false)
    expect(parsed.rationale.includes("task(subagent_type='formalizer'")).toBe(true)
    expect(parsed.bundle).toBe(null)
  })

  it("#when no theory provided but formalizationService is wired #then service is invoked and verdict produced", async () => {
    const mockArgue = mock(async () => ({
      extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
      conclusions: { select_option_a: { status: "Accepted", proof_chain: [] } },
      semantics: "preferred",
    }))
    const mockFormalize = mock(async () => buildFormalizationResult(undefined, { iterations_attempted: 2, cache_hit: false }))
    const formalizationService: SemanticFormalizationService = { formalize: mockFormalize }

    const tool = createSubmitDeliberationTool({
      workspaceRoot: "/tmp",
      client: { argue: mockArgue } as any,
      formalizationService,
    })

    const result = await tool.execute(buildArgs("auto-formalize-success-test"), toolContext)
    const parsed = JSON.parse(result)

    expect(mockFormalize).toHaveBeenCalledTimes(1)
    const formalizeCall = (mockFormalize.mock.calls as unknown as Array<unknown[]>)[0]?.[0] as { problem_statement?: string; options?: string[] } | undefined
    expect(formalizeCall?.problem_statement).toBe("Test deliberation")
    expect(formalizeCall?.options).toEqual(["Option A", "Option B"])
    expect(parsed.verdict === "formalization_failed").toBe(false)
    expect(parsed.provenance.formalization.iterations_attempted).toBe(2)
    expect(parsed.provenance.formalization.model_id).toBe("stub-formalizer")
    expect(parsed.provenance.formalization.cache_hit).toBe(false)
  })

  it("#when formalizationService throws FormalizationError #then returns formalization_failed with error_code", async () => {
    const mockFormalize = mock(async () => {
      throw new FormalizationError({ code: "theory_invalid", message: "Quality unacceptable" })
    })
    const formalizationService: SemanticFormalizationService = { formalize: mockFormalize }

    const tool = createSubmitDeliberationTool({
      workspaceRoot: "/tmp",
      client: { argue: mock(async () => ({})) } as any,
      formalizationService,
    })

    const result = await tool.execute(buildArgs("auto-formalize-fail-test"), toolContext)
    const parsed = JSON.parse(result)

    expect(mockFormalize).toHaveBeenCalledTimes(1)
    expect(parsed.verdict).toBe("formalization_failed")
    expect(parsed.formalization.error_code).toBe("theory_invalid")
    expect(parsed.rationale.includes("theory_invalid")).toBe(true)
    expect(parsed.rationale.includes("Quality unacceptable")).toBe(true)
    expect(parsed.bundle).toBe(null)
  })

  it("#when formalizationService throws non-FormalizationError #then defaults to provider_failure error_code", async () => {
    const mockFormalize = mock(async () => {
      throw new Error("Network glitch")
    })
    const formalizationService: SemanticFormalizationService = { formalize: mockFormalize }

    const tool = createSubmitDeliberationTool({
      workspaceRoot: "/tmp",
      client: { argue: mock(async () => ({})) } as any,
      formalizationService,
    })

    const result = await tool.execute(buildArgs("auto-formalize-generic-fail-test"), toolContext)
    const parsed = JSON.parse(result)

    expect(mockFormalize).toHaveBeenCalledTimes(1)
    expect(parsed.verdict).toBe("formalization_failed")
    expect(parsed.formalization.error_code).toBe("provider_failure")
    expect(parsed.rationale.includes("Network glitch")).toBe(true)
  })

  it("#when theory provided #then passes to solver and returns deliberation response", async () => {
    const mockArgue = mock(async () => ({
      extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
      conclusions: { select_option_a: { status: "Accepted", proof_chain: [] } },
      semantics: "preferred",
    }))

    const tool = createSubmitDeliberationTool({
      workspaceRoot: "/tmp",
      client: { argue: mockArgue } as any,
    })

    const result = await tool.execute(buildArgs("theory-test", MINIMAL_THEORY), toolContext)
    const parsed = JSON.parse(result)

    expect(mockArgue).toHaveBeenCalledTimes(5)
    expect(parsed.verdict === undefined).toBe(false)
    expect(parsed.semantics_comparison).toEqual({
      grounded_set: ["select_option_a"],
      preferred_extensions: [["select_option_a"]],
      stable_extensions: [["select_option_a"]],
      complete_extensions: [["select_option_a"]],
      certainty_gradient: {
        certain: ["select_option_a"],
        defensible: [],
        contested: [],
      },
    })
    expect(parsed.provenance.formalization === undefined).toBe(false)
    expect(parsed.provenance.formalization.iterations_attempted).toBe(0)
  })

  describe("#given solve is available", () => {
    const SOLVE_OUTCOME: ReasoningCoreSolveOutcome = {
      stop_signal: "converged",
      argumentation_result: {
        conclusions: { select_option_a: { status: "Accepted" } },
      },
      constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
      iterations_used: 3,
      reasoning_trace: [{ step: "init" }, { step: "propagate" }, { step: "converge" }],
    }

    it("#when theory provided #then uses solve as primary path", async () => {
      const mockSolve = mock(async () => SOLVE_OUTCOME)
      const mockArgue = mock(async () => ({}))
      const args = buildArgs("solve-primary-test", MINIMAL_THEORY, {
        context: "Need a deterministic choice.",
        constraints: ["must preserve safety", "must minimize risk"],
      })

      const tool = createSubmitDeliberationTool({
        workspaceRoot: "/tmp",
        client: { solve: mockSolve, argue: mockArgue } as any,
      })

      const result = await tool.execute(args, toolContext)
      const parsed = JSON.parse(result)
      const solveProblem = ((mockSolve.mock.calls as unknown) as Array<unknown[]>)[0]?.[0]

      expect(mockSolve).toHaveBeenCalledTimes(1)
      expect(solveProblem).toEqual({
        description: [
          "Test deliberation",
          "Context: Need a deterministic choice.",
          "Options:",
          "- Option A",
          "- Option B",
          "Constraints:",
          "- must preserve safety",
          "- must minimize risk",
        ].join("\n"),
        variables: [
          { name: "option_0_selected", domain: [0, 1] },
          { name: "option_1_selected", domain: [0, 1] },
          { name: "constraint_0_satisfied", domain: [0, 1] },
          { name: "constraint_1_satisfied", domain: [0, 1] },
        ],
        initial_constraints: [
          { constraint: { Equals: { variable: "constraint_0_satisfied", value: 1 } }, question: "must preserve safety" },
          { constraint: { Equals: { variable: "constraint_1_satisfied", value: 1 } }, question: "must minimize risk" },
        ],
        incremental_constraints: [],
        max_iterations: 3,
        theory: {
          premises: [{ formula: "problem(current)", kind: "ordinary" }],
          strict_rules: [],
          defeasible_rules: [
            { id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" },
          ],
          preferences: [],
          classical_negation: true,
        },
      })
      expect(mockArgue).toHaveBeenCalledTimes(4)
      expect(parsed.verdict === undefined).toBe(false)
      expect(parsed.provenance.iterations).toBe(3)
    })

    it("#when solve succeeds #then attaches metacognition to provenance", async () => {
      const mockSolve = mock(async () => ({
        ...SOLVE_OUTCOME,
        constraint_state: {
          domains: {
            option_0_selected: [1],
            option_1_selected: [0],
          },
          solved: true,
          solved_count: 2,
          total_count: 2,
        },
      }))

      const tool = createSubmitDeliberationTool({
        workspaceRoot: "/tmp",
        client: { solve: mockSolve, argue: mock(async () => ({})) } as any,
      })

      const result = await tool.execute(buildArgs("solve-meta-test", MINIMAL_THEORY), toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.provenance.solve_metacognition === undefined).toBe(false)
      expect(parsed.provenance.solve_metacognition.stop_signal).toBe("converged")
      expect(parsed.provenance.solve_metacognition.iterations_used).toBe(3)
      expect(parsed.provenance.solve_metacognition.converged).toBe(true)
      expect(parsed.provenance.solve_metacognition.domain_reduction_rate).toBe(0.5)
      expect(parsed.provenance.solve_metacognition.domains_solved).toBe(2)
      expect(parsed.provenance.solve_metacognition.domains_total).toBe(2)
      expect(parsed.provenance.solve_metacognition.constraint_solved).toBe(true)
      expect(parsed.provenance.solve_metacognition.reasoning_trace_length).toBe(3)
    })
  })

  describe("#given solve fails", () => {
    it("#when solve throws #then falls back to argue", async () => {
      const mockSolve = mock(async () => { throw new Error("solve unavailable") })
      const mockArgue = mock(async () => ({
        extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
        conclusions: { select_option_a: { status: "Accepted", proof_chain: [] } },
        semantics: "preferred",
      }))

      const tool = createSubmitDeliberationTool({
        workspaceRoot: "/tmp",
        client: { solve: mockSolve, argue: mockArgue } as any,
      })

      const result = await tool.execute(buildArgs("solve-fallback-test", MINIMAL_THEORY), toolContext)
      const parsed = JSON.parse(result)

      expect(mockSolve).toHaveBeenCalledTimes(1)
      expect(mockArgue).toHaveBeenCalledTimes(5)
      expect(parsed.verdict === undefined).toBe(false)
      expect(parsed.provenance.solve_metacognition).toBeUndefined()
    })
  })

  describe("#given formalized theory preferences", () => {
    it("#when preferences form a cycle #then response surfaces circuit breaker metadata", async () => {
      const tool = createSubmitDeliberationTool({
        workspaceRoot: "/tmp",
        client: { argue: mock(async () => ({ semantics: "preferred" })) } as any,
      })

      const result = await tool.execute(buildArgs("cycle-test", CYCLIC_PREFERENCE_THEORY), toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.preference_cycle_detected).toBe(true)
      expect(parsed.preference_cycle_path).toEqual(["A", "B", "C", "A"])
    })

    it("#when preferences are acyclic #then response reports no circuit breaker activation", async () => {
      const tool = createSubmitDeliberationTool({
        workspaceRoot: "/tmp",
        client: { argue: mock(async () => ({ semantics: "preferred" })) } as any,
      })

      const result = await tool.execute(buildArgs("acyclic-test", ACYCLIC_PREFERENCE_THEORY), toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.preference_cycle_detected).toBe(false)
      expect(parsed.preference_cycle_path).toEqual([])
    })
  })

  describe("#given theory contains @value tags", () => {
    it("#when submit deliberation runs #then response includes audience_analysis", async () => {
      const mockArgue = mock(async ({ theory }: { theory: { preferences?: Array<{ superior: string; inferior: string }> } }) => {
        const firstPreference = theory.preferences?.[0]
        const selectsSafety = firstPreference?.superior === "rule_safety"

        return {
          extensions: [{
            index: 0,
            accepted_conclusions: [selectsSafety ? "select_option_b" : "select_option_a"],
          }],
          conclusions: {
            [selectsSafety ? "select_option_b" : "select_option_a"]: { status: "Accepted", proof_chain: [] },
          },
          semantics: "preferred",
        }
      })

      const tool = createSubmitDeliberationTool({
        workspaceRoot: "/tmp",
        client: { argue: mockArgue } as any,
      })

      const result = await tool.execute(buildArgs("value-tags-test", VALUE_TAGGED_THEORY, {
        problem_statement: "Choose the safest treatment path for a hospital patient.",
      }), toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.audience_analysis === undefined).toBe(false)
      expect(parsed.audience_analysis.consensus).toBe("majority")
      expect(parsed.audience_analysis.per_audience.healthcare_clinician.selected_option).toBe("select_option_b")
      expect(parsed.audience_analysis.per_audience.autonomy_maximizer.selected_option).toBe("select_option_a")
      expect(parsed.audience_analysis.per_audience.risk_averse.selected_option).toBe("select_option_b")
    })
  })
})
