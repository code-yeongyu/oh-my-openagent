/// <reference path="./bun-test.d.ts" />

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { createSubmitDeliberationTool } from "../../tools/submit-deliberation/tool"
import type { DeliberationResponse } from "../../agents/themis/types"
import type { DeliberationRoundResult } from "../../tools/submit-deliberation/deliberation-round"
import type { maybeApplyAgmRevision } from "../../tools/submit-deliberation/agm-revision-fallback"
import type { ReasoningCoreClient } from "./reasoning-core-client"

const { describe, expect, it, mock } = require("bun:test")

const MINIMAL_THEORY = JSON.stringify({ premises: [{ formula: "problem(current)", kind: "ordinary" }], strict_rules: [], defeasible_rules: [{ id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" }], preferences: [], classical_negation: true })
const VALUE_THEORY = JSON.stringify({ premises: [{ formula: "patient(case_1) @value:safety", kind: "ordinary" }], strict_rules: [], defeasible_rules: [{ id: "rule_autonomy", antecedents: ["patient(case_1)"], consequent: "select_option_a @value:autonomy" }, { id: "rule_safety", antecedents: ["patient(case_1)"], consequent: "select_option_b @value:safety" }], preferences: [], classical_negation: true })
const CYCLIC_THEORY = JSON.stringify({ premises: [{ formula: "problem(current)", kind: "ordinary" }], strict_rules: [], defeasible_rules: [{ id: "d1", antecedents: ["problem(current)"], consequent: "select_option_a" }], preferences: [{ superior: "A", inferior: "B" }, { superior: "B", inferior: "C" }, { superior: "C", inferior: "A" }], classical_negation: true })
const AGM_THEORY = JSON.stringify({ premises: [{ formula: "policy_required", kind: "axiom" }, { formula: "fallback_candidate", kind: "assumption" }], strict_rules: [], defeasible_rules: [{ id: "d1", antecedents: ["policy_required"], consequent: "select_option_a" }], preferences: [], classical_negation: true })
type IntegrationResponse = DeliberationResponse & { formalization?: unknown; provenance: DeliberationResponse["provenance"] & { formalization?: unknown; solve_metacognition?: unknown }; semantics_comparison?: { grounded_set: string[]; preferred_extensions: string[][]; stable_extensions: string[][]; complete_extensions: string[][]; certainty_gradient: { certain: string[]; defensible: string[]; contested: string[] } }; audience_analysis?: unknown; epistemic_analysis?: unknown; convergence?: string; preference_cycle_detected?: boolean; preference_cycle_path?: string[]; voi_analysis?: { result: { deferRecommended: boolean } }; confidence?: { framework_certainty: number; world_certainty: number }; revised_premises?: string[] }
const ORACLE_THEORY = readFileSync(fileURLToPath(new URL("../../../test/fixtures/themis/mnemosyne-m07/oracle-theory.json", import.meta.url)), "utf8")
const toolContext: ToolContext = { sessionID: "integration-session", messageID: "integration-message", agent: "themis", directory: "/tmp", worktree: "/tmp", abort: new AbortController().signal, metadata: mock(() => {}), ask: async () => {} }

function createClient(overrides: Partial<ReasoningCoreClient> = {}): ReasoningCoreClient {
  return { argue: mock(async () => ({ extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }], conclusions: { select_option_a: { status: "Accepted", proof_chain: [] } }, semantics: "preferred" })), evaluate: mock(async () => ({ allow: true })), solve: mock(async () => ({ stop_signal: "Solved", argumentation_result: { conclusions: { select_option_a: { status: "Accepted" } } }, constraint_state: { domains: { option_0_selected: [1], option_1_selected: [0] }, solved: true, solved_count: 2, total_count: 2 }, iterations_used: 3, reasoning_trace: [{ step: "init" }, { step: "solve" }] })), constrain: mock(async () => ({ domains: {}, solved: false, solved_count: 0, total_count: 0 })), kbQuery: mock(async () => ({ count: 1, entries: [{ content: { Insight: { lesson: "Prefer the option with fewer policy conflicts.", example: "Option A preserved the audit trail." } } }] })), kbAdd: mock(async () => ({ id: "kb-1" })), kbRemove: mock(async () => {}), check: mock(async () => ({ signal: "Solved", iteration: 3, reason: "solution found" })), status: mock(async () => ({ session_active: false, domains: {}, is_solved: false, reasoning_history: [] })), disposeSession: mock(() => {}), disposeAll: mock(() => {}), dispose: mock(() => {}), ...overrides }
}

function buildResponse(overrides: Partial<DeliberationResponse> = {}): DeliberationResponse {
  return { verdict: "selected", rationale: "Selected option deploy_backup_generators is in the grounded set with no preference cycles, high framework confidence, medium world confidence, and converged reasoning. No revision needed.", proof_chain: [{ conclusion: "select_option_a", from: ["problem(current)"], rule_id: "d1", rule_kind: "defeasible" }], sidecar_trace: {}, provenance: { semantics: "preferred", iterations: 3, timestamp: new Date().toISOString(), input_request: { id: "integration", timestamp: new Date().toISOString(), problem_statement: "Choose a rollout policy.", options: ["Option A", "Option B"], constraints: [], preferences: [], requested_semantics: "preferred" } }, bundle: { selected_option: "Option A", burdens: ["harm:patient_autonomy_loss"], mitigations: ["mitigation:obtain_two_signoffs"], guardrails: ["Represent require_review_board explicitly before implementation"] }, confidence: { framework_certainty: 0.85, world_certainty: 0.55 }, repair_humility: "Selected option deploy_backup_generators is in the grounded set with no preference cycles, high framework confidence, medium world confidence, and converged reasoning. No revision needed.", voi_analysis: { result: { score: 0.2, deferRecommended: false, recourseLevel: "reversible", reasons: [] } }, ...overrides }
}

function buildRound(response: Partial<DeliberationResponse> = {}, round: Partial<DeliberationRoundResult> = {}): DeliberationRoundResult {
  return { response: buildResponse(response), convergence: { convergence: "converged", verdict: "selected" }, preferenceCycle: { detected: false, path: [] }, semanticsComparison: { grounded_set: ["select_option_a"], preferred_extensions: [["select_option_a"], ["select_option_b"]], stable_extensions: [["select_option_a"]], complete_extensions: [["select_option_a"], ["select_option_b"]], certainty_gradient: { certain: ["select_option_a"], defensible: ["select_option_b"], contested: [] } }, audienceAnalysis: { consensus: "majority", audiences: [{ audience_id: "healthcare_clinician", audience_label: "Healthcare clinician", value_ordering: ["@value:safety"], selected_option: "select_option_b", verdict: "selected" }], per_audience: { healthcare_clinician: { audience_id: "healthcare_clinician", audience_label: "Healthcare clinician", value_ordering: ["@value:safety"], selected_option: "select_option_b", verdict: "selected" } } }, epistemicAnalysis: { piano_a: { select_option_a: "plausibile" }, piano_b: { select_option_a: 0.87 }, piano_c: { etico: { deontological: { select_option_a: 1 }, consequentialist: { select_option_a: 0.8 }, virtue_ethics: { select_option_a: 0.8 } }, morale: { select_option_a: { score: 0.8, label: "giustificabile", contesto_sociale: "general", comprensione_destinatari: "high", impatto_cascata: 0.2, intenzione: "benevola", trasparenza: 0.9, fiducia_risultante: 0.8, reason: "socially_acceptable" } }, pragmatico: { select_option_a: { score: 0.7, label: "conveniente", beneficio_proprio: 0.7, beneficio_controparte: 0.6, costo_proprio: 0.1, costo_controparte: 0.2, pesatura: { proprio: 0.6, controparte: 0.4 } } } }, piano_d: { synthesis: "Dominant conclusion: select_option_a (margin 1.0000).", dominant_conclusion: "select_option_a", confidence: 0.85 } }, solveMetacognition: { stop_signal: "Solved", iterations_used: 3, converged: true, domain_reduction_rate: 0.5, domains_solved: 2, domains_total: 2, constraint_solved: true, reasoning_trace_length: 2 }, ...round }
}

async function execute(theory: string, runRound: DeliberationRoundResult | ((input: { theory: { premises: Array<{ formula: string; kind?: string }> }; request: DeliberationResponse["provenance"]["input_request"] }) => Promise<DeliberationRoundResult>), client = createClient(), applyAgmRevision?: typeof maybeApplyAgmRevision) {
  const tool = createSubmitDeliberationTool({ workspaceRoot: "/tmp", client, runRound: typeof runRound === "function" ? runRound : mock(async () => runRound), ...(applyAgmRevision ? { applyAgmRevision } : {}) })
  return { client, parsed: JSON.parse(await tool.execute({ id: "integration", timestamp: new Date().toISOString(), problem_statement: "Choose the safest rollout policy for a hospital patient.", options: ["Option A", "Option B"], constraints: ["Must remain compliant"], preferences: [], requested_semantics: "preferred", theory }, toolContext)) as IntegrationResponse }
}

describe("reasoning-core policy gate integration", () => {
  it("#given a mocked pipeline #when deliberation succeeds #then all enriched response fields are populated", async () => {
    const { parsed } = await execute(VALUE_THEORY, buildRound())
    expect(parsed.formalization === undefined).toBe(false); expect(parsed.provenance.formalization === undefined).toBe(false); expect(parsed.provenance.solve_metacognition === undefined).toBe(false); expect(parsed.semantics_comparison === undefined).toBe(false); expect(parsed.audience_analysis === undefined).toBe(false); expect(parsed.epistemic_analysis === undefined).toBe(false); expect(parsed.confidence).toEqual({ framework_certainty: 0.85, world_certainty: 0.55 }); expect(parsed.convergence).toBe("converged"); expect(String(parsed.repair_humility).includes("grounded set")).toBe(true); expect(parsed.bundle === undefined).toBe(false)
  })

  it("#given mocked semantics comparison #when deliberation completes #then four semantics extension sets are preserved", async () => {
    const { parsed } = await execute(MINIMAL_THEORY, buildRound())
    expect(parsed.semantics_comparison).toEqual({ grounded_set: ["select_option_a"], preferred_extensions: [["select_option_a"], ["select_option_b"]], stable_extensions: [["select_option_a"]], complete_extensions: [["select_option_a"], ["select_option_b"]], certainty_gradient: { certain: ["select_option_a"], defensible: ["select_option_b"], contested: [] } })
  })

  it("#given KB-backed context #when tool runs #then it retrieves and stores patterns", async () => {
    const client = createClient(); const { parsed } = await execute(MINIMAL_THEORY, async ({ request }) => buildRound({ provenance: { ...buildResponse().provenance, input_request: request } }), client)
    expect(client.kbQuery).toHaveBeenCalledTimes(1); expect(client.kbAdd).toHaveBeenCalledTimes(1); expect(String(parsed.provenance.input_request.context).includes("Relevant KB context")).toBe(true); expect(String(parsed.provenance.input_request.context).includes("Prefer the option with fewer policy conflicts")).toBe(true)
  })

  it("#given cyclic preferences #when the round reports a cycle #then the response surfaces the circuit breaker path", async () => {
    const { parsed } = await execute(CYCLIC_THEORY, buildRound({}, { preferenceCycle: { detected: true, path: ["A", "B", "C", "A"] } }))
    expect(parsed.preference_cycle_detected).toBe(true); expect(parsed.preference_cycle_path).toEqual(["A", "B", "C", "A"])
  })

  it("#given VOI recommends deferral #when the response is serialized #then the verdict stays defer_recommended", async () => {
    const { parsed } = await execute(MINIMAL_THEORY, buildRound({ verdict: "defer_recommended", voi_analysis: { result: { score: 0.74, deferRecommended: true, recourseLevel: "irreversible", reasons: ["high_information_value_before_commitment"] } } }))
    expect(parsed.verdict).toBe("defer_recommended"); expect(parsed.voi_analysis?.result.deferRecommended).toBe(true)
  })

  it("#given sidecar certainty scores #when the response is serialized #then confidence scores are populated", async () => {
    const { parsed } = await execute(MINIMAL_THEORY, buildRound())
    expect(parsed.confidence).toEqual({ framework_certainty: 0.85, world_certainty: 0.55 })
  })

  it("#given epistemic annotations #when the response is serialized #then planes A through D are exposed", async () => {
    const { parsed } = await execute(MINIMAL_THEORY, buildRound())
    expect(parsed.epistemic_analysis).toEqual(buildRound().epistemicAnalysis)
  })

  it("#given sidecar-enriched bundle data #when the response is serialized #then burdens mitigations and guardrails are preserved", async () => {
    const { parsed } = await execute(MINIMAL_THEORY, buildRound())
    expect(parsed.bundle).toEqual({ selected_option: "Option A", burdens: ["harm:patient_autonomy_loss"], mitigations: ["mitigation:obtain_two_signoffs"], guardrails: ["Represent require_review_board explicitly before implementation"] })
  })

  it("#given a computed humility diagnosis #when the response is serialized #then repair humility exposes that diagnosis", async () => {
    const { parsed } = await execute(MINIMAL_THEORY, buildRound())
    expect(parsed.repair_humility).toBe("Selected option deploy_backup_generators is in the grounded set with no preference cycles, high framework confidence, medium world confidence, and converged reasoning. No revision needed.")
  })

  it("#given convergence fails on an assumption #when AGM revision contracts it #then the response converges after revision", async () => {
    const runRound = mock(async ({ theory }: { theory: { premises: Array<{ formula: string }> } }) => theory.premises.some((premise) => premise.formula === "fallback_candidate") ? buildRound({ verdict: "unable_to_converge" }, { convergence: { convergence: "unable_to_converge", verdict: "unable_to_converge" } }) : buildRound({ verdict: "selected", rationale: "Recovered after revision." }))
    const { parsed } = await execute(AGM_THEORY, runRound)
    expect(parsed.verdict).toBe("converged_after_revision"); expect(parsed.rationale).toBe("Recovered after revision."); expect(parsed.revised_premises).toEqual(["fallback_candidate"])
  })

  it("#given the MNEMOSYNE oracle theory #when it flows through the mocked suite #then all 14 plus 9 regression criteria pass", async () => {
    const oracleChecks: Record<string, boolean> = {}
    const { parsed } = await execute(ORACLE_THEORY, async ({ theory }) => { const dF = (theory as unknown as { defeasible_rules: Array<{ id: string; antecedents: string[]; consequent: string }>; strict_rules: Array<{ consequent: string }>; premises: Array<{ formula: string }> }).defeasible_rules.find((rule) => rule.id === "d-option-f")
      Object.assign(oracleChecks, { c1: theory.premises.some((premise) => premise.formula.includes("@option:option_a")), c2: theory.premises.some((premise) => premise.formula.includes("@option:option_f")), c3: (theory as unknown as { strict_rules: Array<{ consequent: string }> }).strict_rules.filter((rule) => rule.consequent.startsWith("-select(")).length >= 7, c4: !(theory as unknown as { strict_rules: Array<{ consequent: string }> }).strict_rules.some((rule) => rule.consequent === "-select(option_f)"), c5: dF?.consequent === "select(option_f)", c6: JSON.stringify((theory as unknown as { defeasible_rules: Array<{ id: string; antecedents: string[] }> }).defeasible_rules.find((rule) => rule.id === "d-option-a")?.antecedents) !== JSON.stringify(dF?.antecedents) })
      return buildRound({ verdict: "selected", rationale: "Option F remains uniquely justified.", bundle: { selected_option: "Option F public disclosure releasing emergent behavior findings conflict of interest finding and unresolved identity question", burdens: [], mitigations: [], guardrails: [] }, proof_chain: [{ conclusion: "select(option_f)", from: ["p1"], rule_id: "d-option-f", rule_kind: "defeasible" }] }, { semanticsComparison: { grounded_set: ["select(option_f)"], preferred_extensions: [["select(option_f)"]], stable_extensions: [["select(option_f)"]], complete_extensions: [["select(option_f)"]], certainty_gradient: { certain: ["select(option_f)"], defensible: [], contested: [] } } }) })
    const responseChecks = { c7: parsed.verdict === "selected", c8: String(parsed.bundle?.selected_option).toLowerCase().includes("option f"), c9: parsed.rationale !== "No unresolved structural gaps detected.", c10: parsed.formalization !== undefined, c11: parsed.provenance.formalization !== undefined, c12: parsed.semantics_comparison?.grounded_set[0] === "select(option_f)", c13: parsed.semantics_comparison?.preferred_extensions.length === 1, c14: parsed.semantics_comparison?.stable_extensions.length === 1, c15: parsed.semantics_comparison?.complete_extensions.length === 1, c16: parsed.preference_cycle_detected === false, c17: parsed.confidence?.framework_certainty === 0.85, c18: parsed.confidence?.world_certainty === 0.55, c19: Array.isArray(parsed.proof_chain), c20: parsed.bundle?.burdens?.length === 0, c21: parsed.bundle?.mitigations?.length === 0, c22: parsed.bundle?.guardrails?.length === 0, c23: parsed.repair_humility !== undefined }
    expect(Object.keys({ ...oracleChecks, ...responseChecks }).length).toBe(23); expect(Object.values({ ...oracleChecks, ...responseChecks }).every(Boolean)).toBe(true)
  })
})
