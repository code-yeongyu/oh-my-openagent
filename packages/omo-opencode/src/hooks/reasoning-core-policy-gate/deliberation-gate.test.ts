import { afterEach, describe, expect, it, mock } from "bun:test"
import type { SidecarOutput } from "../consequence-lifting-sidecar"
import { DeliberationResponseSchema } from "../../agents/themis/types"
import { createDeliberationGateHook } from "./deliberation-gate"
import type { ReasoningCoreClient } from "./reasoning-core-client"
import type { FormalizationRequest, FormalizationResult, Theory } from "./semantic-formalization-service"

async function importFreshDeliberationGate() {
  const modulePath = `${new URL("./deliberation-gate.ts", import.meta.url).pathname}?t=${Date.now()}-${Math.random()}`
  return import(modulePath)
}

function createMockClient(argueResult: unknown): ReasoningCoreClient {
  return {
    argue: mock(() => Promise.resolve(argueResult)),
    evaluate: mock(() => Promise.resolve({ allow: true })),
    solve: mock(() => Promise.resolve({ stop_signal: "Solved", constraint_state: { domains: {}, solved: true, solved_count: 0, total_count: 0 }, iterations_used: 1, reasoning_trace: [] })),
    constrain: mock(() => Promise.resolve({ domains: {}, solved: false, solved_count: 0, total_count: 0 })),
    kbQuery: mock(() => Promise.resolve({ count: 0, entries: [] })),
    kbAdd: mock(() => Promise.resolve({ id: "kb_test_123" })),
    kbRemove: mock(() => Promise.resolve()),
    check: mock(() => Promise.resolve({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(() => Promise.resolve({ session_active: true, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
  }
}

function buildArgueResult(extensions = [{ index: 0, accepted_conclusions: ["select_ship_it"] }]): unknown {
  return {
    result: {
      semantics: "preferred",
      extensions,
      conclusions: {
        select_ship_it: {
          status: "Accepted",
          proof_chain: [{ conclusion: "select_ship_it", from: ["problem"], rule_id: "d-option-0", rule_kind: "defeasible" }],
        },
      },
    },
  }
}

function buildSidecarOutput(summary: string, selected = true): SidecarOutput {
  return {
    policies: selected ? [{
      primaryDecision: "select_ship_it",
      requiredConditions: ["verify_budget"],
      requiredMitigations: ["mandatory_monitor_costs"],
      alternativesConsidered: [],
      residualRisks: ["risk_scope_creep"],
      profile: {
        decision: "select_ship_it",
        coreStatus: "accepted",
        coreCombined: 0.91,
        forwardBurdens: [{ conclusion: "risk_scope_creep", liftStrength: "medium_lift", epistemicState: "residual_live_risk", normativeTag: "cost", mitigationStatus: "partially_mitigated", mitigatedBy: ["mandatory_monitor_costs"] }],
        forwardBenefits: [],
        mitigations: [{ mitigation: "mandatory_monitor_costs", targetBurden: "risk_scope_creep", effectiveness: "partially_mitigated", required: true }],
        requiredConditions: ["verify_budget"],
        policyStatus: "core_accepted_selectable",
        qualifiers: [],
      },
    }] : [],
    profiles: [],
    graph: { decisions: selected ? ["select_ship_it"] : [], edges: [] },
    bundle: { bundle: { slots: [], constraints: [] }, selection: { selectedBySlot: selected ? { primary_decision: ["select_ship_it"] } : {}, excluded: [] } },
    catastrophic: { classifications: [] },
    contamination: { results: [] },
    humility: { report: { capacity: selected ? "repairable" : "irreparable", escalationReasons: selected ? [] : [{ code: "no_selectable_bundle", message: summary }], summary } },
  }
}

function buildRequest(requestedSemantics: "grounded" | "preferred" | "stable" | "complete" = "preferred"): string {
  return JSON.stringify({
    id: "delib-1",
    timestamp: "2026-04-10T00:00:00.000Z",
    problem_statement: "Choose an implementation strategy",
    options: ["Ship it"],
    constraints: ["verify_budget"],
    preferences: [{ superior: "d-option-0", inferior: "d-option-1" }],
    requested_semantics: requestedSemantics,
  }, null, 2)
}

function buildRequestObject(requestedSemantics: "grounded" | "preferred" | "stable" | "complete" = "preferred") {
  return {
    id: "delib-1",
    timestamp: "2026-04-10T00:00:00.000Z",
    problem_statement: "Choose an implementation strategy",
    options: ["Ship it"],
    constraints: ["verify_budget"],
    preferences: [{ superior: "d-option-0", inferior: "d-option-1" }],
    requested_semantics: requestedSemantics,
  }
}

function buildTheory(): Theory {
  return {
    premises: [{ formula: "problem(current)", kind: "ordinary" }],
    strict_rules: [{ id: "s-constraint-0", antecedents: ["problem(current)"], consequent: "require_verify_budget" }],
    defeasible_rules: [{ id: "d-option-0", antecedents: ["problem(current)", "require_verify_budget"], consequent: "select_ship_it" }],
    preferences: [],
    classical_negation: true,
  }
}

afterEach(() => {
  mock.restore()
})

describe("deliberation-gate", () => {
  describe("#given matching deliberation writes", () => {
    it("#when a semantic formalization service is injected #then provenance flows through and the legacy formalizer remains unused", async () => {
      const request = buildRequestObject()
      const theory = buildTheory()
      const oldFormalizer = mock(() => ({ request, theory, optionMap: new Map<string, string>([["select_ship_it", "Ship it"]]) }))
      const semanticFormalize = mock((formalizationRequest: FormalizationRequest): Promise<FormalizationResult> => {
        expect(formalizationRequest.problem_statement).toBe(request.problem_statement)

        return Promise.resolve({
          theory,
          provenance: {
            model_id: "semantic-formalizer-test",
            model_version: "v1",
            prompt_version: "prompt-1",
            schema_version: 1,
            mode: "permissive",
            cache_hit: false,
            iterations_attempted: 1,
            derived_theory: theory,
          },
        })
      })

      mock.module("./deliberation-formalizer", () => ({
        formalizeDeliberationRequest: oldFormalizer,
      }))

      const { createDeliberationGateHook: createFreshDeliberationGateHook } = await importFreshDeliberationGate()
      const hook = createFreshDeliberationGateHook({
        client: createMockClient(buildArgueResult()),
        formalizationService: { formalize: semanticFormalize },
        runConsequenceLiftingSidecarFn: () => buildSidecarOutput("No unresolved structural gaps detected."),
      })
      const output = { args: { filePath: ".sisyphus/deliberations/example.md", content: buildRequest() } }

      await hook["tool.execute.before"]({ tool: "write", sessionID: "ses-1", callID: "call-semantic" }, output)

      const parsed = DeliberationResponseSchema.parse(JSON.parse(String(output.args.content)))
                        expect(parsed.formalization?.model_id).toBe("semantic-formalizer-test")
      expect(semanticFormalize).toHaveBeenCalledTimes(1)
      expect(oldFormalizer).toHaveBeenCalledTimes(0)
    })

    it("#when formalization returns structured preferences #then provenance preserves them and reasoning-core receives pairwise preferences", async () => {
      const request = buildRequestObject()
      const theory: Theory = {
        ...buildTheory(),
        preferences: {
          pairwise: [{ superior: "d-option-0", inferior: "d-option-1" }],
          groups: [
            {
              group_id: "g-1",
              ordered_rules: ["d-option-0", "d-option-1"],
              relation_to_other_groups: "unordered",
            },
          ],
        },
      }
      const client = createMockClient(buildArgueResult())
      const semanticFormalize = mock((_formalizationRequest: FormalizationRequest): Promise<FormalizationResult> => {
        return Promise.resolve({
          theory,
          provenance: {
            model_id: "semantic-formalizer-test",
            prompt_version: "prompt-1",
            schema_version: 1,
            mode: "strict",
            cache_hit: false,
            iterations_attempted: 1,
            derived_theory: theory,
          },
        })
      })
      const hook = createDeliberationGateHook({
        client,
        formalizationService: { formalize: semanticFormalize },
        runConsequenceLiftingSidecarFn: () => buildSidecarOutput("No unresolved structural gaps detected.", false),
      })
      const output = { args: { filePath: ".sisyphus/deliberations/example.md", content: buildRequest() } }

      await hook["tool.execute.before"]({ tool: "write", sessionID: "ses-1", callID: "call-structured-prefs" }, output)

      const parsed = DeliberationResponseSchema.parse(JSON.parse(String(output.args.content)))
                        expect(parsed.formalization?.derived_theory?.preferences).toEqual({
        pairwise: [{ superior: "d-option-0", inferior: "d-option-1" }],
        groups: [
          {
            group_id: "g-1",
            ordered_rules: ["d-option-0", "d-option-1"],
            relation_to_other_groups: "unordered",
          },
        ],
      })
      expect(client.argue).toHaveBeenCalledWith({
        semantics: request.requested_semantics,
        theory: {
          ...theory,
          contrariness: [],
          preferences: [{ superior: "d-option-0", inferior: "d-option-1" }, { superior: "d-option-0", inferior: "d-option-1" }],
        },
      })
    })

    it("#when formalization returns contraries #then reasoning-core receives them unchanged", async () => {
      const request = buildRequestObject()
      const theory = buildTheory()
      theory.contraries = [["problem(current)", "select_ship_it"]]
      const client = createMockClient(buildArgueResult())
      const semanticFormalize = mock((_formalizationRequest: FormalizationRequest): Promise<FormalizationResult> => {
        return Promise.resolve({
          theory,
          provenance: {
            model_id: "semantic-formalizer-test",
            prompt_version: "prompt-1",
            schema_version: 1,
            mode: "strict",
            cache_hit: false,
            iterations_attempted: 1,
            derived_theory: theory,
          },
        })
      })
      const hook = createDeliberationGateHook({
        client,
        formalizationService: { formalize: semanticFormalize },
        runConsequenceLiftingSidecarFn: () => buildSidecarOutput("No unresolved structural gaps detected."),
      })
      const output = { args: { filePath: ".sisyphus/deliberations/example.md", content: buildRequest() } }

      await hook["tool.execute.before"]({ tool: "write", sessionID: "ses-1", callID: "call-contraries" }, output)

      expect(client.argue).toHaveBeenCalledWith(expect.objectContaining({
        semantics: request.requested_semantics,
        theory: expect.objectContaining({
          contrariness: [
            { target: "problem(current)", attacker: "select_ship_it", relation: "contrary" },
          ],
          preferences: [],
        }),
      }))
    })

    it("#when the request is valid and the sidecar selects a bundle #then replaces content with a full deliberation response", async () => {
      const hook = createDeliberationGateHook({
        client: createMockClient(buildArgueResult()),
        runConsequenceLiftingSidecarFn: () => buildSidecarOutput("No unresolved structural gaps detected."),
      })
      const output = { args: { filePath: ".sisyphus/deliberations/example.md", content: buildRequest() } }

      await hook["tool.execute.before"]({ tool: "write", sessionID: "ses-1", callID: "call-1" }, output)

      const parsed = DeliberationResponseSchema.parse(JSON.parse(String(output.args.content)))
                        expect(parsed.verdict).toBe("selected")
      expect(parsed.bundle === null).toBe(false)
      expect(parsed.bundle?.selected_option).toBe("Ship it")
      expect(typeof parsed.sidecar_trace).toBe("object")
      expect(parsed.proof_chain.length).toBe(1)
    })

    it("#when the request is malformed #then throws an actionable parse error", async () => {
      const hook = createDeliberationGateHook({ client: createMockClient(buildArgueResult()) })
      const output = { args: { filePath: ".sisyphus/deliberations/example.md", content: "id: broken\npreferences: [" } }

      let thrown: unknown = undefined

      try {
        await Promise.resolve(
          hook["tool.execute.before"]({ tool: "write", sessionID: "ses-1", callID: "call-2" }, output),
        )
      } catch (error) {
        thrown = error
      }

      expect(thrown instanceof Error).toBe(true)
      expect(thrown instanceof Error ? thrown.message.includes("Deliberation request parse failed") : false).toBe(true)
    })

    it("#when the sidecar yields no selectable bundle #then preserves the catastrophic verdict verbatim", async () => {
      const summary = "irreparable: No policy bundle remains selectable after gating and constraints"
      const hook = createDeliberationGateHook({
        client: createMockClient(buildArgueResult()),
        runConsequenceLiftingSidecarFn: () => buildSidecarOutput(summary, false),
      })
      const output = { args: { filePath: ".sisyphus/deliberations/example.md", content: buildRequest() } }

      await hook["tool.execute.before"]({ tool: "write", sessionID: "ses-1", callID: "call-3" }, output)

      const parsed = DeliberationResponseSchema.parse(JSON.parse(String(output.args.content)))
                        expect(parsed.verdict).toBe("no_selectable_bundle")
      expect(parsed.rationale).toBe(summary)
      expect(parsed.bundle).toEqual(null)
    })

    it("#when preferred semantics produce multiple extensions #then returns a multiple_extensions response", async () => {
      const hook = createDeliberationGateHook({
        client: createMockClient(buildArgueResult([
          { index: 0, accepted_conclusions: ["select_ship_it"] },
          { index: 1, accepted_conclusions: ["select_ship_it"] },
        ])),
        runConsequenceLiftingSidecarFn: () => buildSidecarOutput("No unresolved structural gaps detected.", false),
      })
      const output = { args: { filePath: ".sisyphus/deliberations/example.md", content: buildRequest("preferred") } }

      await hook["tool.execute.before"]({ tool: "write", sessionID: "ses-1", callID: "call-4" }, output)

      const parsed = DeliberationResponseSchema.parse(JSON.parse(String(output.args.content)))
                        expect(parsed.verdict).toBe("multiple_extensions")
      expect(parsed.bundle).toEqual(null)
      expect(parsed.extensions?.length).toBe(2)
    })
  })

  describe("#given non-matching writes", () => {
    it("#when the path is outside .sisyphus deliberations #then passes through unchanged", async () => {
      const client = createMockClient(buildArgueResult())
      const hook = createDeliberationGateHook({ client })
      const output = { args: { filePath: "src/other/file.ts", content: buildRequest() } }

      await hook["tool.execute.before"]({ tool: "write", sessionID: "ses-1", callID: "call-5" }, output)

      expect(output.args.content).toBe(buildRequest())
      expect(client.argue).not.toHaveBeenCalled()
    })
  })
})
