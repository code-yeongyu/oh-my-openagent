import { afterEach, describe, expect, test, spyOn, mock } from "bun:test"
import * as loggerModule from "../../shared/logger"

import { PreferenceWeightsSchema } from "../../config/schema/epistemic-gate"
import { _resetForTesting as resetAnnotations } from "./annotation-store"
import { _resetCalibrationForTesting, observeCalibration } from "./calibration-observer"
import { _resetGateSuggesterForTesting, observeGateResult } from "./gate-mode-suggester"
import { clearMultiPlaneStore, storeMultiPlaneAnnotations } from "./annotation-store-v2"
import { createPreferenceInjectionHook } from "./preference-injection-hook"
import type { MultiPlaneAnnotation } from "./multi-plane-types"

const SESSION_IDS = [
  "v4-feedback-loop",
  "v4-calibration",
  "v4-auto-switch",
]

const CONFIG = {
  preference_weights: {
    logico: 0.3,
    probabilistico: 0.3,
    etico: 0.15,
    pragmatico: 0.15,
    morale: 0.1,
  },
}

function createMultiPlaneAnnotation(
  conclusion: string,
  combined: number,
): MultiPlaneAnnotation {
  return {
    conclusion,
    state: {
      pianoA: "plausibile",
      pianoB: { probabile: combined, plausibile: combined > 0.5 },
      pianoC: { inconclusivo: false, autosufficiente: true, catena_dipendenze: [], ha_dipendenza_circolare: false },
      pianoD: null,
    },
    rawClassification: "plausibile",
    reason: `${conclusion}-reason`,
    timestamp: 1,
    callID: "call-1",
    proofChainKind: "strict",
    extensionMembership: { inCount: 1, totalCount: 1 },
    valutazione: {
      logico: combined,
      probabilistico: combined,
      etico: { score: combined, label: combined >= 0.5 ? "lecito" : "illecito", allineamento_legale: combined, valore_empatico: combined, magnitudine_beneficio: combined, override: false, reason: null },
      pragmatico: { score: combined, label: combined >= 0.6 ? "conveniente" : combined < 0.4 ? "sconveniente" : "condizionata", beneficio_proprio: combined, beneficio_controparte: combined, costo_proprio: 1 - combined, costo_controparte: 1 - combined, pesatura: { proprio: 0.5, controparte: 0.5 } },
      morale: { score: combined, label: combined >= 0.6 ? "giustificabile" : combined < 0.4 ? "problematica" : "dipendente_dal_contesto", contesto_sociale: "expert", comprensione_destinatari: "expert (0.9)", impatto_cascata: 0.2, intenzione: "benevola", trasparenza: 0.8, fiducia_risultante: 0.8, reason: null },
      combined,
      divergente: false,
      dettaglio_divergenza: null,
    },
  }
}

afterEach(() => {
  for (const sessionID of SESSION_IDS) {
    clearMultiPlaneStore(sessionID)
  }
  resetAnnotations()
  _resetCalibrationForTesting()
  _resetGateSuggesterForTesting()
})

describe("epistemic-state-interpreter v4 integration", () => {
  describe("#given annotations from the V2 multi-plane pipeline", () => {
    test("#when preference injection runs via V2 path #then derived preferences are injected into theory", async () => {
      const sessionID = "v4-feedback-loop"

      storeMultiPlaneAnnotations(sessionID, [
        createMultiPlaneAnnotation("strict-win", 0.9),
        createMultiPlaneAnnotation("defeasible-loss", 0.3),
      ])

      const hook = createPreferenceInjectionHook(CONFIG)
      const output = {
        args: {
          theory: {
            preferences: [] as Array<{ superior: string; inferior: string }>,
          },
        },
      }

      await hook["tool.execute.before"](
        { tool: "reason_argue", sessionID, callID: "call-2" },
        output,
      )

      expect(output.args.theory.preferences).toContainEqual({
        superior: "strict-win",
        inferior: "defeasible-loss",
      })
    })
  })

  describe("#given a backward-compatible two-field config", () => {
    test("#when preference weights are parsed #then missing v4 fields default to zero", () => {
      const result = PreferenceWeightsSchema.parse({ logico: 0.6, probabilistico: 0.4 })

      expect(result).toEqual({
        logico: 0.6,
        probabilistico: 0.4,
        etico: 0,
        pragmatico: 0,
        morale: 0,
      })
    })
  })

  describe("#given 100+ observations dominated by one state", () => {
    test("#when calibration is observed #then a threshold-adjustment suggestion is emitted", () => {
      const sessionID = "v4-calibration"
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      for (let i = 0; i < 81; i += 1) {
        observeCalibration(sessionID, "accepted")
      }

      for (let i = 0; i < 19; i += 1) {
        observeCalibration(sessionID, "open")
      }

      expect(logSpy).toHaveBeenCalled()
      const firstCall = String(logSpy.mock.calls[0]?.[0])
      expect(firstCall).toContain("Consider adjusting thresholds")
      expect(firstCall).toContain("accepted")

      logSpy.mockRestore()
    })
  })

  describe("#given annotation mode with repeated clean invocations", () => {
    test("#when the clean-count threshold is reached #then an auto-switch suggestion is emitted", () => {
      const sessionID = "v4-auto-switch"
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      for (let i = 0; i < 50; i += 1) {
        observeGateResult(sessionID, "annotation", false)
      }

      expect(logSpy).toHaveBeenCalled()
      const firstCall = String(logSpy.mock.calls[0]?.[0])
      expect(firstCall).toContain("annotation mode")
      expect(firstCall).toContain("Consider switching to hybrid")

      logSpy.mockRestore()
    })
  })
})
