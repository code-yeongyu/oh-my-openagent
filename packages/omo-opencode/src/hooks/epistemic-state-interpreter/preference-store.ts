import {
  loadPreferences as loadPersistedPreferences,
  updatePreferencesForSession,
  type SerializedStoredPreference,
} from "./annotation-persistence"
import {
  createInitialCycleState,
  updateCycleState,
} from "./preference-circuit-breaker"
import { dampenPreference } from "./preference-dampener"
import type { PreferenceCycleState, RulePreference } from "./preference-types"

interface StoredPreference {
  combined: number
  cycleState: PreferenceCycleState
}

const store = new Map<string, Map<string, StoredPreference>>()
let initialized = false

function isCycleState(value: unknown): value is PreferenceCycleState {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<PreferenceCycleState>
  return (
    typeof candidate.cycleCount === "number" &&
    (candidate.lastDirection === "up" ||
      candidate.lastDirection === "down" ||
      candidate.lastDirection === "none") &&
    typeof candidate.oscillationCount === "number" &&
    typeof candidate.frozen === "boolean"
  )
}

function ensureInitialized(): void {
  if (initialized) return
  initialized = true
  const persisted = loadPersistedPreferences()
  for (const [sessionId, prefs] of Object.entries(persisted)) {
    const sessionStore = new Map<string, StoredPreference>()
    for (const [key, value] of Object.entries(prefs)) {
      if (!isCycleState(value.cycleState)) continue
      sessionStore.set(key, { combined: value.combined, cycleState: value.cycleState })
    }
    if (sessionStore.size > 0) store.set(sessionId, sessionStore)
  }
}

function persistSession(sessionId: string): void {
  const sessionStore = store.get(sessionId)
  if (!sessionStore || sessionStore.size === 0) {
    updatePreferencesForSession(sessionId, null)
    return
  }
  const payload: Record<string, SerializedStoredPreference> = {}
  for (const [key, value] of sessionStore.entries()) {
    payload[key] = { combined: value.combined, cycleState: value.cycleState }
  }
  updatePreferencesForSession(sessionId, payload)
}

function ruleKey(superior: string, inferior: string): string {
  return `${superior}>${inferior}`
}

export function storePreference(
  sessionId: string,
  preference: RulePreference
): { applied: number; cycleState: PreferenceCycleState } {
  ensureInitialized()
  if (!store.has(sessionId)) {
    store.set(sessionId, new Map())
  }

  const sessionStore = store.get(sessionId)!
  const key = ruleKey(preference.superior, preference.inferior)
  const existing = sessionStore.get(key) ?? {
    combined: preference.strength,
    cycleState: createInitialCycleState(),
  }

  const dampened = dampenPreference(key, existing.combined, preference.strength)
  const newCycleState = updateCycleState(
    existing.cycleState,
    existing.combined,
    dampened.applied
  )

  sessionStore.set(key, {
    combined: dampened.applied,
    cycleState: newCycleState,
  })
  persistSession(sessionId)

  return { applied: dampened.applied, cycleState: newCycleState }
}

export function getPreferences(sessionId: string): Map<string, StoredPreference> {
  ensureInitialized()
  return store.get(sessionId) ?? new Map()
}

export function clearPreferences(sessionId: string): void {
  store.delete(sessionId)
  persistSession(sessionId)
}

export function loadPreferenceStoreFromDisk(): void {
  ensureInitialized()
}

export function _clearInMemoryPreferenceStoreForTesting(): void {
  store.clear()
  initialized = false
}
