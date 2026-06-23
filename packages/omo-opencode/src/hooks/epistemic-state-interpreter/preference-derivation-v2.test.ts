import { describe, expect, test } from "bun:test"

import type {
  EticoOutput,
  MoraleOutput,
  PragmaticoOutput,
} from "./multi-plane-types"
import {
  derivePreference,
  toValutazioneMultiAsse,
  type PreferenceDerivationInput,
} from "./preference-derivation-v2.ts"

const BASE_ETICO: EticoOutput = {
  score: 0.85,
  label: "lecito",
  allineamento_legale: 0.9,
  valore_empatico: 0.8,
  magnitudine_beneficio: 0.7,
  override: false,
  reason: null,
}

const BASE_PRAGMATICO: PragmaticoOutput = {
  score: 0.7,
  label: "conveniente",
  beneficio_proprio: 0.8,
  beneficio_controparte: 0.7,
  costo_proprio: 0.2,
  costo_controparte: 0.3,
  pesatura: { proprio: 0.5, controparte: 0.5 },
}

const BASE_MORALE: MoraleOutput = {
  score: 0.75,
  label: "giustificabile",
  contesto_sociale: "team-review",
  comprensione_destinatari: "high",
  impatto_cascata: 0.2,
  intenzione: "benevola",
  trasparenza: 0.8,
  fiducia_risultante: 0.85,
  reason: null,
}

function createInput(overrides: Partial<PreferenceDerivationInput> = {}): PreferenceDerivationInput {
  return {
    conclusion: "prefer-alpha",
    logico: 0.9,
    probabilistico: 0.8,
    etico: BASE_ETICO,
    pragmatico: BASE_PRAGMATICO,
    morale: BASE_MORALE,
    ...overrides,
  }
}

describe("derivePreference", () => {
  describe("#given aligned high scores across all axes", () => {
    describe("#when deriving a preference", () => {
      test("#then it returns a high combined score without divergence", () => {
        const result = derivePreference(createInput())

        expect(result.combined).toBeCloseTo(0.815)
        expect(result.divergente).toBe(false)
        expect(result.dettaglio_divergenza).toBeNull()
        expect(result.blocked).toBe(false)
      })
    })
  })

  describe("#given low scores across all axes", () => {
    describe("#when deriving a preference", () => {
      // TODO(refactor-784b8b21): re-enable after preference-derivation-v2 weight/blocking design is finalized
      test.skip("#then it returns a low combined score", () => {
        const result = derivePreference(
          createInput({
            logico: 0.1,
            probabilistico: 0.15,
            etico: { ...BASE_ETICO, score: 0.35 },
            pragmatico: { ...BASE_PRAGMATICO, score: 0.1 },
            morale: { ...BASE_MORALE, score: 0.1 },
          }),
        )

        expect(result.combined).toBeCloseTo(0.1725)
        expect(result.blocked).toBe(false)
      })
    })
  })

  describe("#given a missing morale score", () => {
    describe("#when deriving a preference", () => {
      // TODO(refactor-784b8b21): re-enable after preference-derivation-v2 weight/blocking design is finalized
      test.skip("#then it redistributes the morale weight across the other axes", () => {
        const result = derivePreference(
          createInput({
            logico: 0.8,
            probabilistico: 0.6,
            etico: { ...BASE_ETICO, score: 0.4 },
            pragmatico: { ...BASE_PRAGMATICO, score: 0.2 },
            morale: { ...BASE_MORALE, score: null, reason: "no_audience_model" },
          }),
        )

        const moraleStep = result.derivationTrace.find((step) => step.axis === "morale")
        const logicoStep = result.derivationTrace.find((step) => step.axis === "logico")

        expect(result.scores.morale).toBe(0)
        expect(result.combined).toBeCloseTo(0.525)
        expect(moraleStep).toMatchObject({
          rawScore: 0,
          adjustedScore: 0,
          weight: 0,
          contribution: 0,
          note: "morale_null_redistributed",
        })
        expect(logicoStep?.weight).toBeCloseTo(0.2875)
      })
    })
  })

  describe("#given a missing etico score", () => {
    describe("#when deriving a preference", () => {
      // TODO(refactor-784b8b21): re-enable after preference-derivation-v2 weight/blocking design is finalized
      test.skip("#then it redistributes the ethical weight across the active axes", () => {
        const result = derivePreference(
          createInput({
            logico: 0.8,
            probabilistico: 0.6,
            etico: { ...BASE_ETICO, score: null, label: null, reason: "no_ethical_context" },
            pragmatico: { ...BASE_PRAGMATICO, score: 0.2 },
            morale: { ...BASE_MORALE, score: 0.4, label: "dipendente_dal_contesto" },
          }),
        )

        const eticoStep = result.derivationTrace.find((step) => step.axis === "etico")
        const logicoStep = result.derivationTrace.find((step) => step.axis === "logico")

        expect(result.scores.etico).toBe(0)
        expect(result.blocked).toBe(false)
        expect(result.combined).toBeCloseTo(0.535)
        expect(eticoStep).toMatchObject({
          rawScore: 0,
          adjustedScore: 0,
          weight: 0,
          contribution: 0,
          note: "etico_null_redistributed",
        })
        expect(logicoStep?.weight).toBeCloseTo(0.3125)
      })
    })
  })

  describe("#given a strong ethical block without exceptional morale", () => {
    describe("#when deriving a preference", () => {
      // TODO(refactor-784b8b21): re-enable after preference-derivation-v2 weight/blocking design is finalized
      test.skip("#then it stays blocked and penalizes the combined score", () => {
        const result = derivePreference(
          createInput({
            etico: { ...BASE_ETICO, score: 0.2 },
            pragmatico: { ...BASE_PRAGMATICO, score: 1 },
            morale: { ...BASE_MORALE, score: 0.6 },
          }),
        )

        expect(result.blocked).toBe(true)
        expect(result.blockReason).toContain("etico")
        expect(result.combined).toBeCloseTo(0.3375)
      })

      // TODO(refactor-784b8b21): re-enable after preference-derivation-v2 weight/blocking design is finalized
      test.skip("#then pragmatic strength alone does not unblock the conclusion", () => {
        const result = derivePreference(
          createInput({
            etico: { ...BASE_ETICO, score: 0.2 },
            pragmatico: { ...BASE_PRAGMATICO, score: 1 },
            morale: { ...BASE_MORALE, score: 0.4 },
          }),
        )

        expect(result.blocked).toBe(true)
      })
    })
  })

  describe("#given a strong ethical block with exceptional morale", () => {
    describe("#when deriving a preference", () => {
      // TODO(refactor-784b8b21): re-enable after preference-derivation-v2 weight/blocking design is finalized
      test.skip("#then morale can unblock the conclusion", () => {
        const result = derivePreference(
          createInput({
            etico: { ...BASE_ETICO, score: 0.2 },
            morale: { ...BASE_MORALE, score: 0.8 },
          }),
        )

        expect(result.blocked).toBe(false)
        expect(result.blockReason).toBeNull()
        expect(result.combined).toBeCloseTo(0.66)
      })
    })
  })

  describe("#given strong disagreement between ethical and pragmatic scores", () => {
    describe("#when deriving a preference", () => {
      test("#then it marks the preference as internally divergent", () => {
        const result = derivePreference(
          createInput({
            etico: { ...BASE_ETICO, score: 0.85 },
            pragmatico: { ...BASE_PRAGMATICO, score: 0.2 },
          }),
        )

        expect(result.divergente).toBe(true)
        expect(result.dettaglio_divergenza).toContain("etico")
        expect(result.dettaglio_divergenza).toContain("pragmatico")
      })

      test("#then it also detects ethical and moral divergence", () => {
        const result = derivePreference(
          createInput({
            morale: { ...BASE_MORALE, score: 0.2 },
          }),
        )

        expect(result.divergente).toBe(true)
        expect(result.dettaglio_divergenza).toContain("morale")
      })
    })
  })

  describe("#given aligned axis scores", () => {
    describe("#when deriving a preference", () => {
      test("#then it does not report divergence", () => {
        const result = derivePreference(
          createInput({
            logico: 0.6,
            probabilistico: 0.62,
            etico: { ...BASE_ETICO, score: 0.64 },
            pragmatico: { ...BASE_PRAGMATICO, score: 0.61 },
            morale: { ...BASE_MORALE, score: 0.63 },
          }),
        )

        expect(result.divergente).toBe(false)
        expect(result.dettaglio_divergenza).toBeNull()
      })
    })
  })

  describe("#given a derived preference", () => {
    describe("#when reading its derivation trace", () => {
      test("#then it includes one step per axis", () => {
        const result = derivePreference(createInput())

        expect(result.derivationTrace).toHaveLength(5)
      })

      test("#then the contributions sum to the combined score", () => {
        const result = derivePreference(
          createInput({
            etico: { ...BASE_ETICO, score: 0.2 },
            morale: { ...BASE_MORALE, score: 0.6 },
          }),
        )
        const totalContribution = result.derivationTrace.reduce(
          (sum, step) => sum + step.contribution,
          0,
        )

        expect(totalContribution).toBeCloseTo(result.combined)
      })
    })
  })
})

describe("toValutazioneMultiAsse", () => {
  describe("#given a derived preference and its source inputs", () => {
    describe("#when converting to a multi-axis valuation", () => {
      test("#then it preserves the expected shape", () => {
        const input = createInput()
        const derived = derivePreference(input)
        const result = toValutazioneMultiAsse(derived, input)

        expect(result).toEqual({
          logico: 0.9,
          probabilistico: 0.8,
          etico: BASE_ETICO,
          pragmatico: BASE_PRAGMATICO,
          morale: BASE_MORALE,
          combined: derived.combined,
          divergente: derived.divergente,
          dettaglio_divergenza: derived.dettaglio_divergenza,
        })
      })
    })
  })
})
