import { describe, expect, it } from "bun:test"

import { checkMultiPlaneGate } from "./gate-checker-v2"
import type {
  AmmissibilitaState,
  DominanzaDecisionale,
  MultiPlaneState,
} from "./multi-plane-types"

function createPianoD(dominante: string | null): DominanzaDecisionale {
  return {
    ranking: dominante ? [{ conclusion: dominante, score: 0.9 }] : [],
    dominante,
    margine: dominante ? 0.4 : 0,
    preferibile_ma_non_certo: false,
    assi_convergenti: [],
    assi_divergenti: [],
  }
}

function createState(overrides: Partial<MultiPlaneState> = {}): MultiPlaneState {
  return {
    pianoA: "possibile",
    pianoB: { probabile: 0.7, plausibile: true },
    pianoC: {
      inconclusivo: false,
      autosufficiente: true,
      catena_dipendenze: [],
      ha_dipendenza_circolare: false,
    },
    pianoD: null,
    ...overrides,
  }
}

describe("checkMultiPlaneGate", () => {
  describe("#given annotation mode", () => {
    describe("#when checking any multi-plane state", () => {
      it("#then always allows the conclusion", () => {
        expect(checkMultiPlaneGate(createState({ pianoA: "escluso" }), "annotation", "alpha")).toEqual({
          allowed: true,
          reason: "annotation mode: gate disabled",
          plane: "none",
        })
      })
    })
  })

  describe("#given gate mode", () => {
    describe.each(["escluso", "escluso_operativamente"] satisfies AmmissibilitaState[])(
      "#when pianoA is %s",
      (pianoA) => {
        it("#then blocks from pianoA", () => {
          expect(checkMultiPlaneGate(createState({ pianoA }), "gate", "alpha")).toEqual({
            allowed: false,
            reason: `gate mode: conclusion 'alpha' blocked by pianoA (state=${pianoA})`,
            plane: "pianoA",
          })
        })
      },
    )

    describe("#when pianoA is plausibile", () => {
      it("#then allows the conclusion", () => {
        expect(checkMultiPlaneGate(createState({ pianoA: "plausibile" }), "gate", "alpha")).toEqual({
          allowed: true,
          reason: "gate mode: conclusion 'alpha' allowed",
          plane: "none",
        })
      })
    })

    describe("#when pianoC is inconclusivo", () => {
      it("#then blocks fail-closed from pianoC", () => {
        expect(
          checkMultiPlaneGate(createState({ pianoC: { ...createState().pianoC, inconclusivo: true } }), "gate", "alpha"),
        ).toEqual({
          allowed: false,
          reason: "gate mode: conclusion 'alpha' blocked by pianoC (inconclusivo=true)",
          plane: "pianoC",
        })
      })
    })
  })

  describe("#given dominance mode", () => {
    describe("#when pianoD has a different dominante", () => {
      it("#then blocks the non-dominant conclusion from pianoD", () => {
        expect(checkMultiPlaneGate(createState({ pianoD: createPianoD("beta") }), "dominance", "alpha")).toEqual({
          allowed: false,
          reason: "dominance mode: conclusion 'alpha' blocked by pianoD (dominante=beta)",
          plane: "pianoD",
        })
      })
    })

    describe("#when the conclusion matches the dominante", () => {
      it("#then allows the dominant conclusion", () => {
        expect(checkMultiPlaneGate(createState({ pianoD: createPianoD("alpha") }), "dominance", "alpha")).toEqual({
          allowed: true,
          reason: "dominance mode: conclusion 'alpha' allowed",
          plane: "none",
        })
      })
    })

    describe("#when pianoD is null", () => {
      it("#then falls through to gate checks", () => {
        expect(checkMultiPlaneGate(createState({ pianoA: "escluso", pianoD: null }), "dominance", "alpha")).toEqual({
          allowed: false,
          reason: "dominance mode: conclusion 'alpha' blocked by pianoA (state=escluso)",
          plane: "pianoA",
        })
      })
    })
  })

  describe("#given hybrid mode", () => {
    describe.each(["escluso", "escluso_operativamente"] satisfies AmmissibilitaState[])(
      "#when pianoA is %s",
      (pianoA) => {
        it("#then blocks only those excluded states", () => {
          expect(checkMultiPlaneGate(createState({ pianoA }), "hybrid", "alpha")).toEqual({
            allowed: false,
            reason: `hybrid mode: conclusion 'alpha' blocked by pianoA (state=${pianoA})`,
            plane: "pianoA",
          })
        })
      },
    )

    describe("#when pianoC is inconclusivo", () => {
      it("#then blocks fail-closed from pianoC", () => {
        expect(
          checkMultiPlaneGate(createState({ pianoC: { ...createState().pianoC, inconclusivo: true } }), "hybrid", "alpha"),
        ).toEqual({
          allowed: false,
          reason: "hybrid mode: conclusion 'alpha' blocked by pianoC (inconclusivo=true)",
          plane: "pianoC",
        })
      })
    })

    describe("#when pianoA is possibile", () => {
      it("#then allows the conclusion", () => {
        expect(checkMultiPlaneGate(createState({ pianoA: "possibile" }), "hybrid", "alpha")).toEqual({
          allowed: true,
          reason: "hybrid mode: conclusion 'alpha' allowed",
          plane: "none",
        })
      })
    })
  })
})
