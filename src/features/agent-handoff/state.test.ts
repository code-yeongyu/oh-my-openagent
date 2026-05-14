/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import {
  recordAgentObservation,
  clearAgentObservation,
  _resetAllForTests,
} from "./state"

describe("recordAgentObservation", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  test("first observation in a session returns undefined", () => {
    const prior = recordAgentObservation("s1", "sisyphus")

    expect(prior).toBeUndefined()
  })

  test("same agent on consecutive observations returns undefined", () => {
    recordAgentObservation("s1", "sisyphus")
    const prior = recordAgentObservation("s1", "sisyphus")

    expect(prior).toBeUndefined()
  })

  test("changing agents returns the prior agent's display name", () => {
    recordAgentObservation("s1", "sisyphus")
    const prior = recordAgentObservation("s1", "hephaestus")

    expect(prior).toBe("sisyphus")
  })

  test("subsequent transitions return the most recent prior agent", () => {
    recordAgentObservation("s1", "sisyphus")
    recordAgentObservation("s1", "hephaestus")
    const prior = recordAgentObservation("s1", "atlas")

    expect(prior).toBe("hephaestus")
  })

  test("normalizes display variants so 'Hephaestus - Deep Agent' equals 'hephaestus'", () => {
    recordAgentObservation("s1", "hephaestus")
    const prior = recordAgentObservation("s1", "Hephaestus - Deep Agent")

    expect(prior).toBeUndefined()
  })

  test("observations are scoped per session", () => {
    recordAgentObservation("s1", "sisyphus")
    const prior = recordAgentObservation("s2", "hephaestus")

    expect(prior).toBeUndefined()
  })

  test("clearAgentObservation removes the stored value", () => {
    recordAgentObservation("s1", "sisyphus")
    clearAgentObservation("s1")
    const prior = recordAgentObservation("s1", "hephaestus")

    expect(prior).toBeUndefined()
  })

  describe("messageID dedup", () => {
    test("second call with the same messageID is a no-op (dual-fire pattern)", () => {
      // simulate opencode's dual-fire: first call has the real agent, second call ~5ms later has a stale default
      recordAgentObservation("s1", "hephaestus", "msg_1")
      const prior = recordAgentObservation("s1", "sisyphus", "msg_1")

      // the second firing must not be treated as a transition
      expect(prior).toBeUndefined()
    })

    test("the first call still updates state normally when a messageID is supplied", () => {
      recordAgentObservation("s1", "sisyphus", "msg_0")
      const prior = recordAgentObservation("s1", "hephaestus", "msg_1")

      expect(prior).toBe("sisyphus")
    })

    test("the second call's stale agent value does NOT leak into state", () => {
      // first turn: real=sisyphus, stale=sisyphus (same anyway)
      recordAgentObservation("s1", "sisyphus", "msg_0")
      recordAgentObservation("s1", "sisyphus", "msg_0")
      // second turn: real=hephaestus, stale=sisyphus
      recordAgentObservation("s1", "hephaestus", "msg_1")
      const stalePrior = recordAgentObservation("s1", "sisyphus", "msg_1")
      // third turn: real=hephaestus, stale=sisyphus
      const realPrior = recordAgentObservation("s1", "hephaestus", "msg_2")

      // stale firing was deduped, so msg_1's observation stayed at hephaestus,
      // and msg_2's real firing sees hephaestus->hephaestus (no transition)
      expect(stalePrior).toBeUndefined()
      expect(realPrior).toBeUndefined()
    })

    test("when messageID is undefined, dedup is bypassed (test/mock path)", () => {
      // legacy test path: no messageID means every call is treated as a fresh turn
      recordAgentObservation("s1", "sisyphus")
      const prior = recordAgentObservation("s1", "hephaestus")

      expect(prior).toBe("sisyphus")
    })

    test("clearAgentObservation also resets the messageID dedup state", () => {
      recordAgentObservation("s1", "sisyphus", "msg_0")
      clearAgentObservation("s1")
      // a fresh observation with the same messageID after clear should still record
      const prior = recordAgentObservation("s1", "hephaestus", "msg_0")

      expect(prior).toBeUndefined() // no prior because state was cleared
      // and a second call now does transition
      const prior2 = recordAgentObservation("s1", "atlas", "msg_1")
      expect(prior2).toBe("hephaestus")
    })
  })
})
