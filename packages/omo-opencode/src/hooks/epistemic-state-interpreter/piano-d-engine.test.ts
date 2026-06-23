import { describe, expect, it } from "bun:test"

import { computePianoD } from "./piano-d-engine"
import type { AudienceAnalysis } from "../reasoning-core-policy-gate/extended-response-types"
import type {
  EticoOutput,
  MoraleOutput,
  PragmaticoOutput,
  ValutazioneMultiAsse,
} from "./multi-plane-types"

function createEtico(score: number): EticoOutput {
  return {
    score,
    label: score >= 0.5 ? "lecito" : "illecito",
    allineamento_legale: score,
    valore_empatico: score,
    magnitudine_beneficio: score,
    override: false,
    reason: null,
  }
}

function createPragmatico(score: number): PragmaticoOutput {
  return {
    score,
    label: score >= 0.6 ? "conveniente" : score < 0.4 ? "sconveniente" : "condizionata",
    beneficio_proprio: score,
    beneficio_controparte: score,
    costo_proprio: 1 - score,
    costo_controparte: 1 - score,
    pesatura: { proprio: 0.5, controparte: 0.5 },
  }
}

function createMorale(score: number | null): MoraleOutput {
  return {
    score,
    label: score === null ? null : score >= 0.6 ? "giustificabile" : score < 0.4 ? "problematica" : "dipendente_dal_contesto",
    contesto_sociale: null,
    comprensione_destinatari: null,
    impatto_cascata: score ?? 0,
    intenzione: "benevola",
    trasparenza: 0.8,
    fiducia_risultante: 0.8,
    reason: null,
  }
}

function createValutazione(overrides: Partial<ValutazioneMultiAsse> = {}): ValutazioneMultiAsse {
  return {
    logico: 0.8,
    probabilistico: 0.8,
    etico: createEtico(0.8),
    pragmatico: createPragmatico(0.8),
    morale: createMorale(0.8),
    combined: 0.8,
    divergente: false,
    dettaglio_divergenza: null,
    ...overrides,
  }
}

function createUniformValutazione(score: number, overrides: Partial<ValutazioneMultiAsse> = {}): ValutazioneMultiAsse {
  return createValutazione({
    logico: score,
    probabilistico: score,
    etico: createEtico(score),
    pragmatico: createPragmatico(score),
    morale: createMorale(score),
    combined: score,
    ...overrides,
  })
}

function createConclusion(
  conclusion: string,
  valutazione: Partial<ValutazioneMultiAsse> = {},
  blocked = false,
) {
  return { conclusion, valutazione: createValutazione(valutazione), blocked }
}

function createUniformConclusion(conclusion: string, score: number, blocked = false) {
  return { conclusion, valutazione: createUniformValutazione(score), blocked }
}

function buildAudienceAnalysis(
  audiences: AudienceAnalysis["audiences"],
  consensus: AudienceAnalysis["consensus"] = "unanimous",
): AudienceAnalysis {
  return {
    audiences,
    consensus,
    per_audience: Object.fromEntries(audiences.map((a) => [a.audience_id, a])),
  }
}

describe("computePianoD", () => {
  describe("#given no conclusions", () => {
    it("#then returns empty result with decision_kind=empty", () => {
      const result = computePianoD({ conclusions: [] })
      expect(result.ranking).toEqual([])
      expect(result.dominante).toBeNull()
      expect(result.pareto_optimal).toEqual([])
      expect(result.incomparable_pairs).toEqual([])
      expect(result.decision_kind).toBe("empty")
      expect(result.audience_consensus).toBeNull()
    })
  })

  describe("#given one conclusion", () => {
    it("#then it is dominant with full convergent axes", () => {
      const result = computePianoD({ conclusions: [createConclusion("alpha")] })
      expect(result.ranking).toEqual([{ conclusion: "alpha", score: 0.8 }])
      expect(result.dominante).toBe("alpha")
      expect(result.margine).toBe(1)
      expect(result.preferibile_ma_non_certo).toBe(false)
      expect(result.assi_convergenti).toEqual(["logico", "probabilistico", "etico", "pragmatico", "morale"])
      expect(result.assi_divergenti).toEqual([])
      expect(result.pareto_optimal).toEqual(["alpha"])
      expect(result.decision_kind).toBe("pareto_unique")
    })
  })

  describe("#given alpha strictly Pareto-dominates beta on all axes", () => {
    it("#then alpha is dominante with decision_kind=pareto_unique", () => {
      const result = computePianoD({
        conclusions: [
          createUniformConclusion("beta", 0.4),
          createUniformConclusion("alpha", 0.9),
        ],
      })
      expect(result.dominante).toBe("alpha")
      expect(result.decision_kind).toBe("pareto_unique")
      expect(result.pareto_optimal).toEqual(["alpha"])
      expect(result.incomparable_pairs).toEqual([])
      expect(result.margine).toBe(0.5)
    })
  })

  describe("#given alpha and beta are Pareto-incomparable (trade off on different axes)", () => {
    it("#then dominante is null and decision_kind=contested", () => {
      const result = computePianoD({
        conclusions: [
          createConclusion("alpha", {
            logico: 0.9, probabilistico: 0.9,
            etico: createEtico(0.9), pragmatico: createPragmatico(0.2), morale: createMorale(0.9),
            combined: 0.9,
          }),
          createConclusion("beta", {
            logico: 0.5, probabilistico: 0.5,
            etico: createEtico(0.5), pragmatico: createPragmatico(0.95), morale: createMorale(0.5),
            combined: 0.4,
          }),
        ],
      })
      expect(result.dominante).toBeNull()
      expect(result.decision_kind).toBe("contested")
      expect(result.pareto_optimal.sort()).toEqual(["alpha", "beta"])
      expect(result.incomparable_pairs).toEqual([["alpha", "beta"]])
    })
  })

  describe("#given Pareto-incomparable conclusions but audienceAnalysis with unanimous consensus on alpha", () => {
    it("#then dominante is alpha with decision_kind=pareto_with_audience_consensus", () => {
      const result = computePianoD({
        conclusions: [
          createConclusion("alpha", {
            logico: 0.9, probabilistico: 0.9,
            etico: createEtico(0.9), pragmatico: createPragmatico(0.2), morale: createMorale(0.9),
          }),
          createConclusion("beta", {
            logico: 0.5, probabilistico: 0.5,
            etico: createEtico(0.5), pragmatico: createPragmatico(0.95), morale: createMorale(0.5),
          }),
        ],
        audienceAnalysis: buildAudienceAnalysis([
          { audience_id: "a1", audience_label: "A1", value_ordering: ["@value:safety"], selected_option: "alpha", verdict: "selected" },
          { audience_id: "a2", audience_label: "A2", value_ordering: ["@value:autonomy"], selected_option: "alpha", verdict: "selected" },
        ]),
      })
      expect(result.dominante).toBe("alpha")
      expect(result.decision_kind).toBe("pareto_with_audience_consensus")
      expect(result.audience_consensus?.kind).toBe("unanimous")
      expect(result.audience_consensus?.choice).toBe("alpha")
    })
  })

  describe("#given Pareto-incomparable conclusions with majority audience preference", () => {
    it("#then dominante is the majority pick with decision_kind=pareto_with_audience_majority and preferibile_ma_non_certo=true", () => {
      const result = computePianoD({
        conclusions: [
          createConclusion("alpha", {
            logico: 0.9, probabilistico: 0.9,
            etico: createEtico(0.9), pragmatico: createPragmatico(0.2), morale: createMorale(0.9),
          }),
          createConclusion("beta", {
            logico: 0.5, probabilistico: 0.5,
            etico: createEtico(0.5), pragmatico: createPragmatico(0.95), morale: createMorale(0.5),
          }),
        ],
        audienceAnalysis: buildAudienceAnalysis([
          { audience_id: "a1", audience_label: "A1", value_ordering: [], selected_option: "alpha", verdict: "selected" },
          { audience_id: "a2", audience_label: "A2", value_ordering: [], selected_option: "alpha", verdict: "selected" },
          { audience_id: "a3", audience_label: "A3", value_ordering: [], selected_option: "beta", verdict: "selected" },
        ]),
      })
      expect(result.dominante).toBe("alpha")
      expect(result.decision_kind).toBe("pareto_with_audience_majority")
      expect(result.preferibile_ma_non_certo).toBe(true)
      expect(result.audience_consensus?.kind).toBe("majority")
    })
  })

  describe("#given Pareto-incomparable conclusions with split audiences", () => {
    it("#then dominante is null with decision_kind=contested", () => {
      const result = computePianoD({
        conclusions: [
          createConclusion("alpha", {
            logico: 0.9, probabilistico: 0.5,
            etico: createEtico(0.9), pragmatico: createPragmatico(0.5), morale: createMorale(0.5),
          }),
          createConclusion("beta", {
            logico: 0.5, probabilistico: 0.9,
            etico: createEtico(0.5), pragmatico: createPragmatico(0.9), morale: createMorale(0.9),
          }),
        ],
        audienceAnalysis: buildAudienceAnalysis(
          [
            { audience_id: "a1", audience_label: "A1", value_ordering: [], selected_option: "alpha", verdict: "selected" },
            { audience_id: "a2", audience_label: "A2", value_ordering: [], selected_option: "beta", verdict: "selected" },
          ],
          "split",
        ),
      })
      expect(result.dominante).toBeNull()
      expect(result.decision_kind).toBe("contested")
      expect(result.audience_consensus?.kind).toBe("split")
    })
  })

  describe("#given highest combined is blocked", () => {
    it("#then blocked is dominated by unblocked and unblocked wins", () => {
      const result = computePianoD({
        conclusions: [
          createUniformConclusion("alpha", 0.9, true),
          createUniformConclusion("beta", 0.6),
        ],
      })
      expect(result.ranking).toEqual([
        { conclusion: "beta", score: 0.6 },
        { conclusion: "alpha", score: 0.45 },
      ])
      expect(result.dominante).toBe("beta")
      expect(result.decision_kind).toBe("pareto_unique")
      expect(result.pareto_optimal).toEqual(["beta"])
    })
  })

  describe("#given alpha Pareto-dominates beta with small margin", () => {
    it("#then alpha is dominante and preferibile_ma_non_certo flagged due to small margine", () => {
      const result = computePianoD({
        conclusions: [
          createUniformConclusion("alpha", 0.55),
          createUniformConclusion("beta", 0.3),
        ],
      })
      expect(result.dominante).toBe("alpha")
      expect(result.decision_kind).toBe("pareto_unique")
      expect(result.preferibile_ma_non_certo).toBe(true)
    })
  })

  describe("#given top two conclusions disagree on some axes (Pareto-incomparable)", () => {
    it("#then dominante is null and assi_divergenti reports the divergence", () => {
      const result = computePianoD({
        conclusions: [
          createConclusion("alpha", {
            combined: 0.9,
            logico: 0.9, probabilistico: 0.9,
            etico: createEtico(0.8), pragmatico: createPragmatico(0.3), morale: createMorale(0.8),
          }),
          createConclusion("beta", {
            combined: 0.4,
            logico: 0.4, probabilistico: 0.3,
            etico: createEtico(0.2), pragmatico: createPragmatico(0.9), morale: createMorale(0.1),
          }),
        ],
      })
      expect(result.assi_convergenti).toEqual(["logico", "probabilistico", "etico", "morale"])
      expect(result.assi_divergenti).toEqual(["pragmatico"])
      expect(result.decision_kind).toBe("contested")
      expect(result.dominante).toBeNull()
      expect(result.preferibile_ma_non_certo).toBe(false)
    })
  })

  describe("#given top two conclusions align on every axis", () => {
    it("#then assi_convergenti reports all axes and decision_kind is pareto_unique", () => {
      const result = computePianoD({
        conclusions: [
          createConclusion("alpha", {
            combined: 0.95,
            logico: 0.95, probabilistico: 0.9,
            etico: createEtico(0.9), pragmatico: createPragmatico(0.85), morale: createMorale(0.8),
          }),
          createConclusion("beta", {
            combined: 0.4,
            logico: 0.4, probabilistico: 0.3,
            etico: createEtico(0.2), pragmatico: createPragmatico(0.1), morale: createMorale(0.2),
          }),
        ],
      })
      expect(result.assi_convergenti).toEqual([
        "logico",
        "probabilistico",
        "etico",
        "pragmatico",
        "morale",
      ])
      expect(result.assi_divergenti).toEqual([])
      expect(result.dominante).toBe("alpha")
      expect(result.decision_kind).toBe("pareto_unique")
    })
  })

  describe("#given all conclusions are blocked", () => {
    it("#then dominante is null and decision_kind=all_blocked", () => {
      const result = computePianoD({
        conclusions: [
          createUniformConclusion("alpha", 0.9, true),
          createUniformConclusion("beta", 0.7, true),
        ],
      })
      expect(result.dominante).toBeNull()
      expect(result.decision_kind).toBe("all_blocked")
      expect(result.pareto_optimal).toEqual([])
    })
  })
})
