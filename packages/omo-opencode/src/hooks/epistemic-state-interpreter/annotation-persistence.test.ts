import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ANNOTATION_PERSISTENCE_RETENTION_MS,
  ANNOTATION_PERSISTENCE_SCHEMA_VERSION,
  createAnnotationPersistence,
  type PersistedAnnotationFile,
  type SerializedSessionStore,
} from "./annotation-persistence"

let tempDir: string
let filePath: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "idm-annotation-persistence-"))
  filePath = join(tempDir, "annotation-store-v2.json")
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function buildSessionStore(timestamp: number, conclusion = "claim-a"): SerializedSessionStore {
  return {
    annotations: [
      {
        conclusion,
        timestamp,
        state: { pianoA: "plausibile", pianoB: { probabile: 0.7, plausibile: true }, pianoC: null, pianoD: null },
      },
    ],
    hooks: [],
    evaluationHistory: [{ conclusion, timestamp, valutazione: { combined: 0.8 } }],
  }
}

function buildEmptyFile(savedAt: number): PersistedAnnotationFile {
  return {
    v: ANNOTATION_PERSISTENCE_SCHEMA_VERSION,
    savedAt,
    annotations: {},
    preferences: {},
  }
}

describe("annotation-persistence #given a persistence instance", () => {
  test("#when readSync is called on a missing file #then it returns null", () => {
    const p = createAnnotationPersistence({ path: filePath })

    expect(p.readSync()).toBeNull()
  })

  test("#when writeAtomic is called #then it creates the file with mode 0o600", () => {
    const p = createAnnotationPersistence({ path: filePath })
    const file = buildEmptyFile(1)
    file.annotations["session-a"] = buildSessionStore(1)

    p.writeAtomic(file)

    expect(existsSync(filePath)).toBe(true)
    const mode = statSync(filePath).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test("#when writeAtomic is called #then the payload roundtrips through readSync", () => {
    const p = createAnnotationPersistence({ path: filePath })
    const file = buildEmptyFile(1)
    file.annotations["session-a"] = buildSessionStore(1)
    file.preferences["session-a"] = {
      "rule-a>rule-b": {
        combined: 0.5,
        cycleState: { cycleCount: 1, lastDirection: "up", oscillationCount: 0, frozen: false },
      },
    }

    p.writeAtomic(file)
    const loaded = p.readSync()

    expect(loaded).not.toBeNull()
    expect(loaded?.v).toBe(ANNOTATION_PERSISTENCE_SCHEMA_VERSION)
    expect(loaded?.annotations["session-a"]).toEqual(file.annotations["session-a"]!)
    expect(loaded?.preferences["session-a"]).toEqual(file.preferences["session-a"]!)
  })

  test("#when writeAtomic encounters a partial write #then no torn file is left at the final path", () => {
    const p = createAnnotationPersistence({ path: filePath })
    const file = buildEmptyFile(1)
    file.annotations["session-a"] = buildSessionStore(1)
    p.writeAtomic(file)

    const file2 = buildEmptyFile(2)
    file2.annotations["session-b"] = buildSessionStore(2, "claim-b")
    p.writeAtomic(file2)

    const loaded = p.readSync()
    expect(loaded?.annotations["session-b"]).toBeDefined()
    expect(loaded?.savedAt).toBe(2)
  })

  test("#when readSync encounters a schema version mismatch #then it returns null", () => {
    writeFileSync(filePath, JSON.stringify({ v: 999, savedAt: 1, annotations: {}, preferences: {} }))
    const p = createAnnotationPersistence({ path: filePath })

    expect(p.readSync()).toBeNull()
  })

  test("#when readSync encounters corrupt JSON #then it returns null", () => {
    writeFileSync(filePath, "{ not valid json")
    const p = createAnnotationPersistence({ path: filePath })

    expect(p.readSync()).toBeNull()
  })

  test("#when pruneExpired is called on a 31-day-old session #then the session is removed", () => {
    const p = createAnnotationPersistence({ path: filePath })
    const now = Date.now()
    const file = buildEmptyFile(now)
    const oldTimestamp = now - ANNOTATION_PERSISTENCE_RETENTION_MS - 1
    file.annotations["old-session"] = buildSessionStore(oldTimestamp)
    file.preferences["old-session"] = {
      "rule-a>rule-b": { combined: 0.5, cycleState: { cycleCount: 0, lastDirection: "none", oscillationCount: 0, frozen: false } },
    }
    file.annotations["fresh-session"] = buildSessionStore(now)

    const pruned = p.pruneExpired(file, now)

    expect(pruned.annotations["old-session"]).toBeUndefined()
    expect(pruned.preferences["old-session"]).toBeUndefined()
    expect(pruned.annotations["fresh-session"]).toBeDefined()
  })

  test("#when pruneExpired is called and a session has no annotations #then it is kept only if preferences exist", () => {
    const p = createAnnotationPersistence({ path: filePath })
    const now = Date.now()
    const file = buildEmptyFile(now)
    file.preferences["orphan-session"] = {
      "rule-a>rule-b": { combined: 0.5, cycleState: { cycleCount: 0, lastDirection: "none", oscillationCount: 0, frozen: false } },
    }

    const pruned = p.pruneExpired(file, now)

    expect(pruned.preferences["orphan-session"]).toBeUndefined()
  })

  test("#when empty is called #then it returns a fresh empty file at v:1", () => {
    const p = createAnnotationPersistence({ path: filePath })

    const fresh = p.empty()

    expect(fresh.v).toBe(ANNOTATION_PERSISTENCE_SCHEMA_VERSION)
    expect(fresh.annotations).toEqual({})
    expect(fresh.preferences).toEqual({})
  })

  test("#when pathFor is called #then it returns the configured path", () => {
    const p = createAnnotationPersistence({ path: filePath })

    expect(p.pathFor()).toBe(filePath)
  })

  test("#when writeAtomic targets a missing parent directory #then it creates the directory", () => {
    const nested = join(tempDir, "nested", "deep", "annotation-store-v2.json")
    const p = createAnnotationPersistence({ path: nested })

    p.writeAtomic(buildEmptyFile(1))

    expect(existsSync(nested)).toBe(true)
  })
})

describe("annotation-persistence shared cache (default instance)", () => {
  test("#when ensureCachedFile is called twice without writes #then the second call returns the same object", async () => {
    process.env.IDM_ANNOTATION_PERSISTENCE_PATH = filePath
    const mod = await import("./annotation-persistence")
    mod._resetAnnotationPersistenceForTesting({ path: filePath })

    const first = mod.ensureCachedFile()
    const second = mod.ensureCachedFile()

    expect(first).toBe(second)
  })

  test("#when updateAnnotationsForSession is called #then loadAnnotations returns the updated payload", async () => {
    process.env.IDM_ANNOTATION_PERSISTENCE_PATH = filePath
    const mod = await import("./annotation-persistence")
    mod._resetAnnotationPersistenceForTesting({ path: filePath })

    mod.updateAnnotationsForSession("session-a", buildSessionStore(1))

    expect(mod.loadAnnotations()["session-a"]).toBeDefined()
  })

  test("#when updatePreferencesForSession is called #then loadPreferences returns the updated payload", async () => {
    process.env.IDM_ANNOTATION_PERSISTENCE_PATH = filePath
    const mod = await import("./annotation-persistence")
    mod._resetAnnotationPersistenceForTesting({ path: filePath })

    mod.updatePreferencesForSession("session-a", {
      "rule-a>rule-b": { combined: 0.5, cycleState: { cycleCount: 0, lastDirection: "none", oscillationCount: 0, frozen: false } },
    })

    expect(mod.loadPreferences()["session-a"]?.["rule-a>rule-b"]?.combined).toBe(0.5)
  })

  test("#when updateAnnotationsForSession passes null #then the session entry is deleted", async () => {
    process.env.IDM_ANNOTATION_PERSISTENCE_PATH = filePath
    const mod = await import("./annotation-persistence")
    mod._resetAnnotationPersistenceForTesting({ path: filePath })

    mod.updateAnnotationsForSession("session-a", buildSessionStore(1))
    mod.updateAnnotationsForSession("session-a", null)

    expect(mod.loadAnnotations()["session-a"]).toBeUndefined()
  })
})
