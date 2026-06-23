import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  _resetAnnotationPersistenceForTesting,
  loadAnnotations as loadPersistedAnnotations,
} from "./annotation-persistence"
import type { EpistemicHook } from "./hook-entity-types"
import type { MultiPlaneAnnotation, ValutazioneMultiAsse } from "./multi-plane-types"
import {
  _clearInMemoryMultiPlaneStoreForTesting,
  _resetMultiPlaneStoreForTesting,
  clearMultiPlaneStore,
  getEvaluationHistory,
  getMultiPlaneAnnotations,
  getSessionHooks,
  storeEvaluationHistory,
  storeMultiPlaneAnnotations,
  storeSessionHooks,
} from "./annotation-store-v2"

let testTempDir: string
let testFilePath: string

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
    score: 0.6,
    label: "conveniente",
    beneficio_proprio: 0.5,
    beneficio_controparte: 0.7,
    costo_proprio: 0.2,
    costo_controparte: 0.1,
    pesatura: { proprio: 0.4, controparte: 0.6 },
  },
  morale: {
    score: 0.85,
    label: "giustificabile",
    contesto_sociale: "team",
    comprensione_destinatari: "high",
    impatto_cascata: 0.4,
    intenzione: "benevola",
    trasparenza: 0.9,
    fiducia_risultante: 0.8,
    reason: "aligned",
  },
  combined: 0.76,
  divergente: false,
  dettaglio_divergenza: null,
}

function createAnnotation(conclusion: string, timestamp: number): MultiPlaneAnnotation {
  return {
    conclusion,
    state: {
      pianoA: "plausibile",
      pianoB: { probabile: 0.7, plausibile: true },
      pianoC: {
        inconclusivo: false,
        autosufficiente: true,
        catena_dipendenze: ["premise-a"],
        ha_dipendenza_circolare: false,
      },
      pianoD: null,
    },
    rawClassification: "plausibile",
    reason: `reason-${conclusion}`,
    timestamp,
    callID: `call-${conclusion}-${timestamp}`,
    proofChainKind: "mixed",
    extensionMembership: { inCount: 1, totalCount: 1 },
    valutazione,
  }
}

function createHook(id: string, sessionId: string): EpistemicHook {
  return {
    id,
    target: "claim-a",
    polarity: "positivo",
    strength: "medio",
    factors: {
      epistemici: {
        supporto_empirico: 0.8,
        compatibilita_strutturale: 0.7,
        potenziale_esplicativo: 0.9,
        valore_verifica: 0.6,
        maturita: 0.5,
      },
      pragmatici: {
        beneficio_potenziale: 0.7,
        urgenza: 0.6,
        costo_verifica: 0.2,
        rischio: 0.1,
      },
    },
    rationale: "support",
    timestamp: 1,
    sessionId,
  }
}

beforeEach(() => {
  testTempDir = mkdtempSync(join(tmpdir(), "idm-store-v2-test-"))
  testFilePath = join(testTempDir, "annotation-store-v2.json")
  process.env.IDM_ANNOTATION_PERSISTENCE_PATH = testFilePath
  _resetAnnotationPersistenceForTesting({ path: testFilePath })
  _resetMultiPlaneStoreForTesting()
})

afterEach(() => {
  _resetMultiPlaneStoreForTesting()
  rmSync(testTempDir, { recursive: true, force: true })
  delete process.env.IDM_ANNOTATION_PERSISTENCE_PATH
})

describe("annotation-store-v2 #given a session-scoped multi-plane store", () => {
  test("#when annotations are stored #then they can be retrieved for the same session", () => {
    const annotations = [createAnnotation("claim-a", 1)]

    storeMultiPlaneAnnotations("session-a", annotations)

    expect(getMultiPlaneAnnotations("session-a")).toEqual(annotations)
  })

  test("#when annotations are stored twice #then they append instead of overwriting", () => {
    const first = createAnnotation("claim-a", 1)
    const second = createAnnotation("claim-b", 2)

    storeMultiPlaneAnnotations("session-a", [first])
    storeMultiPlaneAnnotations("session-a", [second])

    expect(getMultiPlaneAnnotations("session-a")).toEqual([first, second])
  })

  test("#when hooks are stored #then they can be retrieved for the same session", () => {
    const hooks = [createHook("hook-1", "session-a")]

    storeSessionHooks("session-a", hooks)

    expect(getSessionHooks("session-a")).toEqual(hooks)
  })

  test("#when hooks are stored twice #then they append instead of overwriting", () => {
    const first = createHook("hook-1", "session-a")
    const second = createHook("hook-2", "session-a")

    storeSessionHooks("session-a", [first])
    storeSessionHooks("session-a", [second])

    expect(getSessionHooks("session-a")).toEqual([first, second])
  })

  test("#when evaluation history entries are stored #then they can be retrieved in append order", () => {
    const first = { conclusion: "claim-a", timestamp: 1, valutazione }
    const second = { conclusion: "claim-b", timestamp: 2, valutazione: { ...valutazione, combined: 0.8 } }

    storeEvaluationHistory("session-a", first)
    storeEvaluationHistory("session-a", second)

    expect(getEvaluationHistory("session-a")).toEqual([first, second])
  })

  test("#when clearMultiPlaneStore is called #then annotations hooks and history are removed", () => {
    storeMultiPlaneAnnotations("session-a", [createAnnotation("claim-a", 1)])
    storeSessionHooks("session-a", [createHook("hook-1", "session-a")])
    storeEvaluationHistory("session-a", { conclusion: "claim-a", timestamp: 1, valutazione })

    clearMultiPlaneStore("session-a")

    expect(getMultiPlaneAnnotations("session-a")).toEqual([])
    expect(getSessionHooks("session-a")).toEqual([])
    expect(getEvaluationHistory("session-a")).toEqual([])
  })

  test("#when getters are called for an unknown session #then they return empty arrays", () => {
    expect(getMultiPlaneAnnotations("missing")).toEqual([])
    expect(getSessionHooks("missing")).toEqual([])
    expect(getEvaluationHistory("missing")).toEqual([])
  })

  test("#when _resetMultiPlaneStoreForTesting is called #then all sessions are cleared", () => {
    storeMultiPlaneAnnotations("session-a", [createAnnotation("claim-a", 1)])
    storeSessionHooks("session-b", [createHook("hook-1", "session-b")])
    storeEvaluationHistory("session-c", { conclusion: "claim-c", timestamp: 3, valutazione })

    _resetMultiPlaneStoreForTesting()

    expect(getMultiPlaneAnnotations("session-a")).toEqual([])
    expect(getSessionHooks("session-b")).toEqual([])
    expect(getEvaluationHistory("session-c")).toEqual([])
  })

  test("#when multiple sessions store data #then each session remains isolated", () => {
    const sessionAAnnotation = createAnnotation("claim-a", 1)
    const sessionBAnnotation = createAnnotation("claim-b", 2)
    const sessionAHook = createHook("hook-1", "session-a")
    const sessionBHook = createHook("hook-2", "session-b")

    storeMultiPlaneAnnotations("session-a", [sessionAAnnotation])
    storeMultiPlaneAnnotations("session-b", [sessionBAnnotation])
    storeSessionHooks("session-a", [sessionAHook])
    storeSessionHooks("session-b", [sessionBHook])
    storeEvaluationHistory("session-a", { conclusion: "claim-a", timestamp: 1, valutazione })
    storeEvaluationHistory("session-b", { conclusion: "claim-b", timestamp: 2, valutazione: { ...valutazione, combined: 0.9 } })

    expect(getMultiPlaneAnnotations("session-a")).toEqual([sessionAAnnotation])
    expect(getMultiPlaneAnnotations("session-b")).toEqual([sessionBAnnotation])
    expect(getSessionHooks("session-a")).toEqual([sessionAHook])
    expect(getSessionHooks("session-b")).toEqual([sessionBHook])
    expect(getEvaluationHistory("session-a")).toHaveLength(1)
    expect(getEvaluationHistory("session-b")).toHaveLength(1)
  })
})

describe("annotation-store-v2 #given disk persistence is wired", () => {
  test("#when an annotation is stored #then it is mirrored to the persistence file", () => {
    const annotation = createAnnotation("claim-a", 1)

    storeMultiPlaneAnnotations("session-a", [annotation])

    const persisted = loadPersistedAnnotations()
    expect(persisted["session-a"]?.annotations).toEqual([annotation])
  })

  test("#when in-memory store is cleared but persistence is preserved #then re-init hydrates annotations from disk", () => {
    const annotation = createAnnotation("claim-a", 1)
    storeMultiPlaneAnnotations("session-a", [annotation])

    _clearInMemoryMultiPlaneStoreForTesting()

    expect(getMultiPlaneAnnotations("session-a")).toEqual([annotation])
  })

  test("#when the store is mutated and disk file is preserved #then a fresh process load returns the same data", () => {
    const annotation = createAnnotation("claim-a", 1)
    storeMultiPlaneAnnotations("session-a", [annotation])

    const beforeReset = loadPersistedAnnotations()
    expect(beforeReset["session-a"]?.annotations).toHaveLength(1)
  })

  test("#when clearMultiPlaneStore is called #then the session entry is removed from disk too", () => {
    storeMultiPlaneAnnotations("session-a", [createAnnotation("claim-a", 1)])
    expect(loadPersistedAnnotations()["session-a"]).toBeDefined()

    clearMultiPlaneStore("session-a")

    expect(loadPersistedAnnotations()["session-a"]).toBeUndefined()
  })
})
