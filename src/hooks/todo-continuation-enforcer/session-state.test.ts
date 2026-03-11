/// <reference path="../../../bun-test.d.ts" />

import { afterEach, beforeEach, describe, expect, it as test } from "bun:test"

import { createSessionStateStore, type SessionStateStore } from "./session-state"

describe("createSessionStateStore", () => {
  let sessionStateStore: SessionStateStore

  beforeEach(() => {
    sessionStateStore = createSessionStateStore()
  })

  afterEach(() => {
    sessionStateStore.shutdown()
  })

  test("given repeated incomplete counts after a continuation, tracks stagnation", () => {
    // given
    const sessionID = "ses-stagnation"
    const state = sessionStateStore.getState(sessionID)

    // when
    const firstUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)
    state.awaitingPostInjectionProgressCheck = true
    const secondUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)
    state.awaitingPostInjectionProgressCheck = true
    const thirdUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)

    // then
    expect(firstUpdate.stagnationCount).toBe(0)
    expect(secondUpdate.stagnationCount).toBe(1)
    expect(thirdUpdate.stagnationCount).toBe(2)
  })

  test("given injection did not succeed, repeated incomplete counts do not track stagnation", () => {
    // given
    const sessionID = "ses-failed-injection"
    const state = sessionStateStore.getState(sessionID)
    state.lastInjectedAt = Date.now()

    // when
    const firstUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)
    const secondUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)
    const thirdUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)

    // then
    expect(firstUpdate.stagnationCount).toBe(0)
    expect(secondUpdate.stagnationCount).toBe(0)
    expect(thirdUpdate.stagnationCount).toBe(0)
  })

  test("given incomplete count decreases, resets stagnation tracking", () => {
    // given
    const sessionID = "ses-progress-reset"
    const state = sessionStateStore.getState(sessionID)
    state.lastInjectedAt = Date.now()
    sessionStateStore.trackContinuationProgress(sessionID, 3)
    sessionStateStore.trackContinuationProgress(sessionID, 3)

    // when
    const progressUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)

    // then
    expect(progressUpdate.hasProgressed).toBe(true)
    expect(progressUpdate.stagnationCount).toBe(0)
    expect(sessionStateStore.getState(sessionID).lastIncompleteCount).toBe(2)
  })

  test("given one todo completes while another is added, resets stagnation even when incomplete count stays the same", () => {
    // given
    const sessionID = "ses-completion-with-addition"
    const state = sessionStateStore.getState(sessionID)
    state.lastInjectedAt = Date.now()
    const initialTodos = [
      { id: "1", content: "Task 1", status: "pending", priority: "high" },
      { id: "2", content: "Task 2", status: "pending", priority: "medium" },
    ]
    const progressedTodos = [
      { id: "1", content: "Task 1", status: "completed", priority: "high" },
      { id: "2", content: "Task 2", status: "pending", priority: "medium" },
      { id: "3", content: "Task 3", status: "pending", priority: "low" },
    ]
    sessionStateStore.trackContinuationProgress(sessionID, 2, initialTodos)
    sessionStateStore.trackContinuationProgress(sessionID, 2, initialTodos)

    // when
    const progressUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2, progressedTodos)

    // then
    expect(progressUpdate.hasProgressed).toBe(true)
    expect(progressUpdate.stagnationCount).toBe(0)
  })

  test("given todo status changes without count changes, treats it as progress", () => {
    // given
    const sessionID = "ses-status-change-progress"
    const state = sessionStateStore.getState(sessionID)
    state.lastInjectedAt = Date.now()
    const initialTodos = [
      { id: "1", content: "Task 1", status: "pending", priority: "high" },
      { id: "2", content: "Task 2", status: "pending", priority: "medium" },
    ]
    const progressedTodos = [
      { id: "1", content: "Task 1", status: "in_progress", priority: "high" },
      { id: "2", content: "Task 2", status: "pending", priority: "medium" },
    ]
    sessionStateStore.trackContinuationProgress(sessionID, 2, initialTodos)
    sessionStateStore.trackContinuationProgress(sessionID, 2, initialTodos)

    // when
    const progressUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2, progressedTodos)

    // then
    expect(progressUpdate.hasProgressed).toBe(true)
    expect(progressUpdate.stagnationCount).toBe(0)
  })

  test("given progress resumes after stagnation, restarts the stagnation count from zero", () => {
    // given
    const sessionID = "ses-progress-restarts-stagnation"
    const state = sessionStateStore.getState(sessionID)
    state.lastInjectedAt = Date.now()
    const initialTodos = [
      { id: "1", content: "Task 1", status: "pending", priority: "high" },
      { id: "2", content: "Task 2", status: "pending", priority: "medium" },
    ]
    const progressedTodos = [
      { id: "1", content: "Task 1", status: "in_progress", priority: "high" },
      { id: "2", content: "Task 2", status: "pending", priority: "medium" },
    ]
    sessionStateStore.trackContinuationProgress(sessionID, 2, initialTodos)
    state.awaitingPostInjectionProgressCheck = true
    sessionStateStore.trackContinuationProgress(sessionID, 2, initialTodos)
    state.awaitingPostInjectionProgressCheck = true
    sessionStateStore.trackContinuationProgress(sessionID, 2, progressedTodos)

    // when
    state.awaitingPostInjectionProgressCheck = true
    const stagnatedAgainUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2, progressedTodos)

    // then
    expect(stagnatedAgainUpdate.hasProgressed).toBe(false)
    expect(stagnatedAgainUpdate.stagnationCount).toBe(1)
  })
})
