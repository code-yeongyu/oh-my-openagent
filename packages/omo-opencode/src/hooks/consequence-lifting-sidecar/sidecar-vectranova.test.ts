import { describe, expect, it } from "bun:test"

import { runConsequenceLiftingSidecar } from "./sidecar"
import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"

function mk(conclusion: string, combined: number, tags: string[] = []): ProcessedConclusion {
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
      reason: conclusion,
      timestamp: 1,
      callID: "call-vns",
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
        pragmatici: { beneficio_potenziale: combined, urgenza: 0.4, costo_verifica: 0.2, rischio: 0.4 },
      },
      rationale: conclusion,
      timestamp: 1,
      sessionId: "ses-vns",
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
    blocked: false,
  }
}

function vnsArtifact(entries: Record<string, string[]>) {
  return {
    result: {
      semantics: "preferred",
      extensions: [{ index: 0, accepted_conclusions: Object.keys(entries) }],
      conclusions: Object.fromEntries(Object.entries(entries).map(([conclusion, from]) => [
        conclusion,
        {
          conclusion,
          status: "Accepted",
          proof_chain: [
            ...from.map((premise) => ({ conclusion: premise, from: [], rule_id: null, rule_kind: "ordinary" as const })),
            { conclusion, from, rule_id: `${conclusion}-rule`, rule_kind: "defeasible" },
          ],
        },
      ])),
    },
  }
}

describe("VectraNova benchmark", () => {
  it("does not leave the selected adaptive trading policy forward-empty", () => {
    const result = runConsequenceLiftingSidecar({
      sessionID: "vectra-bench",
      callID: "call-vectra-bench",
      processed: [
        mk("choose_long_conditioned_hedged", 0.72),
        mk("choose_two_phase_conditional", 0.69),
        mk("optionality_preserved", 0.77),
        mk("equity_raise_probability_exceeds_035", 0.81),
        mk("compliant_position_structure", 0.74),
        mk("upside_capped_by_regulatory", 0.55),
      ],
      proofArtifact: vnsArtifact({
        choose_long_conditioned_hedged: ["evidence:titan_deal_probable", "risk:equity_raise_probability"],
        choose_two_phase_conditional: ["evidence:call_1230_info_event_imminent", "strategic_thesis_bullish"],
        optionality_preserved: ["choose_two_phase_conditional", "info_event:imminent"],
        equity_raise_probability_exceeds_035: ["risk:equity_raise_if_true", "risk:equity_raise_if_false"],
        compliant_position_structure: ["choose_long_conditioned_hedged", "legal:max_long_overnight_3pct_nav"],
        upside_capped_by_regulatory: ["choose_long_conditioned_hedged", "pragmatic:export_controls_risk"],
      }),
    })

    const conditioned = result.policies.find((policy) => policy.primaryDecision === "choose_long_conditioned_hedged")
    const twoPhase = result.policies.find((policy) => policy.primaryDecision === "choose_two_phase_conditional")

    expect(conditioned).toBeDefined()
    expect(twoPhase).toBeDefined()
    expect(twoPhase!.profile.forwardBenefits.map((item) => item.conclusion)).toContain("optionality_preserved")
  })
})
