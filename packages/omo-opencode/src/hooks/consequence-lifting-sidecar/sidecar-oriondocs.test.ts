import { describe, expect, it } from "bun:test"

import { runConsequenceLiftingSidecar } from "./sidecar"
import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"

function op(conclusion: string, combined: number, blocked = false): ProcessedConclusion {
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
      callID: "call-oriondocs",
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
        pragmatici: { beneficio_potenziale: combined, urgenza: 0.9, costo_verifica: 0.2, rischio: 0.9 },
      },
      rationale: conclusion,
      timestamp: 1,
      sessionId: "ses-oriondocs",
    },
    valutazione: {
      logico: combined,
      probabilistico: combined,
      etico: { score: null, label: null, allineamento_legale: 0, valore_empatico: 0, magnitudine_beneficio: 0, override: false, reason: "no_ethical_context" },
      pragmatico: { score: combined, label: combined >= 0.6 ? "conveniente" : "condizionata", beneficio_proprio: combined, beneficio_controparte: combined, costo_proprio: 0.2, costo_controparte: 0.2, pesatura: { proprio: 0.6, controparte: 0.4 } },
      morale: { score: null, label: null, contesto_sociale: null, comprensione_destinatari: null, impatto_cascata: 0, intenzione: "neutra", trasparenza: 0, fiducia_risultante: 0, reason: "no_moral_context" },
      combined,
      divergente: false,
      dettaglio_divergenza: null,
    },
    blocked,
  }
}

function odArtifact(entries: Record<string, { status?: string; from: string[]; kind?: "defeasible" | "strict" }>) {
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

describe("OrionDocs benchmark", () => {
  it("prefers degraded safe mode over partial fixes and keeps repair obligations visible", () => {
    const result = runConsequenceLiftingSidecar({
      sessionID: "oriondocs-bench",
      callID: "call-oriondocs-bench",
      processed: [
        op("choose_degraded_safe_mode_bundle", 0.81),
        op("choose_patch_opkey_only", 0.52, true),
        op("mandatory_hotfix_gateway_honest_ack", 0.74),
        op("mandatory_hotfix_apply_worker_no_silent_drop", 0.78),
        op("mandatory_hotfix_opkey_idempotency", 0.77),
        op("mandatory_repair_pipeline", 0.8),
        op("immediate_action_stop_compactor", 0.86),
        op("risk:further_silent_data_loss_every_minute", 0.88),
      ],
      proofArtifact: odArtifact({
        choose_degraded_safe_mode_bundle: { from: ["evidence:safe_apply_mode_available", "evidence:traffic_within_capacity"] },
        choose_patch_opkey_only: { status: "Rejected", from: ["root_cause_duplicate_opkeys_on_retry"] },
        mandatory_hotfix_gateway_honest_ack: { from: ["choose_degraded_safe_mode_bundle", "legal:no_false_ack_before_persistence"] },
        mandatory_hotfix_apply_worker_no_silent_drop: { from: ["choose_degraded_safe_mode_bundle", "safety:no_silent_drop"] },
        mandatory_hotfix_opkey_idempotency: { from: ["choose_degraded_safe_mode_bundle", "safety:idempotent_storage_required"] },
        mandatory_repair_pipeline: { from: ["choose_degraded_safe_mode_bundle", "repair:accepted_not_applied_ops_present"] },
        immediate_action_stop_compactor: { from: ["choose_degraded_safe_mode_bundle", "guardrail:stop_compactor_now"] },
        "risk:further_silent_data_loss_every_minute": { from: ["choose_degraded_safe_mode_bundle", "risk:silent_loss_continues"], kind: "strict" },
      }),
    })

    const degraded = result.policies.find((policy) => policy.primaryDecision === "choose_degraded_safe_mode_bundle")
    expect(degraded).toBeDefined()
    expect(degraded!.profile.forwardBurdens.length + degraded!.profile.forwardBenefits.length).toBeGreaterThan(0)
    expect(degraded!.residualRisks).toContain("risk:further_silent_data_loss_every_minute")
  })
})
