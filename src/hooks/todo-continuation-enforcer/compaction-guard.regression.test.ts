import { describe, expect, it as test } from "bun:test"

import { COMPACTION_GUARD_MS } from "./constants"
import {
  acknowledgeCompactionGuard,
  armCompactionGuard,
  isCompactionGuardActive,
} from "./compaction-guard"
import type { SessionState } from "./types"

function createSessionState(): SessionState {
  return {
    stagnationCount: 0,
    consecutiveFailures: 0,
  }
}

describe("compaction guard regressions", () => {
  describe("#given a compaction epoch was already acknowledged", () => {
    describe("#when a newer compaction epoch is armed", () => {
      test("#then the guard re-arms for the newer epoch", () => {
        const state = createSessionState()

        const firstEpoch = armCompactionGuard(state, 1_000)
        expect(acknowledgeCompactionGuard(state, firstEpoch)).toBe(true)
        expect(isCompactionGuardActive(state, 1_001)).toBe(false)

        const secondEpoch = armCompactionGuard(state, 2_000)

        expect(secondEpoch).toBe(firstEpoch + 1)
        expect(state.recentCompactionEpoch).toBe(secondEpoch)
        expect(isCompactionGuardActive(state, 2_001)).toBe(true)
      })
    })
  })

  describe("#given a newer compaction epoch is armed before an older idle check finishes", () => {
    describe("#when the older epoch tries to acknowledge the guard", () => {
      test("#then it does not clear the newer epoch", () => {
        const state = createSessionState()

        const firstEpoch = armCompactionGuard(state, 1_000)
        const secondEpoch = armCompactionGuard(state, 2_000)

        expect(acknowledgeCompactionGuard(state, firstEpoch)).toBe(false)
        expect(state.acknowledgedCompactionEpoch).toBeUndefined()
        expect(state.recentCompactionEpoch).toBe(secondEpoch)
        expect(isCompactionGuardActive(state, 2_001)).toBe(true)
      })
    })
  })

  describe("#given the current compaction epoch is still inside the guard window", () => {
    describe("#when that same epoch is acknowledged", () => {
      test("#then continuation can proceed again without waiting for the window to expire", () => {
        const state = createSessionState()

        const currentEpoch = armCompactionGuard(state, 1_000)

        expect(isCompactionGuardActive(state, 1_000 + COMPACTION_GUARD_MS - 1)).toBe(true)
        expect(acknowledgeCompactionGuard(state, currentEpoch)).toBe(true)
        expect(isCompactionGuardActive(state, 1_001)).toBe(false)
        expect(isCompactionGuardActive(state, 1_000 + COMPACTION_GUARD_MS - 1)).toBe(false)
      })
    })
  })
})
