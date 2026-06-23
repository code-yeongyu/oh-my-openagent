import { describe, expect, test } from "bun:test"

import type { MultiPlaneAnnotation } from "./multi-plane-types"
import {
  deriveAspicPreferences,
  injectDerivedPreferences,
} from "./preference-injection-v2"

function createMockAnnotation(conclusion: string, combined: number): MultiPlaneAnnotation {
  return {
    conclusion,
    state: {
      pianoA: "plausibile",
      pianoB: { probabile: combined, plausibile: combined >= 0.5 },
      pianoC: {
        inconclusivo: false,
        autosufficiente: true,
        catena_dipendenze: [],
        ha_dipendenza_circolare: false,
      },
      pianoD: null,
    },
    rawClassification: "plausibile",
    reason: `derived ${conclusion}`,
    timestamp: 1,
    callID: "call-1",
    proofChainKind: "strict",
    extensionMembership: { inCount: 1, totalCount: 1 },
    valutazione: {
      logico: combined,
      probabilistico: combined,
      etico: {
        score: combined,
        label: combined >= 0.5 ? "lecito" : "illecito",
        allineamento_legale: combined,
        valore_empatico: combined,
        magnitudine_beneficio: combined,
        override: false,
        reason: null,
      },
      pragmatico: {
        score: combined,
        label: combined >= 0.6 ? "conveniente" : combined < 0.4 ? "sconveniente" : "condizionata",
        beneficio_proprio: combined,
        beneficio_controparte: combined,
        costo_proprio: 1 - combined,
        costo_controparte: 1 - combined,
        pesatura: { proprio: 0.5, controparte: 0.5 },
      },
      morale: {
        score: combined,
        label: combined >= 0.6 ? "giustificabile" : combined < 0.4 ? "problematica" : "dipendente_dal_contesto",
        contesto_sociale: "team",
        comprensione_destinatari: "high",
        impatto_cascata: combined,
        intenzione: "benevola",
        trasparenza: combined,
        fiducia_risultante: combined,
        reason: null,
      },
      combined,
      divergente: false,
      dettaglio_divergenza: null,
    },
  }
}

describe("deriveAspicPreferences", () => {
  describe("#given empty annotations", () => {
    test("#when deriving preferences #then it returns an empty result", () => {
      expect(deriveAspicPreferences([])).toEqual({ injected: [], blocked: [] })
    })
  })

  describe("#given a single annotation", () => {
    test("#when deriving preferences #then it returns no pairwise preferences", () => {
      expect(deriveAspicPreferences([createMockAnnotation("a", 0.9)])).toEqual({
        injected: [],
        blocked: ["a"],
      })
    })
  })

  describe("#given two annotations with a clear winner", () => {
    test("#when deriving preferences #then it emits one preference entry", () => {
      expect(
        deriveAspicPreferences([
          createMockAnnotation("alpha", 0.9),
          createMockAnnotation("beta", 0.3),
        ]),
      ).toEqual({
        injected: [{ superior: "alpha", inferior: "beta" }],
        blocked: ["beta"],
      })
    })
  })

  describe("#given two annotations with tied scores", () => {
    test("#when deriving preferences #then it skips the pair", () => {
      expect(
        deriveAspicPreferences([
          createMockAnnotation("alpha", 0.5),
          createMockAnnotation("beta", 0.5005),
        ]),
      ).toEqual({ injected: [], blocked: ["alpha", "beta"] })
    })
  })

  describe("#given three ranked annotations", () => {
    test("#when deriving preferences #then it emits all pairwise orderings", () => {
      expect(
        deriveAspicPreferences([
          createMockAnnotation("alpha", 0.9),
          createMockAnnotation("beta", 0.6),
          createMockAnnotation("gamma", 0.2),
        ]),
      ).toEqual({
        injected: [
          { superior: "alpha", inferior: "beta" },
          { superior: "alpha", inferior: "gamma" },
          { superior: "beta", inferior: "gamma" },
        ],
        blocked: ["gamma"],
      })
    })
  })

  describe("#given a divergent winning annotation", () => {
    test("#when deriving preferences #then it still injects the preference", () => {
      const annotation = createMockAnnotation("alpha", 0.8)
      annotation.valutazione = { ...annotation.valutazione!, divergente: true }

      expect(
        deriveAspicPreferences([annotation, createMockAnnotation("beta", 0.2)]),
      ).toEqual({
        injected: [{ superior: "alpha", inferior: "beta" }],
        blocked: ["beta"],
      })
    })
  })
})

describe("injectDerivedPreferences", () => {
  describe("#given a theory without preferences", () => {
    test("#when injecting derived preferences #then it adds them to the theory", () => {
      const theory: Record<string, unknown> = {}

      injectDerivedPreferences(theory, {
        injected: [{ superior: "alpha", inferior: "beta" }],
        blocked: ["beta"],
      })

      expect(theory.preferences).toEqual([{ superior: "alpha", inferior: "beta" }])
    })
  })

  describe("#given a theory with existing preferences", () => {
    test("#when injecting derived preferences #then it appends to the existing list", () => {
      const theory: Record<string, unknown> = {
        preferences: [{ superior: "seed", inferior: "legacy" }],
      }

      injectDerivedPreferences(theory, {
        injected: [{ superior: "alpha", inferior: "beta" }],
        blocked: [],
      })

      expect(theory.preferences).toEqual([
        { superior: "seed", inferior: "legacy" },
        { superior: "alpha", inferior: "beta" },
      ])
    })
  })

  describe("#given no derived injections", () => {
    test("#when injecting derived preferences #then it leaves the theory unchanged", () => {
      const theory: Record<string, unknown> = {
        preferences: [{ superior: "seed", inferior: "legacy" }],
      }

      injectDerivedPreferences(theory, { injected: [], blocked: [] })

      expect(theory.preferences).toEqual([{ superior: "seed", inferior: "legacy" }])
    })
  })
})
