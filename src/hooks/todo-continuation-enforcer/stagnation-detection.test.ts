/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, it as test } from "bun:test"

import { MAX_STAGNATION_COUNT } from "./constants"
import { handleNonIdleEvent } from "./non-idle-events"
import { createSessionStateStore } from "./session-state"
import { shouldStopForStagnation } from "./stagnation-detection"

describe("shouldStopForStagnation", () => {
  describe("#given stagnation reaches the configured limit", () => {
    describe("#when no progress is detected", () => {
      test("#then it stops continuation", () => {
        const shouldStop = shouldStopForStagnation({
          sessionID: "ses-stagnated",
          incompleteCount: 2,
          progressUpdate: {
            previousIncompleteCount: 2,
            previousStagnationCount: MAX_STAGNATION_COUNT - 1,
            stagnationCount: MAX_STAGNATION_COUNT,
            hasProgressed: false,
            progressSource: "none",
          },
        })

        expect(shouldStop).toBe(true)
      })
    })

    describe("#when todo progress is detected after the halt", () => {
      test("#then it clears the stop condition", () => {
        const shouldStop = shouldStopForStagnation({
          sessionID: "ses-recovered",
          incompleteCount: 2,
          progressUpdate: {
            previousIncompleteCount: 2,
            previousStagnationCount: MAX_STAGNATION_COUNT,
            stagnationCount: 0,
            hasProgressed: true,
            progressSource: "todo",
          },
        })

        expect(shouldStop).toBe(false)
      })
    })
  })

  describe("#given only non-idle tool and message events happen between idle checks", () => {
    describe("#when todo state does not change across three idle cycles", () => {
      test("#then stagnation count reaches three", () => {
        // given
        const sessionStateStore = createSessionStateStore()
        const sessionID = "ses-non-idle-activity-without-progress"
        const state = sessionStateStore.getState(sessionID)
        const todos = [
          { id: "1", content: "Task 1", status: "pending", priority: "high" },
          { id: "2", content: "Task 2", status: "pending", priority: "medium" },
        ]

        sessionStateStore.trackContinuationProgress(sessionID, 2, todos)

        // when
        state.awaitingPostInjectionProgressCheck = true
        const firstCycle = sessionStateStore.trackContinuationProgress(sessionID, 2, todos)

        handleNonIdleEvent({
          eventType: "tool.execute.before",
          properties: { sessionID },
          sessionStateStore,
        })
        handleNonIdleEvent({
          eventType: "message.updated",
          properties: { info: { sessionID, role: "assistant" } },
          sessionStateStore,
        })

        state.awaitingPostInjectionProgressCheck = true
        const secondCycle = sessionStateStore.trackContinuationProgress(sessionID, 2, todos)

        handleNonIdleEvent({
          eventType: "tool.execute.after",
          properties: { sessionID },
          sessionStateStore,
        })
        handleNonIdleEvent({
          eventType: "message.part.updated",
          properties: { info: { sessionID, role: "assistant" } },
          sessionStateStore,
        })

        state.awaitingPostInjectionProgressCheck = true
        const thirdCycle = sessionStateStore.trackContinuationProgress(sessionID, 2, todos)

        // then
        expect(firstCycle.stagnationCount).toBe(1)
        expect(secondCycle.stagnationCount).toBe(2)
        expect(thirdCycle.stagnationCount).toBe(3)

        sessionStateStore.shutdown()
      })
    })
  })
})
