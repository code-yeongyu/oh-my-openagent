/// <reference path="../bun-test.d.ts" />

import { describe, expect, it, mock } from "bun:test"
import type { ReasoningCoreClient } from "../reasoning-core-client"
import type { AudienceDefinition } from "./audience-categories"
import type { VafTheory } from "./values-schema"
import { solveValueBasedArgumentation } from "./vaf-solver"

const VALUE_THEORY: VafTheory = {
  premises: [{ formula: "case(patient) @value:safety", kind: "ordinary" }],
  strict_rules: [],
  defeasible_rules: [
    { id: "rule_autonomy", antecedents: ["case(patient)"], consequent: "select_option_a @value:autonomy" },
    { id: "rule_safety", antecedents: ["case(patient)"], consequent: "select_option_b @value:safety" },
  ],
  preferences: [{ superior: "legacy_rule", inferior: "fallback_rule" }],
  classical_negation: true,
}

const AUDIENCES: AudienceDefinition[] = [
  {
    id: "healthcare_clinician",
    label: "Healthcare Clinician",
    category: "domain-specific",
    domains: ["healthcare"],
    value_ordering: ["safety", "beneficence", "autonomy"],
  },
  {
    id: "autonomy_maximizer",
    label: "Autonomy Maximizer",
    category: "universal",
    value_ordering: ["autonomy", "dignity", "safety"],
  },
  {
    id: "risk_averse",
    label: "Risk Averse",
    category: "universal",
    value_ordering: ["safety", "justice", "autonomy"],
  },
]

function createClient(argue: NonNullable<ReasoningCoreClient["argue"]>): ReasoningCoreClient {
  return {
    argue,
    evaluate: mock(async () => ({ allow: true })),
    solve: mock(async () => ({
      stop_signal: "converged",
      constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
      iterations_used: 1,
      reasoning_trace: [],
    })),
    constrain: mock(async () => ({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
    kbQuery: mock(async () => ({ count: 0, entries: [] })),
    kbAdd: mock(async () => ({ id: "kb-1" })),
    kbRemove: mock(async () => undefined),
    check: mock(async () => ({ signal: "continue", iteration: 0, reason: "" })),
    status: mock(async () => ({ session_active: false, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
  }
}

describe("solveValueBasedArgumentation", () => {
  it("#when audiences prefer different values #then overrides rule preferences per audience and reports majority consensus", async () => {
    const mockArgue = mock(async ({ theory }: { theory: { preferences?: Array<{ superior: string; inferior: string }> } }) => {
      const firstPreference = theory.preferences?.[0]
      const choosesSafety = firstPreference?.superior === "rule_safety"

      return {
        semantics: "preferred",
        extensions: [{
          index: 0,
          accepted_conclusions: [choosesSafety ? "select_option_b" : "select_option_a"],
        }],
        conclusions: {},
      }
    })

    const analysis = await solveValueBasedArgumentation({
      client: createClient(mockArgue),
      theory: VALUE_THEORY,
      requestedSemantics: "preferred",
      audiences: AUDIENCES,
    })

    expect(mockArgue).toHaveBeenCalledTimes(3)
    expect(mockArgue.mock.calls[0]?.[0]?.theory.preferences?.some((preference: { superior: string; inferior: string }) => {
      return preference.superior === "rule_safety" && preference.inferior === "rule_autonomy"
    })).toBe(true)
    expect(mockArgue.mock.calls[1]?.[0]?.theory.preferences?.some((preference: { superior: string; inferior: string }) => {
      return preference.superior === "rule_autonomy" && preference.inferior === "rule_safety"
    })).toBe(true)
    expect(analysis.consensus).toBe("majority")
    expect(analysis.per_audience.healthcare_clinician?.selected_option).toBe("select_option_b")
    expect(analysis.per_audience.autonomy_maximizer?.selected_option).toBe("select_option_a")
    expect(analysis.per_audience.risk_averse?.selected_option).toBe("select_option_b")
  })

  it("#when an audience solve rejects #then Promise.allSettled preserves remaining analyses", async () => {
    const mockArgue = mock(async ({ theory }: { theory: { preferences?: Array<{ superior: string; inferior: string }> } }) => {
      const firstPreference = theory.preferences?.[0]
      if (firstPreference?.superior === "rule_autonomy") {
        throw new Error("autonomy audience failed")
      }

      return {
        semantics: "preferred",
        extensions: [{ index: 0, accepted_conclusions: ["select_option_b"] }],
        conclusions: {},
      }
    })

    const analysis = await solveValueBasedArgumentation({
      client: createClient(mockArgue),
      theory: VALUE_THEORY,
      requestedSemantics: "preferred",
      audiences: AUDIENCES,
    })

    expect(analysis.audiences.length).toBe(3)
    expect(analysis.per_audience.autonomy_maximizer?.verdict).toBe("analysis_failed")
    expect(analysis.per_audience.autonomy_maximizer?.selected_option).toBeUndefined()
    expect(analysis.consensus).toBe("unanimous")
  })
})
