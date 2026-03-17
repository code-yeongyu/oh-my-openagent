/// <reference path="../../../bun-test.d.ts" />

import { afterEach, beforeEach, describe, expect, it as test } from "bun:test"

import { MAX_STAGNATION_COUNT } from "./constants"
import { createSessionStateStore, type SessionStateStore } from "./session-state"

describe("createSessionStateStore regressions", () => {
  let sessionStateStore: SessionStateStore

  beforeEach(() => {
    sessionStateStore = createSessionStateStore()
  })

  afterEach(() => {
    sessionStateStore.shutdown()
  })

  describe("#given external activity happens after a successful continuation", () => {
    describe("#when todos stay unchanged", () => {
      test("#then it keeps counting stagnation", () => {
        const sessionID = "ses-activity-progress"
        const todos = [
          { id: "1", content: "Task 1", status: "pending", priority: "high" },
          { id: "2", content: "Task 2", status: "pending", priority: "medium" },
        ]
        const state = sessionStateStore.getState(sessionID)

        sessionStateStore.trackContinuationProgress(sessionID, 2, todos)
        state.awaitingPostInjectionProgressCheck = true

        const trackedState = sessionStateStore.getExistingState(sessionID)
        if (!trackedState) {
          throw new Error("Expected tracked session state")
        }

        trackedState.abortDetectedAt = undefined
        const progressUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2, todos)

        expect(progressUpdate.hasProgressed).toBe(false)
        expect(progressUpdate.progressSource).toBe("none")
        expect(progressUpdate.stagnationCount).toBe(1)
      })
    })
  })

  describe("#given todos only change order between idle checks", () => {
    describe("#when the same todos are compared again", () => {
      test("#then it keeps the snapshot stable and counts stagnation", () => {
        const sessionID = "ses-stable-snapshot"
        const firstTodos = [
          { id: "2", content: "Task 2", status: "pending", priority: "medium" },
          { id: "1", content: "Task 1", status: "pending", priority: "high" },
        ]
        const reorderedTodos = [
          { id: "1", content: "Task 1", status: "pending", priority: "high" },
          { id: "2", content: "Task 2", status: "pending", priority: "medium" },
        ]
        const state = sessionStateStore.getState(sessionID)

        sessionStateStore.trackContinuationProgress(sessionID, 2, firstTodos)
        state.awaitingPostInjectionProgressCheck = true

        const progressUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2, reorderedTodos)

        expect(progressUpdate.hasProgressed).toBe(false)
        expect(progressUpdate.progressSource).toBe("none")
        expect(progressUpdate.stagnationCount).toBe(1)
      })
    })
  })

  describe("#given stagnation already halted a session", () => {
    describe("#when new activity appears before the next idle check", () => {
      test("#then it does not reset the stop condition", () => {
        const sessionID = "ses-stagnation-recovery"
        const todos = [
          { id: "1", content: "Task 1", status: "pending", priority: "high" },
          { id: "2", content: "Task 2", status: "pending", priority: "medium" },
        ]
        const state = sessionStateStore.getState(sessionID)

        sessionStateStore.trackContinuationProgress(sessionID, 2, todos)

        for (let index = 0; index < MAX_STAGNATION_COUNT; index++) {
          state.awaitingPostInjectionProgressCheck = true
          sessionStateStore.trackContinuationProgress(sessionID, 2, todos)
        }

        const trackedState = sessionStateStore.getExistingState(sessionID)
        if (!trackedState) {
          throw new Error("Expected tracked session state")
        }

        trackedState.abortDetectedAt = undefined
        const progressUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2, todos)

        expect(progressUpdate.previousStagnationCount).toBe(MAX_STAGNATION_COUNT)
        expect(progressUpdate.hasProgressed).toBe(false)
        expect(progressUpdate.progressSource).toBe("none")
        expect(progressUpdate.stagnationCount).toBe(MAX_STAGNATION_COUNT)
      })
    })
  })
})
