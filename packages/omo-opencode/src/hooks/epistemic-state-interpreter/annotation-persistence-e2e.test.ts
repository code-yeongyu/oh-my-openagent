import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  _resetAnnotationPersistenceForTesting,
  createAnnotationPersistence,
  type PersistedAnnotationFile,
  type SerializedSessionStore,
  ANNOTATION_PERSISTENCE_SCHEMA_VERSION,
} from "./annotation-persistence"
import {
  _clearInMemoryMultiPlaneStoreForTesting,
  getMultiPlaneAnnotations,
  storeMultiPlaneAnnotations,
} from "./annotation-store-v2"
import {
  _clearInMemoryPreferenceStoreForTesting,
  getPreferences,
  storePreference,
} from "./preference-store"
import type { MultiPlaneAnnotation, ValutazioneMultiAsse } from "./multi-plane-types"

let tempDir: string
let filePath: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "idm-annotation-e2e-"))
  filePath = join(tempDir, "annotation-store-v2.json")
  process.env.IDM_ANNOTATION_PERSISTENCE_PATH = filePath
  _resetAnnotationPersistenceForTesting({ path: filePath })
  _clearInMemoryMultiPlaneStoreForTesting()
  _clearInMemoryPreferenceStoreForTesting()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

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

function makeAnnotation(conclusion: string, timestamp: number): MultiPlaneAnnotation {
  return {
    conclusion,
    state: {
      pianoA: "plausibile",
      pianoB: { probabile: 0.7, plausibile: true },
      pianoC: {
        inconclusivo: false,
        autosufficiente: true,
        catena_dipendenze: ["premise:alpha"],
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

describe("annotation-persistence end-to-end #given the full pipeline is wired", () => {
  test("#when annotations are stored then in-memory is cleared #then a re-read recovers them through disk", () => {
    storeMultiPlaneAnnotations("session-e2e", [makeAnnotation("claim-e2e-1", 1)])
    storePreference("session-e2e", { superior: "s1", inferior: "d1", strength: 0.7 })

    _clearInMemoryMultiPlaneStoreForTesting()
    _clearInMemoryPreferenceStoreForTesting()

    const recoveredAnnotations = getMultiPlaneAnnotations("session-e2e")
    const recoveredPreferences = getPreferences("session-e2e")

    expect(recoveredAnnotations).toHaveLength(1)
    expect(recoveredAnnotations[0]?.conclusion).toBe("claim-e2e-1")
    expect(recoveredPreferences.get("s1>d1")?.combined).toBe(0.7)
  })

  test("#when storeMultiPlaneAnnotations runs #then the persistence file is created with mode 0o600", () => {
    storeMultiPlaneAnnotations("session-mode", [makeAnnotation("claim-mode", 1)])

    expect(existsSync(filePath)).toBe(true)
    const stat = statSync(filePath)
    const mode = stat.mode & 0o777
    expect(mode).toBe(0o600)
    console.log(`[annotation-persistence-e2e] disk file mode = 0o${mode.toString(8)} at ${filePath}`)
  })

  test("#when the persistence file has schema v: 1 #then the loaded payload mirrors what was written", () => {
    storeMultiPlaneAnnotations("session-schema", [makeAnnotation("claim-schema", 1)])

    const probe = createAnnotationPersistence({ path: filePath })
    const loaded = probe.readSync()

    expect(loaded?.v).toBe(ANNOTATION_PERSISTENCE_SCHEMA_VERSION)
    expect(loaded?.annotations["session-schema"]?.annotations).toHaveLength(1)
  })

  test("#when 1k annotations are loaded #then readSync completes in under 50ms", () => {
    const file: PersistedAnnotationFile = {
      v: ANNOTATION_PERSISTENCE_SCHEMA_VERSION,
      savedAt: Date.now(),
      annotations: {},
      preferences: {},
    }
    const sessions = 10
    const perSession = 100
    for (let s = 0; s < sessions; s++) {
      const sid = `bench-session-${s}`
      const store: SerializedSessionStore = { annotations: [], hooks: [], evaluationHistory: [] }
      for (let i = 0; i < perSession; i++) {
        store.annotations.push(makeAnnotation(`claim-${s}-${i}`, Date.now()))
      }
      file.annotations[sid] = store
    }
    const probe = createAnnotationPersistence({ path: filePath })
    probe.writeAtomic(file)

    const start = performance.now()
    const loaded = probe.readSync()
    const elapsed = performance.now() - start

    expect(loaded).not.toBeNull()
    let total = 0
    for (const store of Object.values(loaded!.annotations)) total += store.annotations.length
    expect(total).toBe(sessions * perSession)
    expect(elapsed).toBeLessThan(50)
    console.log(`[annotation-persistence-e2e] readSync ${total} annotations in ${elapsed.toFixed(2)}ms`)
  })
})
