import { describe, expect, it } from "bun:test"
import { toEpistemicAnnotation, toEpistemicState } from "./backward-compat-bridge"
import type { MultiPlaneAnnotation } from "./multi-plane-types"

function createAnnotation(overrides: Partial<MultiPlaneAnnotation> = {}): MultiPlaneAnnotation {
  return {
    conclusion: "test(x)",
    state: {
      pianoA: "plausibile",
      pianoB: { probabile: 0.8, plausibile: true },
      pianoC: { inconclusivo: false, autosufficiente: true, catena_dipendenze: [], ha_dipendenza_circolare: false },
      pianoD: null,
    },
    rawClassification: "plausibile",
    reason: "test",
    timestamp: 1000,
    callID: "call-1",
    proofChainKind: "defeasible",
    extensionMembership: { inCount: 2, totalCount: 3 },
    valutazione: null,
    ...overrides,
  }
}

describe("backward-compat-bridge", () => {
  describe("#given toEpistemicState", () => {
    describe("#when pianoC inconclusivo is true", () => {
      it("#then returns inconclusive", () => {
        const annotation = createAnnotation({
          state: {
            pianoA: "plausibile",
            pianoB: { probabile: 0.8, plausibile: true },
            pianoC: { inconclusivo: true, autosufficiente: false, catena_dipendenze: ["a"], ha_dipendenza_circolare: false },
            pianoD: null,
          },
        })
        expect(toEpistemicState(annotation)).toBe("inconclusive")
      })
    })

    describe("#when plausibile with full consensus and strict proof", () => {
      it("#then returns accepted", () => {
        const annotation = createAnnotation({
          proofChainKind: "strict",
          extensionMembership: { inCount: 3, totalCount: 3 },
        })
        expect(toEpistemicState(annotation)).toBe("accepted")
      })
    })

    describe("#when plausibile with partial consensus", () => {
      it("#then returns plausible (not accepted)", () => {
        const annotation = createAnnotation({
          proofChainKind: "strict",
          extensionMembership: { inCount: 2, totalCount: 3 },
        })
        expect(toEpistemicState(annotation)).toBe("plausible")
      })
    })

    describe("#when plausibile with defeasible proof", () => {
      it("#then returns plausible (not accepted)", () => {
        const annotation = createAnnotation({
          proofChainKind: "defeasible",
          extensionMembership: { inCount: 3, totalCount: 3 },
        })
        expect(toEpistemicState(annotation)).toBe("plausible")
      })
    })

    it.each([
      ["possibile", "open"],
      ["non_escluso", "open"],
      ["da_verificare", "open"],
      ["escluso_operativamente", "operationally_excluded"],
      ["escluso", "excluded"],
    ] as const)("#then maps pianoA %s to %s", (pianoA, expected) => {
      const annotation = createAnnotation({
        state: {
          pianoA,
          pianoB: { probabile: 0.5, plausibile: false },
          pianoC: { inconclusivo: false, autosufficiente: null, catena_dipendenze: [], ha_dipendenza_circolare: false },
          pianoD: null,
        },
      })
      expect(toEpistemicState(annotation)).toBe(expected)
    })
  })

  describe("#given toEpistemicAnnotation", () => {
    describe("#when converting a multi-plane annotation", () => {
      it("#then produces valid EpistemicAnnotation shape", () => {
        const annotation = createAnnotation()
        const result = toEpistemicAnnotation(annotation)

        expect(result.conclusion).toBe("test(x)")
        expect(result.state).toBe("plausible")
        expect(result.rawClassification).toBe("plausible")
        expect(result.reason).toBe("test")
        expect(result.timestamp).toBe(1000)
        expect(result.callID).toBe("call-1")
        expect(result.proofChainKind).toBe("defeasible")
        expect(result.extensionMembership).toEqual({ inCount: 2, totalCount: 3 })
      })
    })

    describe("#when inconclusivo overrides pianoA", () => {
      it("#then state is inconclusive regardless of pianoA", () => {
        const annotation = createAnnotation({
          state: {
            pianoA: "plausibile",
            pianoB: { probabile: 0.9, plausibile: true },
            pianoC: { inconclusivo: true, autosufficiente: false, catena_dipendenze: ["a"], ha_dipendenza_circolare: false },
            pianoD: null,
          },
        })
        const result = toEpistemicAnnotation(annotation)
        expect(result.state).toBe("inconclusive")
      })
    })
  })
})
