import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { log } from "../../shared/logger"

export const ANNOTATION_PERSISTENCE_SCHEMA_VERSION = 1 as const
export const ANNOTATION_PERSISTENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const SECURE_FILE_MODE = 0o600

const DEFAULT_PATH = join(homedir(), ".local", "share", "idm", "annotation-store-v2.json")

export type SerializedSessionStore = {
  annotations: unknown[]
  hooks: unknown[]
  evaluationHistory: unknown[]
}

export type SerializedStoredPreference = {
  combined: number
  cycleState: unknown
}

export type PersistedAnnotationFile = {
  v: typeof ANNOTATION_PERSISTENCE_SCHEMA_VERSION
  savedAt: number
  annotations: Record<string, SerializedSessionStore>
  preferences: Record<string, Record<string, SerializedStoredPreference>>
}

export interface AnnotationPersistence {
  readSync(): PersistedAnnotationFile | null
  writeAtomic(record: PersistedAnnotationFile): void
  pathFor(): string
  pruneExpired(file: PersistedAnnotationFile, now: number): PersistedAnnotationFile
  empty(): PersistedAnnotationFile
}

function isPersistedFile(value: unknown): value is PersistedAnnotationFile {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<PersistedAnnotationFile>
  if (candidate.v !== ANNOTATION_PERSISTENCE_SCHEMA_VERSION) return false
  if (typeof candidate.savedAt !== "number") return false
  if (!candidate.annotations || typeof candidate.annotations !== "object") return false
  if (!candidate.preferences || typeof candidate.preferences !== "object") return false
  return true
}

function maxAnnotationTimestamp(store: SerializedSessionStore): number {
  let max = 0
  for (const entry of store.annotations) {
    if (entry && typeof entry === "object" && "timestamp" in entry) {
      const ts = (entry as { timestamp: unknown }).timestamp
      if (typeof ts === "number" && ts > max) max = ts
    }
  }
  return max
}

export function createAnnotationPersistence(config?: { path?: string }): AnnotationPersistence {
  const filePath = config?.path ?? DEFAULT_PATH

  function ensureDir(): void {
    mkdirSync(dirname(filePath), { recursive: true })
  }

  function pathFor(): string {
    return filePath
  }

  function empty(): PersistedAnnotationFile {
    return {
      v: ANNOTATION_PERSISTENCE_SCHEMA_VERSION,
      savedAt: Date.now(),
      annotations: {},
      preferences: {},
    }
  }

  function writeAtomic(record: PersistedAnnotationFile): void {
    const tmpPath = `${filePath}.tmp.${Date.now()}.${process.pid}`
    try {
      ensureDir()
      writeFileSync(tmpPath, JSON.stringify(record), { mode: SECURE_FILE_MODE })
      try {
        chmodSync(tmpPath, SECURE_FILE_MODE)
      } catch {
        // best-effort chmod
      }
      renameSync(tmpPath, filePath)
      try {
        chmodSync(filePath, SECURE_FILE_MODE)
      } catch {
        // best-effort chmod
      }
    } catch (err) {
      try {
        unlinkSync(tmpPath)
      } catch {
        // tmp may not exist
      }
      log("[annotation-persistence] writeAtomic failed", {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  function readSync(): PersistedAnnotationFile | null {
    try {
      if (!existsSync(filePath)) return null
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown
      if (!isPersistedFile(raw)) {
        log("[annotation-persistence] readSync schema mismatch", {
          version: (raw as { v?: unknown })?.v,
        })
        return null
      }
      return raw
    } catch (err) {
      log("[annotation-persistence] readSync failed", {
        message: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  function pruneExpired(file: PersistedAnnotationFile, now: number): PersistedAnnotationFile {
    const cutoff = now - ANNOTATION_PERSISTENCE_RETENTION_MS
    const annotations: PersistedAnnotationFile["annotations"] = {}
    const preferences: PersistedAnnotationFile["preferences"] = {}

    for (const [sessionID, store] of Object.entries(file.annotations)) {
      if (maxAnnotationTimestamp(store) >= cutoff) {
        annotations[sessionID] = store
      }
    }
    for (const [sessionID, prefs] of Object.entries(file.preferences)) {
      if (annotations[sessionID]) preferences[sessionID] = prefs
    }
    return { v: ANNOTATION_PERSISTENCE_SCHEMA_VERSION, savedAt: file.savedAt, annotations, preferences }
  }

  return { readSync, writeAtomic, pathFor, pruneExpired, empty }
}

let _defaultPersistence: AnnotationPersistence | null = null
let _cachedFile: PersistedAnnotationFile | null = null

function resolveDefaultPath(): string {
  return process.env.IDM_ANNOTATION_PERSISTENCE_PATH ?? DEFAULT_PATH
}

function defaultPersistence(): AnnotationPersistence {
  if (!_defaultPersistence) {
    _defaultPersistence = createAnnotationPersistence({ path: resolveDefaultPath() })
  }
  return _defaultPersistence
}

export function ensureCachedFile(): PersistedAnnotationFile {
  if (_cachedFile) return _cachedFile
  const persistence = defaultPersistence()
  const loaded = persistence.readSync()
  _cachedFile = loaded ? persistence.pruneExpired(loaded, Date.now()) : persistence.empty()
  return _cachedFile
}

export function updateAnnotationsForSession(
  sessionID: string,
  payload: SerializedSessionStore | null,
): void {
  const file = ensureCachedFile()
  if (payload === null) {
    delete file.annotations[sessionID]
  } else {
    file.annotations[sessionID] = payload
  }
  file.savedAt = Date.now()
  defaultPersistence().writeAtomic(file)
}

export function updatePreferencesForSession(
  sessionID: string,
  payload: Record<string, SerializedStoredPreference> | null,
): void {
  const file = ensureCachedFile()
  if (payload === null) {
    delete file.preferences[sessionID]
  } else {
    file.preferences[sessionID] = payload
  }
  file.savedAt = Date.now()
  defaultPersistence().writeAtomic(file)
}

export function loadAnnotations(): Record<string, SerializedSessionStore> {
  return ensureCachedFile().annotations
}

export function loadPreferences(): Record<string, Record<string, SerializedStoredPreference>> {
  return ensureCachedFile().preferences
}

export function _resetAnnotationPersistenceForTesting(config?: { path?: string }): void {
  const path = config?.path ?? resolveDefaultPath()
  _defaultPersistence = createAnnotationPersistence({ path })
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // best-effort cleanup
  }
  _cachedFile = null
}
