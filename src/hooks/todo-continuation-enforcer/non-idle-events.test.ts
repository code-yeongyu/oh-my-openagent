/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import { handleNonIdleEvent } from "./non-idle-events"
import { createSessionStateStore, type SessionStateStore } from "./session-state"

describe("handleNonIdleEvent", () => {
  let sessionStateStore: SessionStateStore

  beforeEach(() => {
    sessionStateStore = createSessionStateStore()
  })

  afterEach(() => {
    sessionStateStore.shutdown()
  })

  test("given synthetic user message update, keeps continuation countdown state intact", () => {
    // given
    const sessionID = "ses_synthetic_user_event"
    const state = sessionStateStore.getState(sessionID)
    state.countdownStartedAt = Date.now() - 10_000
    state.wasCancelled = true
    state.tokenLimitDetected = true

    // when
    handleNonIdleEvent({
      eventType: "message.updated",
      properties: {
        sessionID,
        info: { role: "user" },
        parts: [{ type: "text", text: "internal wake", synthetic: true }],
      },
      sessionStateStore,
    })

    // then
    expect(state.countdownStartedAt).toBeDefined()
    expect(state.wasCancelled).toBe(true)
    expect(state.tokenLimitDetected).toBe(true)
  })

  test("given internally marked user message update, keeps continuation countdown state intact", () => {
    // given
    const sessionID = "ses_internal_user_event"
    const state = sessionStateStore.getState(sessionID)
    state.countdownStartedAt = Date.now() - 10_000
    state.wasCancelled = true
    state.tokenLimitDetected = true

    // when
    handleNonIdleEvent({
      eventType: "message.updated",
      properties: {
        sessionID,
        info: { role: "user" },
        parts: [
          { type: "text", text: `internal wake\n${OMO_INTERNAL_INITIATOR_MARKER}` },
        ],
      },
      sessionStateStore,
    })

    // then
    expect(state.countdownStartedAt).toBeDefined()
    expect(state.wasCancelled).toBe(true)
    expect(state.tokenLimitDetected).toBe(true)
  })
})
