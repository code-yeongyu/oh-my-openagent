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

  test("given ultrawork loop continuation user message update, cancels stale todo continuation countdown", () => {
    // given
    const sessionID = "ses_ulw_todo_overlap"
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
          {
            type: "text",
            text: `ultrawork [SYSTEM DIRECTIVE: OH-MY-OPENCODE - RALPH LOOP 2/500]\ncontinue\n${OMO_INTERNAL_INITIATOR_MARKER}`,
            synthetic: true,
          },
        ],
      },
      sessionStateStore,
    })

    // then
    expect(state.countdownStartedAt).toBeUndefined()
    expect(state.wasCancelled).toBe(true)
    expect(state.tokenLimitDetected).toBe(true)
  })

  test("given a real user message after accepted continuation, records an interruption boundary", () => {
    // given
    const sessionID = "ses_real_user_interruption"
    const state = sessionStateStore.getState(sessionID)
    state.awaitingPostInjectionProgressCheck = true
    state.countdownStartedAt = Date.now()

    // when
    handleNonIdleEvent({
      eventType: "message.updated",
      properties: {
        sessionID,
        info: { role: "user" },
        parts: [{ type: "text", text: "Stop and inspect the context.", synthetic: false }],
      },
      sessionStateStore,
    })

    // then
    expect(state.continuationBlockReason).toBe("user-interruption")
    expect(state.countdownStartedAt).toBeUndefined()
  })

  test("given a synthetic message after accepted continuation, does not record a user interruption", () => {
    // given
    const sessionID = "ses_synthetic_not_interruption"
    const state = sessionStateStore.getState(sessionID)
    state.awaitingPostInjectionProgressCheck = true

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
    expect(state.continuationBlockReason).toBeUndefined()
  })

  test("given OpenCode splits an internal user message across events, waits for synthetic part provenance", () => {
    // given
    const sessionID = "ses_split_internal_message"
    const messageID = "msg_split_internal"
    const state = sessionStateStore.getState(sessionID)
    state.awaitingPostInjectionProgressCheck = true

    // when
    handleNonIdleEvent({
      eventType: "message.updated",
      properties: { sessionID, info: { id: messageID, role: "user" } },
      sessionStateStore,
    })

    // then
    expect(state.continuationBlockReason).toBeUndefined()

    // when
    handleNonIdleEvent({
      eventType: "message.part.updated",
      properties: {
        sessionID,
        part: {
          messageID,
          type: "text",
          text: `internal wake\n${OMO_INTERNAL_INITIATOR_MARKER}`,
          synthetic: true,
        },
      },
      sessionStateStore,
    })

    // then
    expect(state.continuationBlockReason).toBeUndefined()
  })

  test("given OpenCode splits a genuine user message across events, records interruption from its part", () => {
    // given
    const sessionID = "ses_split_genuine_message"
    const messageID = "msg_split_genuine"
    const state = sessionStateStore.getState(sessionID)
    state.awaitingPostInjectionProgressCheck = true

    // when
    handleNonIdleEvent({
      eventType: "message.updated",
      properties: { sessionID, info: { id: messageID, role: "user" } },
      sessionStateStore,
    })

    // then
    expect(state.continuationBlockReason).toBeUndefined()

    // when
    handleNonIdleEvent({
      eventType: "message.part.updated",
      properties: {
        sessionID,
        part: {
          messageID,
          type: "text",
          text: "Stop and inspect the context.",
          synthetic: false,
        },
      },
      sessionStateStore,
    })

    // then
    expect(state.continuationBlockReason).toBe("user-interruption")
  })
})
