/// <reference path="../../../bun-test.d.ts" />

import {
  _resetMultiPlaneStoreForTesting,
  storeMultiPlaneAnnotations,
} from "../../hooks/epistemic-state-interpreter/annotation-store-v2"
import type {
  MultiPlaneAnnotation,
  ValutazioneMultiAsse,
} from "../../hooks/epistemic-state-interpreter/multi-plane-types"
import { injectStoredPreferences } from "./preference-pre-injection"

const { afterEach, describe, expect, it } = require("bun:test")

function createValutazione(
  combined: number,
  labels?: {
    etico?: ValutazioneMultiAsse["etico"]["label"]
    pragmatico?: ValutazioneMultiAsse["pragmatico"]["label"]
    morale?: ValutazioneMultiAsse["morale"]["label"]
  },
): ValutazioneMultiAsse {
  return {
    logico: combined,
    probabilistico: combined,
    combined,
    divergente: false,
    dettaglio_divergenza: null,
    etico: {
      score: combined,
      label: labels?.etico ?? "lecito",
      allineamento_legale: 1,
      valore_empatico: 1,
      magnitudine_beneficio: 1,
      override: false,
    },
    pragmatico: {
      score: combined,
      label: labels?.pragmatico ?? "conveniente",
      beneficio_proprio: 1,
      beneficio_controparte: 1,
      costo_proprio: 0,
      costo_controparte: 0,
      pesatura: { proprio: 0.6, controparte: 0.4 },
    },
    morale: {
      score: combined,
      label: labels?.morale ?? "giustificabile",
      contesto_sociale: null,
      comprensione_destinatari: null,
      impatto_cascata: 0,
      intenzione: "benevola",
      trasparenza: 1,
      fiducia_risultante: 1,
      reason: null,
    },
  }
}

function createAnnotation(
  conclusion: string,
  combined: number,
): MultiPlaneAnnotation {
  return {
    conclusion,
    state: {
      pianoA: "plausibile",
      pianoB: { probabile: combined, plausibile: true },
      pianoC: {
        inconclusivo: false,
        autosufficiente: true,
        catena_dipendenze: [],
        ha_dipendenza_circolare: false,
      },
      pianoD: null,
    },
    rawClassification: "plausibile",
    reason: "test",
    timestamp: Date.now(),
    callID: "call-1",
    proofChainKind: "strict",
    extensionMembership: { inCount: 1, totalCount: 1 },
    valutazione: createValutazione(combined),
  }
}

afterEach(() => {
  _resetMultiPlaneStoreForTesting()
})

describe("injectStoredPreferences", () => {
  it("injects derived preferences from stored annotations", () => {
    storeMultiPlaneAnnotations("ses-1", [
      createAnnotation("accept(alpha)", 0.9),
      createAnnotation("reject(beta)", 0.2),
    ])

    const theory: Record<string, unknown> = { premises: [] }

    const injectedCount = injectStoredPreferences("ses-1", theory)

    expect(injectedCount).toBe(1)
    expect(theory.preferences).toEqual([
      { superior: "accept(alpha)", inferior: "reject(beta)" },
    ])
  })

  it("returns zero when there are no stored annotations", () => {
    const theory: Record<string, unknown> = { premises: [] }

    const injectedCount = injectStoredPreferences("missing", theory)

    expect(injectedCount).toBe(0)
    expect(theory.preferences).toBeUndefined()
  })
})
