import { describe, expect, it } from "bun:test"

import { computeParetoDominance, type ParetoConclusionInput } from "./piano-d-pareto"
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

function createConclusion(
  conclusion: string,
  valutazione: Partial<ValutazioneMultiAsse> = {},
  blocked = false,
): ParetoConclusionInput {
  return { conclusion, valutazione: createValutazione(valutazione), blocked }
}

describe("computeParetoDominance", () => {
  describe("#given empty input", () => {
    it("#then returns empty pareto-optimal set with no edges", () => {
      const result = computeParetoDominance({ conclusions: [] })
      expect(result.pareto_optimal).toEqual([])
      expect(result.edges).toEqual([])
      expect(result.incomparable_pairs).toEqual([])
      expect(result.blocked).toEqual([])
    })
  })

  describe("#given a single conclusion", () => {
    it("#then it is pareto-optimal alone with no edges", () => {
      const result = computeParetoDominance({ conclusions: [createConclusion("alpha")] })
      expect(result.pareto_optimal).toEqual(["alpha"])
      expect(result.edges).toEqual([])
      expect(result.incomparable_pairs).toEqual([])
    })
  })

  describe("#given alpha strictly better than beta on every axis", () => {
    it("#then alpha is pareto-optimal and dominates beta with all axes in reason", () => {
      const result = computeParetoDominance({
        conclusions: [
          createConclusion("alpha", {
            logico: 0.9, probabilistico: 0.9,
            etico: createEtico(0.9), pragmatico: createPragmatico(0.9), morale: createMorale(0.9),
          }),
          createConclusion("beta", {
            logico: 0.4, probabilistico: 0.4,
            etico: createEtico(0.4), pragmatico: createPragmatico(0.4), morale: createMorale(0.4),
          }),
        ],
      })
      expect(result.pareto_optimal).toEqual(["alpha"])
      expect(result.edges).toHaveLength(1)
      expect(result.edges[0].dominant).toBe("alpha")
      expect(result.edges[0].dominated).toBe("beta")
      expect(result.edges[0].reason.map((r) => r.axis).sort()).toEqual(
        ["etico", "logico", "morale", "pragmatico", "probabilistico"],
      )
      expect(result.incomparable_pairs).toEqual([])
    })
  })

  describe("#given alpha and beta trade off on different axes", () => {
    it("#then both are pareto-optimal and incomparable", () => {
      const result = computeParetoDominance({
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
      })
      expect(result.pareto_optimal.sort()).toEqual(["alpha", "beta"])
      expect(result.edges).toEqual([])
      expect(result.incomparable_pairs).toEqual([["alpha", "beta"]])
    })
  })

  describe("#given alpha equals beta on all axes (clones)", () => {
    it("#then both are pareto-optimal and there is no edge nor incomparable pair (true equivalence)", () => {
      const result = computeParetoDominance({
        conclusions: [
          createConclusion("alpha", { logico: 0.7, probabilistico: 0.7 }),
          createConclusion("beta", { logico: 0.7, probabilistico: 0.7 }),
        ],
      })
      expect(result.pareto_optimal.sort()).toEqual(["alpha", "beta"])
      expect(result.edges).toEqual([])
      expect(result.incomparable_pairs).toEqual([["alpha", "beta"]])
    })
  })

  describe("#given a chain alpha > beta > gamma on every axis", () => {
    it("#then alpha alone is pareto-optimal and edges express full transitive chain", () => {
      const result = computeParetoDominance({
        conclusions: [
          createConclusion("alpha", {
            logico: 0.9, probabilistico: 0.9,
            etico: createEtico(0.9), pragmatico: createPragmatico(0.9), morale: createMorale(0.9),
          }),
          createConclusion("beta", {
            logico: 0.6, probabilistico: 0.6,
            etico: createEtico(0.6), pragmatico: createPragmatico(0.6), morale: createMorale(0.6),
          }),
          createConclusion("gamma", {
            logico: 0.3, probabilistico: 0.3,
            etico: createEtico(0.3), pragmatico: createPragmatico(0.3), morale: createMorale(0.3),
          }),
        ],
      })
      expect(result.pareto_optimal).toEqual(["alpha"])
      const edgeKeys = result.edges.map((e) => `${e.dominant}>${e.dominated}`).sort()
      expect(edgeKeys).toEqual(["alpha>beta", "alpha>gamma", "beta>gamma"])
    })
  })

  describe("#given a blocked conclusion", () => {
    it("#then the blocked is dominated by every unblocked and never pareto-optimal", () => {
      const result = computeParetoDominance({
        conclusions: [
          createConclusion("alpha", { logico: 0.4 }, false),
          createConclusion("beta", { logico: 0.95 }, true),
        ],
      })
      expect(result.pareto_optimal).toEqual(["alpha"])
      expect(result.blocked).toEqual(["beta"])
      expect(result.edges.some((e) => e.dominant === "alpha" && e.dominated === "beta")).toBe(true)
    })
  })

  describe("#given all conclusions are blocked", () => {
    it("#then pareto-optimal is empty and blocked list has all", () => {
      const result = computeParetoDominance({
        conclusions: [
          createConclusion("alpha", {}, true),
          createConclusion("beta", {}, true),
        ],
      })
      expect(result.pareto_optimal).toEqual([])
      expect(result.blocked.sort()).toEqual(["alpha", "beta"])
      expect(result.edges).toEqual([])
    })
  })

  describe("#given conclusion with null etico/morale scores (treated as 0)", () => {
    it("#then it is dominated by anyone with positive scores on those axes", () => {
      const result = computeParetoDominance({
        conclusions: [
          createConclusion("alpha", {
            logico: 0.5, probabilistico: 0.5,
            etico: { ...createEtico(0.5), score: null },
            pragmatico: createPragmatico(0.5),
            morale: { ...createMorale(0.5), score: null },
          }),
          createConclusion("beta", {
            logico: 0.5, probabilistico: 0.5,
            etico: createEtico(0.5),
            pragmatico: createPragmatico(0.5),
            morale: createMorale(0.5),
          }),
        ],
      })
      expect(result.pareto_optimal).toEqual(["beta"])
      expect(result.edges).toHaveLength(1)
      expect(result.edges[0].dominant).toBe("beta")
      expect(result.edges[0].dominated).toBe("alpha")
    })
  })
})
