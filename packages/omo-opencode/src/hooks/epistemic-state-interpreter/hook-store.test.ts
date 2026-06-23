import { afterEach, describe, expect, test } from "bun:test"

import type { HookFactors } from "./hook-entity-types"
import {
  _resetHookStoreForTesting,
  clearHooks,
  createHook,
  getHookBalance,
  getHooksFor,
  updateHookStrength,
} from "./hook-store"

const factors: HookFactors = {
  epistemici: {
    supporto_empirico: 0.8,
    compatibilita_strutturale: 0.7,
    potenziale_esplicativo: 0.9,
    valore_verifica: 0.6,
    maturita: 0.5,
  },
  pragmatici: {
    beneficio_potenziale: 0.9,
    urgenza: 0.7,
    costo_verifica: 0.4,
    rischio: 0.2,
  },
}

afterEach(() => {
  _resetHookStoreForTesting()
})

describe("hook-store #given a session-scoped persistent store", () => {
  test("#when createHook is called #then it stores and returns a hook with an id", () => {
    const hook = createHook("session-a", "claim-a", "positivo", "medio", factors, "supports retention")

    expect(hook.id).toBe("hook_1")
    expect(hook.sessionId).toBe("session-a")
    expect(getHooksFor("session-a", "claim-a")).toEqual([hook])
  })

  test("#when getHooksFor is called #then it returns hooks for the requested target only", () => {
    const firstHook = createHook("session-a", "claim-a", "positivo", "debole", factors, "first")
    createHook("session-a", "claim-b", "negativo", "forte", factors, "second")
    const thirdHook = createHook("session-a", "claim-a", "negativo", "medio", factors, "third")

    expect(getHooksFor("session-a", "claim-a")).toEqual([firstHook, thirdHook])
  })

  test("#when getHooksFor is called for an unknown session #then it returns an empty array", () => {
    expect(getHooksFor("missing-session", "claim-a")).toEqual([])
  })

  test("#when only positive hooks are present #then getHookBalance returns retention", () => {
    createHook("session-a", "claim-a", "positivo", "debole", factors, "first")
    createHook("session-a", "claim-a", "positivo", "forte", factors, "second")

    expect(getHookBalance("session-a", "claim-a")).toEqual({
      target: "claim-a",
      positiveCount: 2,
      negativeCount: 0,
      positiveStrengthSum: 4,
      negativeStrengthSum: 0,
      netForce: 4,
      direction: "retention",
    })
  })

  test("#when only negative hooks are present #then getHookBalance returns expulsion", () => {
    createHook("session-a", "claim-a", "negativo", "medio", factors, "first")
    createHook("session-a", "claim-a", "negativo", "forte", factors, "second")

    expect(getHookBalance("session-a", "claim-a")).toEqual({
      target: "claim-a",
      positiveCount: 0,
      negativeCount: 2,
      positiveStrengthSum: 0,
      negativeStrengthSum: 5,
      netForce: -5,
      direction: "expulsion",
    })
  })

  test("#when one strong positive and one weak negative hook are present #then net force stays positive", () => {
    createHook("session-a", "claim-a", "positivo", "forte", factors, "support")
    createHook("session-a", "claim-a", "negativo", "debole", factors, "challenge")

    expect(getHookBalance("session-a", "claim-a")).toEqual({
      target: "claim-a",
      positiveCount: 1,
      negativeCount: 1,
      positiveStrengthSum: 3,
      negativeStrengthSum: 1,
      netForce: 2,
      direction: "retention",
    })
  })

  test("#when positive and negative force are balanced #then direction is neutral", () => {
    createHook("session-a", "claim-a", "positivo", "medio", factors, "support")
    createHook("session-a", "claim-a", "negativo", "medio", factors, "challenge")

    expect(getHookBalance("session-a", "claim-a")).toEqual({
      target: "claim-a",
      positiveCount: 1,
      negativeCount: 1,
      positiveStrengthSum: 2,
      negativeStrengthSum: 2,
      netForce: 0,
      direction: "neutral",
    })
  })

  test("#when updateHookStrength is called with an existing hook #then it changes the stored strength", () => {
    const hook = createHook("session-a", "claim-a", "positivo", "debole", factors, "support")

    expect(updateHookStrength("session-a", hook.id, "forte")).toBe(true)
    expect(getHooksFor("session-a", "claim-a")[0]?.strength).toBe("forte")
  })

  test("#when updateHookStrength is called for an unknown hook #then it returns false", () => {
    expect(updateHookStrength("session-a", "missing-hook", "forte")).toBe(false)
  })

  test("#when clearHooks is called #then all hooks for the session are removed", () => {
    createHook("session-a", "claim-a", "positivo", "debole", factors, "support")
    createHook("session-a", "claim-b", "negativo", "medio", factors, "challenge")

    clearHooks("session-a")

    expect(getHooksFor("session-a", "claim-a")).toEqual([])
    expect(getHooksFor("session-a", "claim-b")).toEqual([])
  })

  test("#when hooks exist in different sessions #then each session remains isolated", () => {
    createHook("session-a", "claim-a", "positivo", "forte", factors, "support")
    createHook("session-b", "claim-a", "negativo", "forte", factors, "challenge")

    expect(getHooksFor("session-a", "claim-a")).toHaveLength(1)
    expect(getHooksFor("session-a", "claim-a")[0]?.polarity).toBe("positivo")
    expect(getHooksFor("session-b", "claim-a")).toHaveLength(1)
    expect(getHooksFor("session-b", "claim-a")[0]?.polarity).toBe("negativo")
  })
})
