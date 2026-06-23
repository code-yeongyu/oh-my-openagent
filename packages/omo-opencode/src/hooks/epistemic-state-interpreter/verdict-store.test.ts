import { afterEach, describe, expect, it } from "bun:test"
import { _resetForTesting, clearSession, getVerdict, storeVerdict } from "./verdict-store.ts"
import type { PolicyVerdict } from "../reasoning-core-policy-gate/types.ts"

const ALLOW_VERDICT: PolicyVerdict = { allow: true, proofArtifact: { result: {}, theory: {} } }
const DENY_VERDICT: PolicyVerdict = { allow: false, reason: "denied" }

afterEach(() => {
  _resetForTesting()
})

describe("storeVerdict / getVerdict", () => {
  describe("#given a stored verdict", () => {
    it("#when retrieved by same key #then returns the verdict", () => {
      storeVerdict("ses1:call1", ALLOW_VERDICT)
      expect(getVerdict("ses1:call1")).toEqual(ALLOW_VERDICT)
    })

    it("#when retrieved by different key #then returns undefined", () => {
      storeVerdict("ses1:call1", ALLOW_VERDICT)
      expect(getVerdict("ses1:call2")).toBeUndefined()
    })

    it("#when key does not exist #then returns undefined", () => {
      expect(getVerdict("nonexistent:key")).toBeUndefined()
    })
  })

  describe("#given multiple stored verdicts", () => {
    it("#when each key is retrieved #then returns correct verdict", () => {
      storeVerdict("ses1:call1", ALLOW_VERDICT)
      storeVerdict("ses1:call2", DENY_VERDICT)

      expect(getVerdict("ses1:call1")).toEqual(ALLOW_VERDICT)
      expect(getVerdict("ses1:call2")).toEqual(DENY_VERDICT)
    })
  })
})

describe("clearSession", () => {
  describe("#given verdicts stored for two sessions", () => {
    it("#when session 1 is cleared #then only session 1 entries are removed", () => {
      storeVerdict("ses1:call1", ALLOW_VERDICT)
      storeVerdict("ses1:call2", DENY_VERDICT)
      storeVerdict("ses2:call1", ALLOW_VERDICT)

      clearSession("ses1")

      expect(getVerdict("ses1:call1")).toBeUndefined()
      expect(getVerdict("ses1:call2")).toBeUndefined()
      expect(getVerdict("ses2:call1")).toEqual(ALLOW_VERDICT)
    })

    it("#when clearing a session with no entries #then does not throw", () => {
      expect(() => clearSession("nonexistent-session")).not.toThrow()
    })
  })
})

describe("_resetForTesting", () => {
  it("#when called #then clears all entries", () => {
    storeVerdict("ses1:call1", ALLOW_VERDICT)
    storeVerdict("ses2:call1", DENY_VERDICT)
    _resetForTesting()
    expect(getVerdict("ses1:call1")).toBeUndefined()
    expect(getVerdict("ses2:call1")).toBeUndefined()
  })
})
