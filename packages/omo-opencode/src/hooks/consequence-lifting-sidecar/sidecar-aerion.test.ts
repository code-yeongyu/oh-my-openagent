import { describe, expect, it } from "bun:test"

import { runConsequenceLiftingSidecar } from "./sidecar"
import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"

function p(conclusion: string, combined: number, blocked = false): ProcessedConclusion {
  return {
    annotation: {
      conclusion,
      state: {
        pianoA: blocked ? "escluso" : "plausibile",
        pianoB: { probabile: combined, plausibile: combined >= 0.6 },
        pianoC: { inconclusivo: false, autosufficiente: true, catena_dipendenze: [], ha_dipendenza_circolare: false },
        pianoD: null,
      },
      rawClassification: blocked ? "escluso" : "plausibile",
      reason: conclusion,
      timestamp: 1,
      callID: "call-a27",
      proofChainKind: blocked ? "defeasible" : "strict",
      extensionMembership: { inCount: blocked ? 0 : 1, totalCount: 1 },
      valutazione: null,
    },
    hook: {
      id: `${conclusion}-hook`,
      target: conclusion,
      polarity: blocked ? "negativo" : "positivo",
      strength: blocked ? "debole" : "forte",
      factors: {
        epistemici: { supporto_empirico: combined, compatibilita_strutturale: combined, potenziale_esplicativo: combined, valore_verifica: combined, maturita: combined },
        pragmatici: { beneficio_potenziale: combined, urgenza: 0.5, costo_verifica: 0.2, rischio: blocked ? 0.9 : 0.4 },
      },
      rationale: conclusion,
      timestamp: 1,
      sessionId: "ses-a27",
    },
    valutazione: {
      logico: combined,
      probabilistico: combined,
      etico: { score: null, label: null, allineamento_legale: 0, valore_empatico: 0, magnitudine_beneficio: 0, override: false, reason: "no_ethical_context" },
      pragmatico: { score: combined, label: combined >= 0.6 ? "conveniente" : "condizionata", beneficio_proprio: combined, beneficio_controparte: combined, costo_proprio: 0.3, costo_controparte: 0.3, pesatura: { proprio: 0.6, controparte: 0.4 } },
      morale: { score: null, label: null, contesto_sociale: null, comprensione_destinatari: null, impatto_cascata: 0, intenzione: "neutra", trasparenza: 0, fiducia_risultante: 0, reason: "no_moral_context" },
      combined,
      divergente: false,
      dettaglio_divergenza: null,
    },
    blocked,
  }
}

function a27Artifact(entries: Record<string, { status?: string; from: string[]; kind?: "defeasible" | "strict" }>) {
  return {
    result: {
      semantics: "preferred",
      extensions: [{ index: 0, accepted_conclusions: Object.entries(entries).filter(([, entry]) => (entry.status ?? "Accepted") === "Accepted").map(([key]) => key) }],
      conclusions: Object.fromEntries(Object.entries(entries).map(([conclusion, entry]) => [
        conclusion,
        {
          conclusion,
          status: entry.status ?? "Accepted",
          proof_chain: [
            ...entry.from.map((premise) => ({ conclusion: premise, from: [], rule_id: null, rule_kind: "ordinary" as const })),
            { conclusion, from: entry.from, rule_id: `${conclusion}-rule`, rule_kind: entry.kind ?? "defeasible" },
          ],
        },
      ])),
    },
  }
}

describe("Aerion benchmark", () => {
  it("keeps residual catastrophic risk visible and excludes traceability-fragile selective grounding", () => {
    const result = runConsequenceLiftingSidecar({
      sessionID: "a27-bench",
      callID: "call-a27-bench",
      processed: [
        p("choose_grounding_total", 0.74),
        p("choose_fly_selected_routes_only", 0.69),
        p("choose_grounding_selective_6B", 0.55, true),
        p("selective_grounding_epistemically_fragile", 0.82),
        p("risk:catastrophic_event_if_structural_defect_undetected", 0.88),
        p("mandatory_auto_grounding_trigger_on_next_event", 0.76),
      ],
      proofArtifact: a27Artifact({
        choose_grounding_total: { from: ["evidence:trend_anomalous", "value:precautionary_principle_aviation"] },
        choose_fly_selected_routes_only: { from: ["evidence:trend_not_yet_catastrophic", "guardrail:restricted_envelope"] },
        choose_grounding_selective_6B: { status: "Rejected", from: ["evidence:batch_6B_linked_events"] },
        selective_grounding_epistemically_fragile: { from: ["evidence:traceability_incomplete", "evidence:1_event_data_incomplete_component_replaced"], kind: "strict" },
        "risk:catastrophic_event_if_structural_defect_undetected": { from: ["choose_fly_selected_routes_only", "catastrophic:true", "safety:critical"] },
        mandatory_auto_grounding_trigger_on_next_event: { from: ["choose_fly_selected_routes_only", "guardrail:next_event_trigger"] },
      }),
    })

    const selective = result.policies.find((policy) => policy.primaryDecision === "choose_grounding_selective_6B")
    expect(selective).toBeUndefined()

    const flightPolicy = result.policies.find((policy) => policy.primaryDecision === "choose_fly_selected_routes_only")
    expect(flightPolicy).toBeDefined()
    expect(result.graph.edges.some((edge) => edge.from === "choose_fly_selected_routes_only" && edge.to === "risk:catastrophic_event_if_structural_defect_undetected")).toBe(true)
  })
})
