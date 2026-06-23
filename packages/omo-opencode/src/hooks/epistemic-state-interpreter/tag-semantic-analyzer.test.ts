import { describe, expect, test } from "bun:test"

import { analyzeTagSemantics } from "./tag-semantic-analyzer"

const EMPTY_BONUSES = {
  supporto_empirico: 0,
  compatibilita_strutturale: 0,
  potenziale_esplicativo: 0,
  valore_verifica: 0,
  maturita: 0,
  beneficio_potenziale: 0,
  urgenza: 0,
  costo_verifica: 0,
  rischio: 0,
}

describe("analyzeTagSemantics", () => {
  describe("#given semantic premise tags", () => {
    describe("#when analyzed", () => {
      test("#then empty tags keep all bonuses at 0", () => {
        expect(analyzeTagSemantics([])).toEqual(EMPTY_BONUSES)
      })

      test("#then a single legal tag adds 0.15 structural compatibility", () => {
        const result = analyzeTagSemantics(["legal:gdpr"])

        expect(result.compatibilita_strutturale).toBe(0.15)
      })

      test("#then multiple legal tags cap the structural bonus at 0.3", () => {
        const result = analyzeTagSemantics([
          "legal:gdpr",
          "regulatory:ai-act",
          "compliance:soc2",
        ])

        expect(result.compatibilita_strutturale).toBe(0.3)
      })

      test("#then a safety tag enriches evidence support and lowers risk", () => {
        const result = analyzeTagSemantics(["safety:child-protection"])

        expect(result.supporto_empirico).toBe(0.1)
        expect(result.rischio).toBe(-0.1)
      })

      test("#then a commercial tag adds benefit and risk", () => {
        const result = analyzeTagSemantics(["commercial:upsell"])

        expect(result.beneficio_potenziale).toBe(0.1)
        expect(result.rischio).toBe(0.1)
      })

      test("#then @risk tags add risk signal", () => {
        const result = analyzeTagSemantics(["@risk:catastrophic:mortality_high"])

        expect(result.rischio).toBe(0.15)
      })

      test("#then @contam tags lower empirical support and raise risk", () => {
        const result = analyzeTagSemantics(["@contam:coi:manufacturer"])

        expect(result.supporto_empirico).toBe(-0.15)
        expect(result.rischio).toBe(0.15)
      })

      test("#then @valence benefit tags add positive support", () => {
        const result = analyzeTagSemantics(["@valence:benefit:severe"])

        expect(result.supporto_empirico).toBe(0.15)
      })

      test("#then mixed legal, safety, and evidence tags enrich multiple factors", () => {
        const result = analyzeTagSemantics([
          "legal:gdpr",
          "safety:child-protection",
          "evidence:study",
        ])

        expect(result).toEqual({
          ...EMPTY_BONUSES,
          supporto_empirico: 0.25,
          compatibilita_strutturale: 0.15,
          rischio: -0.1,
        })
      })

      test("#then tags with the wrong prefix do not add bonuses", () => {
        expect(analyzeTagSemantics(["legality:gdpr", "safe:child"])).toEqual(EMPTY_BONUSES)
      })

      test("#then uppercase tags are normalized before matching", () => {
        const result = analyzeTagSemantics(["LEGAL:GDPR", "EVIDENCE:TRIAL"])

        expect(result.compatibilita_strutturale).toBe(0.15)
        expect(result.supporto_empirico).toBe(0.15)
      })
    })
  })
})
