import { describe, expect, it } from "bun:test"
import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"
import { runConsequenceLiftingSidecar } from "./sidecar"
import type { ImplementationSafetyConclusionState } from "./safety-validation-types"
import { validateImplementationSafety } from "./implementation-safety-validator"
import type { QualifiedPolicy } from "./types"

function createEvaluation(combined: number) {
  return {
    logico: combined,
    probabilistico: combined,
    etico: {
      score: combined,
      label: "lecito" as const,
      allineamento_legale: combined,
      valore_empatico: combined,
      magnitudine_beneficio: combined,
      override: false,
      reason: null,
    },
    pragmatico: {
      score: combined,
      label: "conveniente" as const,
      beneficio_proprio: combined,
      beneficio_controparte: combined,
      costo_proprio: 0.1,
      costo_controparte: 0.1,
      pesatura: { proprio: 0.5, controparte: 0.5 },
    },
    morale: {
      score: combined,
      label: "giustificabile" as const,
      contesto_sociale: null,
      comprensione_destinatari: null,
      impatto_cascata: combined,
      intenzione: "benevola" as const,
      trasparenza: combined,
      fiducia_risultante: combined,
      reason: null,
    },
    combined,
    divergente: false,
    dettaglio_divergenza: null,
  }
}

function createProcessedConclusion(conclusion: string, combined = 0.9): ProcessedConclusion {
  const valutazione = createEvaluation(combined)
  return {
    annotation: {
      conclusion,
      state: {
        pianoA: "plausibile",
        pianoB: { probabile: combined, plausibile: combined >= 0.6 },
        pianoC: { inconclusivo: false, autosufficiente: true, catena_dipendenze: [], ha_dipendenza_circolare: false },
        pianoD: null,
      },
      rawClassification: "plausibile",
      reason: `${conclusion}:plausibile`,
      timestamp: 1,
      callID: "call-1",
      proofChainKind: "strict",
      extensionMembership: { inCount: 1, totalCount: 1 },
      valutazione,
    },
    hook: {
      id: `${conclusion}-hook`,
      target: conclusion,
      polarity: "positivo",
      strength: "forte",
      factors: {
        epistemici: { supporto_empirico: combined, compatibilita_strutturale: combined, potenziale_esplicativo: combined, valore_verifica: 0.2, maturita: combined },
        pragmatici: { beneficio_potenziale: combined, urgenza: 0.2, costo_verifica: 0.1, rischio: 0.1 },
      },
      rationale: "test",
      timestamp: 1,
      sessionId: "session-1",
    },
    valutazione,
    blocked: false,
  }
}

function createArtifact(entries: Record<string, { from?: string[]; status?: string; kind?: "ordinary" | "strict" | "defeasible" }>) {
  return {
    result: {
      conclusions: Object.fromEntries(Object.entries(entries).map(([conclusion, entry]) => [conclusion, {
        conclusion,
        status: entry.status ?? "Accepted",
        proof_chain: [...(entry.from ?? []).map((premise) => ({ conclusion: premise, from: [], rule_id: null, rule_kind: "ordinary" as const })), { conclusion, from: entry.from ?? [], rule_id: `${conclusion}-rule`, rule_kind: entry.kind ?? "strict" }],
      }])),
      extensions: [{ index: 0, accepted_conclusions: Object.keys(entries) }],
      semantics: "preferred",
    },
  }
}

function createState(tags: string[], from: string[] = [], status = "Accepted"): ImplementationSafetyConclusionState {
  return { status, blocked: false, tags, proofChain: [{ conclusion: "step", from: [] }, { conclusion: "step-result", from }] }
}

function createPolicy(overrides?: Partial<QualifiedPolicy>): QualifiedPolicy {
  return {
    primaryDecision: "deploy_emergency_dialysis",
    requiredConditions: [],
    requiredMitigations: ["mandatory_monitoring_renal"],
    profile: {
      decision: "deploy_emergency_dialysis",
      coreStatus: "accepted",
      coreCombined: 0.9,
      forwardBurdens: [{ conclusion: "risk_renal_collapse", liftStrength: "strong_lift", epistemicState: "established", normativeTag: "safety:renal", mitigationStatus: "partially_mitigated", mitigatedBy: ["mandatory_monitoring_renal"] }],
      forwardBenefits: [],
      mitigations: [{ mitigation: "mandatory_monitoring_renal", targetBurden: "risk_renal_collapse", effectiveness: "partially_mitigated", required: true }],
      requiredConditions: [],
      policyStatus: "core_accepted_conditioned",
      qualifiers: ["ammissibile_solo_se_condizionata"],
    },
    alternativesConsidered: [],
    residualRisks: ["risk_renal_collapse"],
    ...overrides,
  }
}

describe("validateImplementationSafety", () => {
  it("#given a required mitigation blocked by temporal tags #when validating #then it marks implementation unsafe", () => {
    const result = validateImplementationSafety(createPolicy(), new Map([
      ["mandatory_monitoring_renal", createState(["constraint:temporal_window_closed"])],
      ["risk_renal_collapse", createState(["safety:renal"], ["mandatory_monitoring_renal"])],
    ]))

    expect(result.status).toBe("implementationUnsafe")
    expect(result.violations.map((violation) => violation.kind)).toContain("blocked_required_step")
  })

  it("#given an implementation path that keeps a strong burden live #when validating #then it reports that burden even if the core policy remains accepted", () => {
    const result = validateImplementationSafety(createPolicy({
      profile: {
        ...createPolicy().profile,
        forwardBurdens: [{ conclusion: "monitoring_delay_harm", liftStrength: "strong_lift", epistemicState: "established", normativeTag: "safety:delay", mitigationStatus: "unmitigated", mitigatedBy: [] }],
      },
    }), new Map([
      ["mandatory_monitoring_renal", createState(["safety:monitoring"])],
      ["monitoring_delay_harm", createState(["safety:delay"], ["mandatory_monitoring_renal"])],
    ]))

    expect(result.status).toBe("implementationUnsafe")
    expect(result.violations.map((violation) => violation.kind)).toContain("implementation_path_burden")
  })

  it("#given a conditioned core policy with a blocked mitigation #when sidecar runs #then it attaches implementation safety without changing the core policy verdict", () => {
    const result = runConsequenceLiftingSidecar({
      processed: [
        createProcessedConclusion("deploy_emergency_dialysis", 0.86),
        createProcessedConclusion("risk_renal_collapse", 0.84),
        createProcessedConclusion("mandatory_monitoring_renal", 0.82),
      ],
      proofArtifact: createArtifact({
        deploy_emergency_dialysis: { from: ["evidence:crisis"], kind: "strict" },
        risk_renal_collapse: { from: ["deploy_emergency_dialysis", "safety:renal"], kind: "strict" },
        mandatory_monitoring_renal: { from: ["risk_renal_collapse", "constraint:temporal_window_closed"], kind: "strict" },
      }),
      sessionID: "s-unsafe",
      callID: "c-unsafe",
    })

    expect(result.policies[0]?.profile.policyStatus).toBe("core_accepted_conditioned")
    expect(result.policies[0]?.implementationSafety?.status).toBe("implementationUnsafe")
    expect(result.policies[0]?.implementationSafety?.violations.map((violation) => violation.conclusion)).toContain("mandatory_monitoring_renal")
  })
})
