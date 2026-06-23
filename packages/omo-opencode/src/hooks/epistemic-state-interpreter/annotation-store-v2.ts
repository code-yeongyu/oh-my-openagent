import {
  _resetAnnotationPersistenceForTesting,
  loadAnnotations as loadPersistedAnnotations,
  updateAnnotationsForSession,
  type SerializedSessionStore,
} from "./annotation-persistence"
import type { EpistemicHook } from "./hook-entity-types"
import type { MultiPlaneAnnotation, ValutazioneMultiAsse } from "./multi-plane-types"

interface SessionStore {
  annotations: MultiPlaneAnnotation[]
  hooks: EpistemicHook[]
  evaluationHistory: Array<{
    conclusion: string
    timestamp: number
    valutazione: ValutazioneMultiAsse
  }>
}

const store = new Map<string, SessionStore>()
let initialized = false

function createEmptySessionStore(): SessionStore {
  return {
    annotations: [],
    hooks: [],
    evaluationHistory: [],
  }
}

function hydrateFromDisk(): void {
  const persisted = loadPersistedAnnotations()
  for (const [sessionID, data] of Object.entries(persisted)) {
    store.set(sessionID, data as unknown as SessionStore)
  }
}

function ensureInitialized(): void {
  if (initialized) return
  initialized = true
  hydrateFromDisk()
}

function getOrCreateSessionStore(sessionID: string): SessionStore {
  ensureInitialized()
  const existing = store.get(sessionID)
  if (existing) {
    return existing
  }

  const sessionStore = createEmptySessionStore()
  store.set(sessionID, sessionStore)
  return sessionStore
}

function getSessionStore(sessionID: string): SessionStore {
  ensureInitialized()
  return store.get(sessionID) ?? createEmptySessionStore()
}

function persistSession(sessionID: string): void {
  const s = store.get(sessionID)
  if (!s) {
    updateAnnotationsForSession(sessionID, null)
    return
  }
  updateAnnotationsForSession(sessionID, s as unknown as SerializedSessionStore)
}

export function storeMultiPlaneAnnotations(sessionID: string, annotations: MultiPlaneAnnotation[]): void {
  getOrCreateSessionStore(sessionID).annotations.push(...annotations)
  persistSession(sessionID)
}

export function getMultiPlaneAnnotations(sessionID: string): MultiPlaneAnnotation[] {
  return getSessionStore(sessionID).annotations
}

export function storeSessionHooks(sessionID: string, hooks: EpistemicHook[]): void {
  getOrCreateSessionStore(sessionID).hooks.push(...hooks)
  persistSession(sessionID)
}

export function getSessionHooks(sessionID: string): EpistemicHook[] {
  return getSessionStore(sessionID).hooks
}

export function storeEvaluationHistory(
  sessionID: string,
  entry: { conclusion: string; timestamp: number; valutazione: ValutazioneMultiAsse }
): void {
  getOrCreateSessionStore(sessionID).evaluationHistory.push(entry)
  persistSession(sessionID)
}

export function getEvaluationHistory(sessionID: string): SessionStore["evaluationHistory"] {
  return getSessionStore(sessionID).evaluationHistory
}

export function clearMultiPlaneStore(sessionID: string): void {
  store.delete(sessionID)
  persistSession(sessionID)
}

export function persistAnnotationsForSession(sessionID: string): void {
  persistSession(sessionID)
}

export function _clearInMemoryMultiPlaneStoreForTesting(): void {
  store.clear()
  initialized = false
}

export function _resetMultiPlaneStoreForTesting(): void {
  _clearInMemoryMultiPlaneStoreForTesting()
  _resetAnnotationPersistenceForTesting()
}
