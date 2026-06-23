import { describe, expect, test } from "bun:test"

import { evaluateEtico } from "./evaluator-etico-v6"
import { evaluateMorale } from "./evaluator-morale-v6"
import { evaluatePragmatico } from "./evaluator-pragmatico-v6"

const H = ["vita_umana", "benessere_collettivo", "autonomia", "trasparenza", "convenienza"]
const PW = { peso_proprio: 0.65, peso_controparte: 0.35 }
const MD = { default_audience: "general" as const, require_audience_model: false }

describe("evaluator label derivation", () => {
  describe("#given etico evaluations", () => {
    describe("#when evaluated", () => {
      test("#then score >= 0.5 without override yields lecito", () => {
        const result = evaluateEtico({
          conclusion: "test",
          proofChainKind: "strict",
          premiseTags: ["legal:gdpr", "compliance:soc2"],
          extensionMembership: { inCount: 3, totalCount: 3 },
          valueHierarchy: H,
        })

        expect(result.score).toBeGreaterThanOrEqual(0.5)
        expect(result.override).toBe(false)
        expect(result.label).toBe("lecito")
      })

      test("#then score < 0.5 without override yields illecito", () => {
        const result = evaluateEtico({
          conclusion: "test",
          proofChainKind: "unknown",
          premiseTags: ["legal:baseline"],
          extensionMembership: { inCount: 1, totalCount: 1 },
          valueHierarchy: H,
        })

        expect(result.score).toBeLessThan(0.5)
        expect(result.override).toBe(false)
        expect(result.label).toBe("illecito")
      })

      test("#then no ethical context yields a null score and label", () => {
        const result = evaluateEtico({
          conclusion: "test",
          proofChainKind: "unknown",
          premiseTags: ["evidence:data"],
          extensionMembership: { inCount: 1, totalCount: 1 },
          valueHierarchy: H,
        })

        expect(result).toEqual({
          score: null,
          label: null,
          allineamento_legale: 0,
          valore_empatico: 0,
          magnitudine_beneficio: 0,
          override: false,
          reason: "no_ethical_context",
        })
      })

      test("#then override true yields override_giustificato", () => {
        const result = evaluateEtico({
          conclusion: "test",
          proofChainKind: "strict",
          premiseTags: ["value:vita_umana"],
          extensionMembership: { inCount: 1, totalCount: 1 },
          valueHierarchy: H,
        })

        expect(result.override).toBe(true)
        expect(result.label).toBe("override_giustificato")
      })
    })
  })

  describe("#given pragmatico evaluations", () => {
    describe("#when evaluated", () => {
      test("#then score >= 0.6 yields conveniente", () => {
        const result = evaluatePragmatico({
          conclusion: "test",
          proofChainKind: "strict",
          extensionMembership: { inCount: 3, totalCount: 3 },
          competingConclusionCount: 0,
          hasStrongAttackers: false,
          weights: PW,
        })

        expect(result.score).toBeGreaterThanOrEqual(0.6)
        expect(result.label).toBe("conveniente")
      })

      test("#then score < 0.4 yields sconveniente", () => {
        const result = evaluatePragmatico({
          conclusion: "test",
          proofChainKind: "unknown",
          extensionMembership: { inCount: 0, totalCount: 4 },
          competingConclusionCount: 5,
          hasStrongAttackers: true,
          weights: PW,
        })

        expect(result.score).toBeLessThan(0.4)
        expect(result.label).toBe("sconveniente")
      })

      test("#then score between 0.4 and 0.6 yields condizionata", () => {
        const result = evaluatePragmatico({
          conclusion: "test",
          proofChainKind: "mixed",
          extensionMembership: { inCount: 1, totalCount: 2 },
          competingConclusionCount: 2,
          hasStrongAttackers: false,
          weights: PW,
        })

        expect(result.score).toBeGreaterThanOrEqual(0.4)
        expect(result.score).toBeLessThan(0.6)
        expect(result.label).toBe("condizionata")
      })
    })
  })

  describe("#given morale evaluations", () => {
    describe("#when evaluated", () => {
      test("#then score >= 0.6 yields giustificabile", () => {
        const result = evaluateMorale({
          conclusion: "allow the response",
          premiseTags: ["safety:child"],
          audienceType: "expert",
          conclusionAction: "block",
          hasQualifications: true,
          competingArgumentCount: 0,
          defaults: MD,
        })

        expect(result.score).toBeGreaterThanOrEqual(0.6)
        expect(result.label).toBe("giustificabile")
      })

      test("#then score < 0.4 yields problematica", () => {
        const result = evaluateMorale({
          conclusion: "allow the response",
          premiseTags: ["commercial:upsell"],
          audienceType: "vulnerable",
          conclusionAction: "allow",
          hasQualifications: false,
          competingArgumentCount: 4,
          defaults: MD,
        })

        expect(result.score).toBeLessThan(0.4)
        expect(result.label).toBe("problematica")
      })

      test("#then a null score yields a null label", () => {
        const result = evaluateMorale({
          conclusion: "test",
          premiseTags: [],
          audienceType: null,
          conclusionAction: null,
          hasQualifications: false,
          competingArgumentCount: 0,
          defaults: { default_audience: "general", require_audience_model: true },
        })

        expect(result.score).toBeNull()
        expect(result.label).toBeNull()
      })

      test("#then a score between 0.4 and 0.6 yields dipendente_dal_contesto", () => {
        const result = evaluateMorale({
          conclusion: "restrict the response",
          premiseTags: [],
          audienceType: "general",
          conclusionAction: "restrict",
          hasQualifications: false,
          competingArgumentCount: 0,
          defaults: MD,
        })

        expect(result.score).toBeGreaterThanOrEqual(0.4)
        expect(result.score).toBeLessThan(0.6)
        expect(result.label).toBe("dipendente_dal_contesto")
      })
    })
  })
})
