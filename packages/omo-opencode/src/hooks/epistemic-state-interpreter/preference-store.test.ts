import { afterEach, describe, expect, test } from "bun:test"
import { loadPreferences as loadPersistedPreferences } from "./annotation-persistence"
import {
  _clearInMemoryPreferenceStoreForTesting,
  clearPreferences,
  getPreferences,
  loadPreferenceStoreFromDisk,
  storePreference,
} from "./preference-store"

const sessionID = "session-1"
const rule = { superior: "rule-a", inferior: "rule-b", strength: 0.5 }

afterEach(() => {
  clearPreferences(sessionID)
  clearPreferences("session-2")
})

describe("preference-store", () => {
  describe("#given an empty session", () => {
    test("#when storePreference is called #then it creates a new entry", () => {
      const result = storePreference(sessionID, rule)

      expect(result.applied).toBe(0.5)
      expect(getPreferences(sessionID).get("rule-a>rule-b")?.combined).toBe(0.5)
    })

    test("#when getPreferences is called for an unknown session #then it returns an empty map", () => {
      expect(getPreferences("missing").size).toBe(0)
    })
  })

  describe("#given an existing preference", () => {
    test("#when storePreference is called again #then it updates the applied value", () => {
      storePreference(sessionID, rule)
      const result = storePreference(sessionID, { ...rule, strength: 1 })

      expect(result.applied).toBe(0.7)
    })

    test("#when a large change is stored #then dampening caps the delta at 0.2", () => {
      storePreference(sessionID, rule)
      const result = storePreference(sessionID, { ...rule, strength: 1 })

      expect(result.applied).toBe(0.7)
    })

    test("#when getPreferences is called for a known session #then it returns the stored preferences", () => {
      storePreference(sessionID, rule)

      expect(getPreferences(sessionID).get("rule-a>rule-b")?.combined).toBe(0.5)
    })

    test("#when clearPreferences is called #then it removes all preferences for the session", () => {
      storePreference(sessionID, rule)

      clearPreferences(sessionID)

      expect(getPreferences(sessionID).size).toBe(0)
    })

    test("#when clearPreferences is called for an unknown session #then it does not throw", () => {
      expect(() => clearPreferences("missing")).not.toThrow()
    })

    test("#when preferences oscillate #then circuit breaker state is preserved across updates", () => {
      storePreference(sessionID, { ...rule, strength: 0.1 })
      storePreference(sessionID, { ...rule, strength: 1 })
      storePreference(sessionID, { ...rule, strength: 0 })
      const next = storePreference(sessionID, { ...rule, strength: 1 })

      expect(next.cycleState.cycleCount).toBe(4)
      expect(next.cycleState.oscillationCount).toBe(2)
      expect(getPreferences(sessionID).get("rule-a>rule-b")?.cycleState).toEqual(
        next.cycleState
      )
    })
  })

  describe("#given disk persistence is wired", () => {
    test("#when a preference is stored #then it is mirrored to the persistence file", () => {
      storePreference(sessionID, rule)

      const persisted = loadPersistedPreferences()
      expect(persisted[sessionID]?.["rule-a>rule-b"]?.combined).toBe(0.5)
    })

    test("#when in-memory store is cleared but persistence is preserved #then getPreferences hydrates from disk", () => {
      storePreference(sessionID, rule)

      _clearInMemoryPreferenceStoreForTesting()

      expect(getPreferences(sessionID).get("rule-a>rule-b")?.combined).toBe(0.5)
    })

    test("#when loadPreferenceStoreFromDisk is called twice #then the second call is idempotent", () => {
      storePreference(sessionID, rule)
      _clearInMemoryPreferenceStoreForTesting()

      loadPreferenceStoreFromDisk()
      loadPreferenceStoreFromDisk()

      expect(getPreferences(sessionID).size).toBe(1)
    })

    test("#when clearPreferences is called #then the session entry is removed from disk too", () => {
      storePreference(sessionID, rule)
      expect(loadPersistedPreferences()[sessionID]).toBeDefined()

      clearPreferences(sessionID)

      expect(loadPersistedPreferences()[sessionID]).toBeUndefined()
    })
  })
})
