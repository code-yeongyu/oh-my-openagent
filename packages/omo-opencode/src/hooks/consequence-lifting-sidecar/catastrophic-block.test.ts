import { describe, expect, it } from "bun:test"
import { DeliberationResponseSchema } from "../../agents/themis/types"
import { ReasoningCoreConfigSchema } from "../../config/schema/reasoning-core"
import { buildDeliberationResponse } from "../reasoning-core-policy-gate/deliberation-response-builder"
import {
  createPolicy,
  createRequest,
  createSidecar,
} from "../reasoning-core-policy-gate/deliberation-response-builder.test-helpers"
import { applyCatastrophicGate } from "./catastrophic-risk-gate"
import { classifyCatastrophicRisk } from "./catastrophic-risk-classifier"
import { comparePolicies } from "./dominance-comparator-v2"
import { composePolicy } from "./policy-composer"
import { classifyRecourse } from "./recourse-classifier"
import { runConsequenceLiftingSidecar } from "./sidecar"
import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"
import type { CatastrophicClassification } from "./catastrophic-risk-types"
import type {
  ConsequenceGraph,
  DecisionProfile,
  SidecarCatastrophicInfo,
  SidecarInput,
} from "./types"

describe("catastrophic_blocked verdict and feature flag (commit 1)", () => {
  describe("#given the DeliberationResponse verdict union", () => {
    describe("#when parsing 'catastrophic_blocked'", () => {
      it("#then schema accepts it as a valid verdict", () => {
        const parsed = DeliberationResponseSchema.shape.verdict.safeParse("catastrophic_blocked")
        expect(parsed.success).toBe(true)
      })
    })
  })

  describe("#given the ReasoningCoreConfig schema", () => {
    describe("#when parsing an empty object", () => {
      it("#then catastrophic_block_enabled defaults to false", () => {
        const parsed = ReasoningCoreConfigSchema.parse({})
        expect(parsed.catastrophic_block_enabled).toBe(false)
      })
    })

    describe("#when parsing a config with catastrophic_block_enabled true", () => {
      it("#then it preserves the explicit value", () => {
        const parsed = ReasoningCoreConfigSchema.parse({ catastrophic_block_enabled: true })
        expect(parsed.catastrophic_block_enabled).toBe(true)
      })
    })
  })

  describe("#given the SidecarCatastrophicInfo type", () => {
    describe("#when including a blocked list of decisions", () => {
      it("#then the type accepts blocked as a string array", () => {
        const info: SidecarCatastrophicInfo = { classifications: [], blocked: ["decision_a"] }
        expect(info.blocked).toEqual(["decision_a"])
      })

      it("#then blocked is optional and may be omitted", () => {
        const info: SidecarCatastrophicInfo = { classifications: [] }
        expect(info.blocked).toBeUndefined()
      })
    })
  })

  describe("#given the SidecarInput type", () => {
    describe("#when constructing with catastrophicBlockEnabled flag", () => {
      it("#then the input type accepts the flag", () => {
        const input: SidecarInput = {
          processed: [],
          proofArtifact: {},
          sessionID: "s-1",
          callID: "c-1",
          catastrophicBlockEnabled: true,
        }
        expect(input.catastrophicBlockEnabled).toBe(true)
      })

      it("#then the flag is optional", () => {
        const input: SidecarInput = {
          processed: [],
          proofArtifact: {},
          sessionID: "s-1",
          callID: "c-1",
        }
        expect(input.catastrophicBlockEnabled).toBeUndefined()
      })
    })
  })
})

function makeGraph(decision: string, consequence: string): ConsequenceGraph {
  return {
    decisions: [decision],
    edges: [
      {
        from: decision,
        to: consequence,
        relation: "causes",
        attribution: {
          directness: "direct",
          foreseeability: "high",
          controllability: "high",
          affectsVulnerable: false,
          horizon: "immediate",
        },
        liftStrength: "strong_lift",
      },
    ],
  }
}

function classifications(entries: Array<[string, CatastrophicClassification]>): Map<string, CatastrophicClassification> {
  return new Map(entries)
}

describe("applyCatastrophicGate block emission (commit 2)", () => {
  describe("#given catastrophic consequence edges", () => {
    const decision = "deploy_option_a"
    const consequence = "trigger_catastrophic @risk:catastrophic:mortality_high"
    const graph = makeGraph(decision, consequence)
    const classMap = classifications([
      [decision, classifyCatastrophicRisk(decision, [])],
      [consequence, classifyCatastrophicRisk(consequence, [])],
    ])

    describe("#when invoked without options or with blockEnabled=false", () => {
      it("#then returns gated map but empty blocked list (backward compatible)", () => {
        const result = applyCatastrophicGate([decision], graph, classMap)
        expect(result.gated.get(decision)).toBe(true)
        expect(result.blocked).toEqual([])
      })

      it("#then blockEnabled=false is explicit no-op for blocked list", () => {
        const result = applyCatastrophicGate([decision], graph, classMap, { blockEnabled: false })
        expect(result.gated.get(decision)).toBe(true)
        expect(result.blocked).toEqual([])
      })
    })

    describe("#when invoked with blockEnabled=true", () => {
      it("#then populates blocked list with the gated decisions", () => {
        const result = applyCatastrophicGate([decision], graph, classMap, { blockEnabled: true })
        expect(result.gated.get(decision)).toBe(true)
        expect(result.blocked).toEqual([decision])
      })
    })
  })

  describe("#given no catastrophic consequence edges", () => {
    const decision = "safe_option"
    const consequence = "benign_outcome"
    const graph = makeGraph(decision, consequence)
    const classMap = classifications([
      [decision, classifyCatastrophicRisk(decision, [])],
      [consequence, classifyCatastrophicRisk(consequence, [])],
    ])

    describe("#when invoked with blockEnabled=true", () => {
      it("#then blocked list is empty (no false positives)", () => {
        const result = applyCatastrophicGate([decision], graph, classMap, { blockEnabled: true })
        expect(result.gated.get(decision)).toBe(false)
        expect(result.blocked).toEqual([])
      })
    })
  })
})

function createProcessed(conclusion: string, tags: string[] = []): ProcessedConclusion {
  return {
    annotation: {
      conclusion,
      state: {
        pianoA: "plausibile",
        pianoB: { probabile: 0.9, plausibile: true },
        pianoC: { inconclusivo: false, autosufficiente: true, catena_dipendenze: [], ha_dipendenza_circolare: false },
        pianoD: null,
      },
      rawClassification: "plausibile",
      reason: `${conclusion}:plausibile`,
      timestamp: 1,
      callID: "c-1",
      proofChainKind: "strict",
      extensionMembership: { inCount: 1, totalCount: 1 },
      valutazione: {
        logico: 0.9,
        probabilistico: 0.9,
        etico: { score: 0.9, label: "lecito", allineamento_legale: 0.9, valore_empatico: 0.9, magnitudine_beneficio: 0.9, override: false, reason: null },
        pragmatico: { score: 0.9, label: "conveniente", beneficio_proprio: 0.9, beneficio_controparte: 0.9, costo_proprio: 0.1, costo_controparte: 0.1, pesatura: { proprio: 0.5, controparte: 0.5 } },
        morale: { score: 0.9, label: "giustificabile", contesto_sociale: null, comprensione_destinatari: null, impatto_cascata: 0.9, intenzione: "benevola", trasparenza: 0.9, fiducia_risultante: 0.9, reason: null },
        combined: 0.9,
        divergente: false,
        dettaglio_divergenza: null,
      },
    },
    hook: {
      id: `${conclusion}-hook`,
      target: conclusion,
      polarity: "positivo",
      strength: "forte",
      factors: {
        epistemici: { supporto_empirico: 0.9, compatibilita_strutturale: 0.9, potenziale_esplicativo: 0.9, valore_verifica: 0.2, maturita: 0.9 },
        pragmatici: { beneficio_potenziale: 0.9, urgenza: 0.2, costo_verifica: 0.1, rischio: 0.1 },
      },
      rationale: "fixture",
      timestamp: 1,
      sessionId: "session-1",
    },
    valutazione: {
      logico: 0.9,
      probabilistico: 0.9,
      etico: { score: 0.9, label: "lecito", allineamento_legale: 0.9, valore_empatico: 0.9, magnitudine_beneficio: 0.9, override: false, reason: null },
      pragmatico: { score: 0.9, label: "conveniente", beneficio_proprio: 0.9, beneficio_controparte: 0.9, costo_proprio: 0.1, costo_controparte: 0.1, pesatura: { proprio: 0.5, controparte: 0.5 } },
      morale: { score: 0.9, label: "giustificabile", contesto_sociale: null, comprensione_destinatari: null, impatto_cascata: 0.9, intenzione: "benevola", trasparenza: 0.9, fiducia_risultante: 0.9, reason: null },
      combined: 0.9,
      divergente: false,
      dettaglio_divergenza: null,
    },
    blocked: false,
    tags,
  } as ProcessedConclusion
}

function createCatastrophicArtifact(decision: string, consequence: string) {
  return {
    result: {
      semantics: "preferred",
      extensions: [{ index: 0, accepted_conclusions: [decision, consequence] }],
      conclusions: {
        [decision]: {
          conclusion: decision,
          status: "Accepted",
          proof_chain: [{ conclusion: decision, from: ["evidence:ready"], rule_id: "d1", rule_kind: "defeasible" }],
        },
        [consequence]: {
          conclusion: consequence,
          status: "Accepted",
          proof_chain: [{ conclusion: consequence, from: [decision], rule_id: "s1", rule_kind: "strict" }],
        },
      },
    },
  }
}

describe("sidecar integration: catastrophic block flag wiring (commit 2)", () => {
  const decision = "deploy_unsafe_protocol"
  const catastrophe = "patient_fatal_outcome @risk:catastrophic:mortality_high"

  describe("#given catastrophic edges and the flag is OFF", () => {
    describe("#when sidecar runs", () => {
      it("#then catastrophic.blocked is empty or undefined and scoring signal stays on the policy", () => {
        const result = runConsequenceLiftingSidecar({
          processed: [createProcessed(decision), createProcessed(catastrophe)],
          proofArtifact: createCatastrophicArtifact(decision, catastrophe),
          sessionID: "s-off",
          callID: "c-off",
        })

        expect(result.catastrophic?.blocked ?? []).toEqual([])
        const policy = result.policies.find((p) => p.primaryDecision === decision)
        expect(policy?.profile.catastrophicGated).toBe(true)
        expect(policy?.profile.qualifiers).toContain("catastroficamente_bloccato")
      })
    })
  })

  describe("#given catastrophic edges and the flag is ON", () => {
    describe("#when sidecar runs", () => {
      it("#then catastrophic.blocked contains the gated decision and scoring signal remains", () => {
        const result = runConsequenceLiftingSidecar({
          processed: [createProcessed(decision), createProcessed(catastrophe)],
          proofArtifact: createCatastrophicArtifact(decision, catastrophe),
          sessionID: "s-on",
          callID: "c-on",
          catastrophicBlockEnabled: true,
        })

        expect(result.catastrophic?.blocked).toEqual([decision])
        const policy = result.policies.find((p) => p.primaryDecision === decision)
        expect(policy?.profile.catastrophicGated).toBe(true)
        expect(policy?.profile.qualifiers).toContain("catastroficamente_bloccato")
      })
    })
  })

  describe("#given NO catastrophic edges and the flag is ON", () => {
    describe("#when sidecar runs", () => {
      it("#then catastrophic.blocked is empty (no false positives)", () => {
        const safeDecision = "deploy_safe_option"
        const safeConsequence = "benign_result"
        const result = runConsequenceLiftingSidecar({
          processed: [createProcessed(safeDecision), createProcessed(safeConsequence)],
          proofArtifact: createCatastrophicArtifact(safeDecision, safeConsequence),
          sessionID: "s-safe",
          callID: "c-safe",
          catastrophicBlockEnabled: true,
        })

        expect(result.catastrophic?.blocked ?? []).toEqual([])
        const policy = result.policies.find((p) => p.primaryDecision === safeDecision)
        expect(policy?.profile.catastrophicGated).toBe(false)
      })
    })
  })
})

function bareProfile(decision: string, catastrophicGated: boolean): Omit<DecisionProfile, "policyStatus" | "qualifiers"> {
  return {
    decision,
    coreStatus: "accepted",
    coreCombined: 0.8,
    framework_certainty: "high",
    world_certainty: "high",
    catastrophicGated,
    forwardBurdens: [],
    forwardBenefits: [],
    mitigations: [],
    requiredConditions: [],
  }
}

describe("scoring signal co-existence with block flag (commit 3)", () => {
  describe("#given a policy profile whose decision is catastrophically gated", () => {
    describe("#when composePolicy runs", () => {
      it("#then policyStatus becomes core_accepted_blocked and qualifier catastroficamente_bloccato is set", () => {
        const result = composePolicy("deploy_lethal", bareProfile("deploy_lethal", true), null, true)
        expect(result.profile.policyStatus).toBe("core_accepted_blocked")
        expect(result.profile.qualifiers).toContain("catastroficamente_bloccato")
      })
    })
  })

  describe("#given two policies that differ only on catastrophicGated", () => {
    describe("#when comparePolicies ranks them", () => {
      it("#then the non-gated policy wins on the catastrophic_gate criterion", () => {
        const gatedPolicy = createPolicy("deploy_gated")
        const safePolicy = createPolicy("deploy_safe")
        const gatedWithCatastrophe = {
          ...gatedPolicy,
          profile: { ...gatedPolicy.profile, catastrophicGated: true },
        }

        const verdict = comparePolicies(safePolicy, gatedWithCatastrophe)
        expect(verdict.winner).toBe("left")
        expect(verdict.reasons.some((reason) => reason.criterion === "policy_status" || reason.criterion === "catastrophic_gate")).toBe(true)
      })
    })
  })

  describe("#given a decision profile that is catastrophically gated", () => {
    describe("#when classifyRecourse evaluates it", () => {
      it("#then recourse level is irreversible", () => {
        const profile: DecisionProfile = {
          ...bareProfile("deploy_lethal", true),
          policyStatus: "core_accepted_blocked",
          qualifiers: ["catastroficamente_bloccato"],
        }
        expect(classifyRecourse(profile)).toBe("irreversible")
      })
    })
  })

  describe("#given the catastrophic block flag is ON in the sidecar", () => {
    describe("#when the sidecar processes a catastrophic decision", () => {
      it("#then the scoring signal still flows: profile.catastrophicGated true, qualifier set, blocked emitted", () => {
        const decision = "deploy_unsafe_protocol"
        const catastrophe = "patient_fatal_outcome @risk:catastrophic:mortality_high"
        const result = runConsequenceLiftingSidecar({
          processed: [createProcessed(decision), createProcessed(catastrophe)],
          proofArtifact: createCatastrophicArtifact(decision, catastrophe),
          sessionID: "s-coexist",
          callID: "c-coexist",
          catastrophicBlockEnabled: true,
        })

        const policy = result.policies.find((p) => p.primaryDecision === decision)
        expect(policy?.profile.catastrophicGated).toBe(true)
        expect(policy?.profile.qualifiers).toContain("catastroficamente_bloccato")
        expect(policy?.profile.policyStatus).toBe("core_accepted_blocked")
        expect(result.catastrophic?.blocked).toEqual([decision])
      })
    })
  })
})

describe("deliberation-response-builder catastrophic_blocked verdict (commit 2)", () => {
  describe("#given a sidecar result with catastrophic.blocked populated", () => {
    describe("#when buildDeliberationResponse runs", () => {
      it("#then verdict is 'catastrophic_blocked' regardless of selection state", () => {
        const sidecar = createSidecar({ primary: ["select_option_a"] })
        sidecar.catastrophic = {
          classifications: [
            {
              conclusion: "select_option_a",
              level: "catastrophic",
              catastrophicGated: true,
              threshold: "mortality_high",
              reasons: ["mortality_high"],
            },
          ],
          blocked: ["select_option_a"],
        }

        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: {
                  status: "Accepted",
                  proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "d1", rule_kind: "defeasible" }],
                },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: sidecar,
        })

        expect(response.verdict).toBe("catastrophic_blocked")
        expect(response.bundle).toBe(null)
      })
    })
  })

  describe("#given a sidecar result with catastrophic.blocked undefined", () => {
    describe("#when buildDeliberationResponse runs with a selectable bundle", () => {
      it("#then verdict is 'selected' (catastrophic_blocked path skipped)", () => {
        const sidecar = createSidecar({ primary: ["select_option_a"] })

        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: {
                  status: "Accepted",
                  proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "d1", rule_kind: "defeasible" }],
                },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: sidecar,
        })

        expect(response.verdict).toBe("selected")
      })
    })
  })
})
