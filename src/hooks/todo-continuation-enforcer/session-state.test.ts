import { afterEach, beforeEach, describe, expect, test } from "bun:test"

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
    state.lastInjectedAt = Date.now()

    // when
    const firstUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)
    const secondUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)
    const thirdUpdate = sessionStateStore.trackContinuationProgress(sessionID, 2)

    // then
    expect(firstUpdate.stagnationCount).toBe(0)
    expect(secondUpdate.stagnationCount).toBe(1)
    expect(thirdUpdate.stagnationCount).toBe(2)
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
})
