import { describe, expect, test } from "bun:test"

import "./multi-plane-types"

import type {
  AmmissibilitaState,
  DominanzaDecisionale,
  EticoOutput,
  ForzaQuantitativa,
  MoraleOutput,
  MultiPlaneAnnotation,
  MultiPlaneState,
  PotenzaInferenziale,
  ValutazioneMultiAsse,
} from "./multi-plane-types"

describe("multi-plane-types", () => {
  describe("given piano A states", () => {
    test("then all canonical ammissibilita values are assignable", () => {
      const values: AmmissibilitaState[] = [
        "possibile",
        "non_escluso",
        "da_verificare",
        "plausibile",
        "escluso_operativamente",
        "escluso",
      ]

      expect(values).toHaveLength(6)
    })
  })

  describe("given forza quantitativa without data", () => {
    test("then probabile can be null while plausibile stays false", () => {
      const forzaQuantitativa: ForzaQuantitativa = {
        probabile: null,
        plausibile: false,
      }

      expect(forzaQuantitativa).toEqual({ probabile: null, plausibile: false })
    })
  })

  describe("given potenza inferenziale with empty dependency chain", () => {
    test("then autosufficiente can remain unknown", () => {
      const potenzaInferenziale: PotenzaInferenziale = {
        inconclusivo: true,
        autosufficiente: null,
        catena_dipendenze: [],
        ha_dipendenza_circolare: false,
      }

      expect(potenzaInferenziale.autosufficiente).toBeNull()
      expect(potenzaInferenziale.catena_dipendenze).toEqual([])
    })
  })

  describe("given dominance data without ranking", () => {
    test("then dominante can remain null", () => {
      const dominanzaDecisionale: DominanzaDecisionale = {
        ranking: [],
        dominante: null,
        margine: 0,
        preferibile_ma_non_certo: false,
        assi_convergenti: [],
        assi_divergenti: [],
      }

      expect(dominanzaDecisionale.dominante).toBeNull()
    })
  })

  describe("given a fully populated state", () => {
    test("then all planes are assignable at once", () => {
      const state: MultiPlaneState = {
        pianoA: "plausibile",
        pianoB: { probabile: 0.82, plausibile: true },
        pianoC: {
          inconclusivo: false,
          autosufficiente: true,
          catena_dipendenze: ["r1", "r2"],
          ha_dipendenza_circolare: false,
        },
        pianoD: {
          ranking: [{ conclusion: "alpha", score: 0.82 }],
          dominante: "alpha",
          margine: 0.2,
          preferibile_ma_non_certo: false,
          assi_convergenti: ["logico", "probabilistico"],
          assi_divergenti: [],
        },
      }

      expect(state.pianoD?.dominante).toBe("alpha")
    })
  })

  describe("given an annotation before evaluators run", () => {
    test("then valutazione can be null", () => {
      const annotation: MultiPlaneAnnotation = {
        conclusion: "alpha",
        state: {
          pianoA: "da_verificare",
          pianoB: { probabile: null, plausibile: false },
          pianoC: {
            inconclusivo: true,
            autosufficiente: null,
            catena_dipendenze: [],
            ha_dipendenza_circolare: false,
          },
          pianoD: null,
        },
        rawClassification: "da_verificare",
        reason: "awaiting evaluation",
        timestamp: 1,
        callID: "call-1",
        proofChainKind: "unknown",
        extensionMembership: { inCount: 0, totalCount: 0 },
        valutazione: null,
      }

      expect(annotation.valutazione).toBeNull()
    })
  })

  describe("given evaluation outputs", () => {
    test("then etico output can signal an override", () => {
      const etico: EticoOutput = {
        score: 0.9,
        label: "lecito",
        allineamento_legale: 1,
        valore_empatico: 0.8,
        magnitudine_beneficio: 0.7,
        override: true,
        reason: null,
      }

      expect(etico.override).toBeTrue()
    })

    test("then multi-axis evaluation can flag divergence", () => {
      const valutazione: ValutazioneMultiAsse = {
        logico: 0.8,
        probabilistico: 0.7,
        etico: {
          score: 0.9,
          label: "lecito",
          allineamento_legale: 1,
          valore_empatico: 0.8,
          magnitudine_beneficio: 0.7,
          override: false,
          reason: null,
        },
        pragmatico: {
          score: 0.65,
          label: "conveniente",
    beneficio_proprio: 0.4,
          beneficio_controparte: 0.8,
          costo_proprio: 0.2,
          costo_controparte: 0.1,
          pesatura: { proprio: 0.4, controparte: 0.6 },
        },
        morale: {
          score: 0.6,
          label: "giustificabile",
    contesto_sociale: "team-review",
          comprensione_destinatari: "high",
          impatto_cascata: 0.4,
          intenzione: "benevola",
          trasparenza: 0.9,
          fiducia_risultante: 0.75,
          reason: null,
        },
        combined: 0.74,
        divergente: true,
        dettaglio_divergenza: "moral and probabilistic axes disagree",
      }

      expect(valutazione.divergente).toBeTrue()
      expect(valutazione.dettaglio_divergenza).toBe("moral and probabilistic axes disagree")
    })

    test("then a full annotation can embed a multi-axis valuation", () => {
      const etico: EticoOutput = {
        score: 0.9,
        label: "lecito",
        allineamento_legale: 1,
        valore_empatico: 0.8,
        magnitudine_beneficio: 0.7,
        override: true,
        reason: null,
      }
      const morale: MoraleOutput = {
        score: 0.6,
        label: "giustificabile",
    contesto_sociale: "team-review",
        comprensione_destinatari: "high",
        impatto_cascata: 0.4,
        intenzione: "benevola",
        trasparenza: 0.9,
        fiducia_risultante: 0.75,
        reason: null,
      }
      const valutazione: ValutazioneMultiAsse = {
        logico: 0.8,
        probabilistico: 0.7,
        etico,
        pragmatico: {
          score: 0.65,
          label: "conveniente",
    beneficio_proprio: 0.4,
          beneficio_controparte: 0.8,
          costo_proprio: 0.2,
          costo_controparte: 0.1,
          pesatura: { proprio: 0.4, controparte: 0.6 },
        },
        morale,
        combined: 0.74,
        divergente: true,
        dettaglio_divergenza: "moral and probabilistic axes disagree",
      }

      const annotation: MultiPlaneAnnotation = {
        conclusion: "beta",
        state: {
          pianoA: "plausibile",
          pianoB: { probabile: 0.74, plausibile: true },
          pianoC: {
            inconclusivo: false,
            autosufficiente: false,
            catena_dipendenze: ["beta<-gamma"],
            ha_dipendenza_circolare: false,
          },
          pianoD: null,
        },
        rawClassification: "non_escluso",
        reason: "supported by current evidence",
        timestamp: 2,
        callID: "call-2",
        proofChainKind: "mixed",
        extensionMembership: { inCount: 2, totalCount: 3 },
        valutazione,
      }

      expect(annotation.valutazione?.combined).toBe(0.74)
      expect(annotation.valutazione?.etico.override).toBeTrue()
      expect(annotation.valutazione?.divergente).toBeTrue()
    })

    test("then morale output can explain missing score", () => {
      const morale: MoraleOutput = {
        score: null,
        label: null,
    contesto_sociale: null,
        comprensione_destinatari: null,
        impatto_cascata: 0,
        intenzione: "neutra",
        trasparenza: 0,
        fiducia_risultante: 0,
        reason: "no audience model available",
      }

      expect(morale.score).toBeNull()
      expect(morale.reason).toBe("no audience model available")
    })
  })
})
