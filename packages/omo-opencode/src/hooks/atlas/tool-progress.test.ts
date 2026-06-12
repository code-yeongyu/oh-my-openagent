import { describe, expect, test } from "bun:test"

import {
  recordToolProgress,
  resetStallStateForPlanChange,
  shouldAbortForNoToolProgress,
  updateNoToolProgressIterations,
  markContinuationInjectedAwaitingToolProgress,
  markContinuationStalled,
  MAX_BOULDER_CONTINUATION_NO_TOOL_PROGRESS,
} from "./tool-progress"
import type { SessionState } from "./types"

function emptyState(): SessionState {
  return { promptFailureCount: 0 }
}

describe("#given a fresh session state", () => {
  describe("#when resetStallStateForPlanChange is called the first time", () => {
    test("#then it records the active plan path without touching counters", () => {
      // given
      const state = emptyState()

      // when
      resetStallStateForPlanChange(state, "/plans/a.md")

      // then
      expect(state.activeContinuationPlanPath).toBe("/plans/a.md")
      expect(state.iterationsSinceLastToolProgress).toBeUndefined()
      expect(state.awaitingToolProgressAfterContinuation).toBeUndefined()
      expect(state.stalledContinuationReason).toBeUndefined()
    })
  })
})

describe("#given a session that already accumulated no-tool-progress for plan A", () => {
  describe("#when the active plan switches to plan B before the stall threshold is hit", () => {
    test("#then iterations and awaiting state reset so plan B gets a fresh budget", () => {
      // given - plan A starts and the agent racks up 2 no-progress iterations without stalling yet
      const state = emptyState()
      resetStallStateForPlanChange(state, "/plans/a.md")
      markContinuationInjectedAwaitingToolProgress(state)
      updateNoToolProgressIterations(state)
      markContinuationInjectedAwaitingToolProgress(state)
      updateNoToolProgressIterations(state)
      expect(state.iterationsSinceLastToolProgress).toBe(2)

      // when - active plan switches to plan B
      resetStallStateForPlanChange(state, "/plans/b.md")

      // then - plan B inherits a clean counter and is NOT one idle away from a false stall
      expect(state.activeContinuationPlanPath).toBe("/plans/b.md")
      expect(state.iterationsSinceLastToolProgress).toBe(0)
      expect(state.awaitingToolProgressAfterContinuation).toBe(false)
      expect(shouldAbortForNoToolProgress(state)).toBe(false)
    })
  })

  describe("#when the active plan stays the same", () => {
    test("#then counters are preserved across the reset call", () => {
      // given
      const state = emptyState()
      resetStallStateForPlanChange(state, "/plans/a.md")
      markContinuationInjectedAwaitingToolProgress(state)
      updateNoToolProgressIterations(state)

      // when
      resetStallStateForPlanChange(state, "/plans/a.md")

      // then
      expect(state.iterationsSinceLastToolProgress).toBe(1)
      expect(state.activeContinuationPlanPath).toBe("/plans/a.md")
    })
  })
})

describe("#given a session that already stalled on plan A", () => {
  describe("#when the active plan switches to a different plan B", () => {
    test("#then both the stall state and the in-progress counter clear for the new plan", () => {
      // given - plan A reached the stall threshold and got marked stalled
      const state = emptyState()
      resetStallStateForPlanChange(state, "/plans/a.md")
      for (let i = 0; i < MAX_BOULDER_CONTINUATION_NO_TOOL_PROGRESS; i += 1) {
        markContinuationInjectedAwaitingToolProgress(state)
        updateNoToolProgressIterations(state)
      }
      markContinuationStalled(state, "a", "/plans/a.md")
      expect(shouldAbortForNoToolProgress(state)).toBe(true)
      expect(state.stalledContinuationReason).toBeDefined()

      // when
      resetStallStateForPlanChange(state, "/plans/b.md")

      // then
      expect(state.activeContinuationPlanPath).toBe("/plans/b.md")
      expect(state.stalledContinuationReason).toBeUndefined()
      expect(state.stalledContinuationPlanPath).toBeUndefined()
      expect(state.iterationsSinceLastToolProgress).toBe(0)
      expect(state.awaitingToolProgressAfterContinuation).toBe(false)
      expect(shouldAbortForNoToolProgress(state)).toBe(false)
    })
  })
})

describe("#given a session running on plan A with tool progress", () => {
  describe("#when recordToolProgress fires", () => {
    test("#then counters clear but the activeContinuationPlanPath is preserved", () => {
      // given
      const state = emptyState()
      resetStallStateForPlanChange(state, "/plans/a.md")
      markContinuationInjectedAwaitingToolProgress(state)
      updateNoToolProgressIterations(state)

      // when
      recordToolProgress(state, 1000)

      // then
      expect(state.iterationsSinceLastToolProgress).toBe(0)
      expect(state.awaitingToolProgressAfterContinuation).toBe(false)
      expect(state.lastToolProgressAt).toBe(1000)
      expect(state.activeContinuationPlanPath).toBe("/plans/a.md")
    })
  })
})
