import { describe, expect, it } from "bun:test"

import { runConsequenceLiftingSidecar } from "./sidecar"
import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"

function processed(conclusion: string, combined: number, options?: { pianoA?: "plausibile" | "non_escluso" | "da_verificare" | "escluso"; blocked?: boolean }): ProcessedConclusion {
  const pianoA = options?.pianoA ?? "plausibile"
  return {
    annotation: {
      conclusion,
      state: {
        pianoA,
        pianoB: { probabile: combined, plausibile: combined >= 0.6 },
        pianoC: { inconclusivo: false, autosufficiente: true, catena_dipendenze: [], ha_dipendenza_circolare: false },
        pianoD: null,
      },
      rawClassification: pianoA,
      reason: conclusion,
      timestamp: 1,
      callID: "call-riva",
      proofChainKind: "defeasible",
      extensionMembership: { inCount: 1, totalCount: 1 },
      valutazione: null,
    },
    hook: {
      id: `${conclusion}-hook`,
      target: conclusion,
      polarity: "positivo",
      strength: "forte",
      factors: {
        epistemici: { supporto_empirico: combined, compatibilita_strutturale: combined, potenziale_esplicativo: combined, valore_verifica: combined, maturita: combined },
        pragmatici: { beneficio_potenziale: combined, urgenza: combined, costo_verifica: 0.2, rischio: 0.4 },
      },
      rationale: conclusion,
      timestamp: 1,
      sessionId: "ses-riva",
    },
    valutazione: {
      logico: combined,
      probabilistico: combined,
      etico: { score: null, label: null, allineamento_legale: 0, valore_empatico: 0, magnitudine_beneficio: 0, override: false, reason: "no_ethical_context" },
      pragmatico: { score: combined, label: "conveniente", beneficio_proprio: combined, beneficio_controparte: combined, costo_proprio: 0.2, costo_controparte: 0.2, pesatura: { proprio: 0.6, controparte: 0.4 } },
      morale: { score: null, label: null, contesto_sociale: null, comprensione_destinatari: null, impatto_cascata: 0, intenzione: "neutra", trasparenza: 0, fiducia_risultante: 0, reason: "no_moral_context" },
      combined,
      divergente: false,
      dettaglio_divergenza: null,
    },
    blocked: options?.blocked ?? false,
  }
}

function artifact(entries: Record<string, { status?: string; from?: string[]; kind?: "ordinary" | "strict" | "defeasible" }>) {
  return {
    result: {
      semantics: "preferred",
      extensions: [{ index: 0, accepted_conclusions: Object.keys(entries).filter((key) => (entries[key]?.status ?? "Accepted") === "Accepted") }],
      conclusions: Object.fromEntries(
        Object.entries(entries).map(([conclusion, entry]) => [
          conclusion,
          {
            conclusion,
            status: entry.status ?? "Accepted",
            proof_chain: [
              ...(entry.from ?? []).map((premise) => ({ conclusion: premise, from: [], rule_id: null, rule_kind: "ordinary" as const })),
              { conclusion, from: entry.from ?? [], rule_id: `${conclusion}-rule`, rule_kind: entry.kind ?? "defeasible" },
            ],
          },
        ]),
      ),
    },
  }
}

describe("Rivafosca benchmark", () => {
  it("keeps visible burdens and conditions on the selected emergency policy", () => {
    const result = runConsequenceLiftingSidecar({
      sessionID: "riva-bench",
      callID: "call-riva-bench",
      processed: [
        processed("activate_epr7_full_city", 0.71),
        processed("activate_epr7_hospitals_only", 0.63),
        processed("involuntary_exposure_vulnerable_first", 0.58),
        processed("consent_principle_violated", 0.55),
        processed("institutional_trust_collapse", 0.41),
        processed("-certain_preventable_deaths", 0.84),
        processed("mandatory_full_disclosure", 0.72),
        processed("continuous_monitoring_pregnant_mandatory", 0.7),
        processed("necessity_override", 0.79),
      ],
      proofArtifact: artifact({
        activate_epr7_full_city: { from: ["evidence:epr7_capacity", "evidence:midnight_deadline"] },
        activate_epr7_hospitals_only: { from: ["evidence:reconfigure_30h", "legal:informed_consent"] },
        involuntary_exposure_vulnerable_first: { from: ["activate_epr7_full_city", "safety:pregnant_population"] },
        consent_principle_violated: { from: ["involuntary_exposure_vulnerable_first", "ethics:no_involuntary_exposure_without_consent"] },
        institutional_trust_collapse: { from: ["consent_principle_violated", "pragmatic:trust_erosion"] },
        "-certain_preventable_deaths": { from: ["activate_epr7_full_city", "safety:dialysis_patients"] },
        mandatory_full_disclosure: { from: ["activate_epr7_full_city", "consent_principle_violated"] },
        continuous_monitoring_pregnant_mandatory: { from: ["activate_epr7_full_city", "residual_risk:fetal_uncertainty"] },
        necessity_override: { from: ["activate_epr7_full_city", "consent_principle_violated", "value:preservation_of_life"] },
      }),
    })

    const fullCity = result.policies.find((policy) => policy.primaryDecision === "activate_epr7_full_city")
    expect(fullCity).toBeDefined()
    const burdenConclusions = fullCity!.profile.forwardBurdens.map((item) => item.conclusion)
    expect(burdenConclusions.includes("involuntary_exposure_vulnerable_first")).toBe(true)
    expect(burdenConclusions.includes("consent_principle_violated")).toBe(true)
    expect(burdenConclusions.includes("institutional_trust_collapse")).toBe(true)
    expect(fullCity!.profile.forwardBenefits.map((item) => item.conclusion)).toContain("-certain_preventable_deaths")
    expect(fullCity!.profile.qualifiers.includes("normativamente_burdened")).toBe(true)
    expect(fullCity!.profile.qualifiers.includes("giustificabile_in_stato_di_necessita")).toBe(true)
    expect(result.graph.edges.some((edge) => edge.from === "activate_epr7_full_city" && edge.to === "mandatory_full_disclosure")).toBe(true)
  })
})
