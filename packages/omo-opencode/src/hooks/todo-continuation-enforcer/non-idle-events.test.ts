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

  test("given a non-assistant message delta after a provider failure, preserves the provider failure streak", () => {
    // given
    const sessionID = "ses_provider_failure_delta"
    const state = sessionStateStore.getState(sessionID)
    state.awaitingPostInjectionProgressCheck = true
    state.consecutiveProviderFailures = 1

    // when
    handleNonIdleEvent({
      eventType: "message.part.delta",
      properties: { sessionID, delta: "partial provider output" },
      sessionStateStore,
    })

    // then
    expect(state.consecutiveProviderFailures).toBe(1)
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

  test("#given an unrecoverable error and a partless user message #when the split part proves it internal #then the stop flag survives", () => {
    // given
    const sessionID = "ses_unrecoverable_split_internal"
    const state = sessionStateStore.getState(sessionID)
    state.unrecoverableErrorDetected = true

    // when
    handleNonIdleEvent({
      eventType: "message.updated",
      properties: { sessionID, info: { role: "user", id: "msg_split_internal" } },
      sessionStateStore,
    })
    handleNonIdleEvent({
      eventType: "message.part.updated",
      properties: {
        sessionID,
        part: {
          type: "text",
          messageID: "msg_split_internal",
          text: `${OMO_INTERNAL_INITIATOR_MARKER}\ncontinuation echo`,
        },
      },
      sessionStateStore,
    })

    // then
    expect(state.pendingUserMessageID).toBeUndefined()
    expect(state.unrecoverableErrorDetected).toBe(true)
  })

  test("#given an unrecoverable error and a partless user message #when the split part proves it genuine #then the stop flag is cleared", () => {
    // given
    const sessionID = "ses_unrecoverable_split_genuine"
    const state = sessionStateStore.getState(sessionID)
    state.unrecoverableErrorDetected = true

    // when
    handleNonIdleEvent({
      eventType: "message.updated",
      properties: { sessionID, info: { role: "user", id: "msg_split_genuine" } },
      sessionStateStore,
    })
    handleNonIdleEvent({
      eventType: "message.part.updated",
      properties: {
        sessionID,
        part: { type: "text", messageID: "msg_split_genuine", text: "please carry on" },
      },
      sessionStateStore,
    })

    // then
    expect(state.pendingUserMessageID).toBeUndefined()
    expect(state.unrecoverableErrorDetected).toBe(false)
  })

  describe("provider failure streak across assistant activity", () => {
    const EMPTY_TOKENS = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    const STREAK = 3

    function armAcceptedContinuation(sessionID: string) {
      const state = sessionStateStore.getState(sessionID)
      state.awaitingPostInjectionProgressCheck = true
      state.consecutiveProviderFailures = STREAK
      return state
    }

    function emit(eventType: string, properties: Record<string, unknown>): void {
      handleNonIdleEvent({ eventType, properties, sessionStateStore })
    }

    test("#given an errored assistant message #when it is updated #then the streak and response flag are untouched", () => {
      // given
      const sessionID = "ses_streak_errored_message"
      const state = armAcceptedContinuation(sessionID)

      // when
      emit("message.updated", {
        info: {
          id: "msg_errored",
          sessionID,
          role: "assistant",
          error: { name: "APIError", data: { message: "usage limit has been reached", statusCode: 429, isRetryable: true } },
          finish: "unknown",
          tokens: EMPTY_TOKENS,
        },
      })

      // then
      expect(state.consecutiveProviderFailures).toBe(STREAK)
      expect(state.continuationResponseObserved).not.toBe(true)
    })

    test("#given an empty no-progress assistant turn without an error #when it is updated #then the streak and response flag are untouched", () => {
      // given
      const sessionID = "ses_streak_empty_turn"
      const state = armAcceptedContinuation(sessionID)

      // when
      emit("message.updated", {
        info: { id: "msg_empty", sessionID, role: "assistant", finish: "unknown", tokens: EMPTY_TOKENS },
      })

      // then
      expect(state.consecutiveProviderFailures).toBe(STREAK)
      expect(state.continuationResponseObserved).not.toBe(true)
    })

    test("#given a metadata-only assistant update #when it arrives #then it keeps the existing response flag but does not reset the streak", () => {
      // given
      const sessionID = "ses_streak_metadata_only"
      const state = armAcceptedContinuation(sessionID)

      // when
      emit("message.updated", { info: { id: "msg_created", sessionID, role: "assistant", tokens: EMPTY_TOKENS } })
      emit("message.updated", { info: { sessionID, role: "assistant" } })

      // then
      expect(state.continuationResponseObserved).toBe(true)
      expect(state.consecutiveProviderFailures).toBe(STREAK)
    })

    test("#given a completed assistant message with output tokens #when it is updated #then the streak resets", () => {
      // given
      const sessionID = "ses_streak_substantive_update"
      const state = armAcceptedContinuation(sessionID)

      // when
      emit("message.updated", {
        info: {
          id: "msg_done",
          sessionID,
          role: "assistant",
          finish: "stop",
          tokens: { input: 10, output: 42, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      })

      // then
      expect(state.consecutiveProviderFailures).toBe(0)
      expect(state.continuationResponseObserved).toBe(true)
    })

    test("#given a provider that reports no usage #when a finished assistant message arrives #then the streak resets", () => {
      // given
      const sessionID = "ses_streak_finish_without_usage"
      const state = armAcceptedContinuation(sessionID)

      // when
      emit("message.updated", {
        info: { id: "msg_no_usage", sessionID, role: "assistant", finish: "tool-calls", tokens: EMPTY_TOKENS },
      })

      // then
      expect(state.consecutiveProviderFailures).toBe(0)
    })

    test("#given assistant parts without content #when they update #then the streak is preserved", () => {
      // given
      const sessionID = "ses_streak_contentless_parts"
      const state = armAcceptedContinuation(sessionID)
      const info = { sessionID, role: "assistant" }

      // when
      emit("message.part.updated", { sessionID, info, part: { type: "step-start", messageID: "msg_a" } })
      emit("message.part.updated", { sessionID, info, part: { type: "text", text: "   ", messageID: "msg_a" } })
      emit("message.part.updated", { sessionID, info, part: { type: "text", text: "internal wake", synthetic: true, messageID: "msg_a" } })
      emit("message.part.updated", { sessionID, info, part: { type: "reasoning", text: "", messageID: "msg_a" } })
      emit("message.part.updated", { sessionID, info })
      emit("message.part.delta", { sessionID, info, delta: "" })

      // then
      expect(state.consecutiveProviderFailures).toBe(STREAK)
    })

    test.each([
      ["text", { type: "text", text: "working on it" }],
      ["reasoning", { type: "reasoning", text: "thinking about the next step" }],
      ["tool", { type: "tool", tool: "bash", callID: "call_1" }],
    ])("#given an assistant %s part #when it updates #then the streak resets", (partName, part) => {
      // given
      const sessionID = `ses_streak_part_${partName}`
      const state = armAcceptedContinuation(sessionID)

      // when
      emit("message.part.updated", { sessionID, info: { sessionID, role: "assistant" }, part: { ...part, messageID: "msg_a" } })

      // then
      expect(state.consecutiveProviderFailures).toBe(0)
      expect(state.continuationResponseObserved).toBe(true)
    })

    test("#given a non-empty assistant text delta #when it arrives #then the streak resets", () => {
      // given
      const sessionID = "ses_streak_text_delta"
      const state = armAcceptedContinuation(sessionID)

      // when
      emit("message.part.delta", { sessionID, info: { sessionID, role: "assistant" }, delta: "partial answer" })

      // then
      expect(state.consecutiveProviderFailures).toBe(0)
    })

    test("#given split assistant events #when the empty message precedes real parts #then only the real part resets the streak", () => {
      // given
      const sessionID = "ses_streak_split_events"
      const state = armAcceptedContinuation(sessionID)
      const info = { id: "msg_split", sessionID, role: "assistant", tokens: EMPTY_TOKENS }

      // when
      emit("message.updated", { info })
      const afterEmptyMessage = state.consecutiveProviderFailures
      emit("message.part.updated", { sessionID, info, part: { type: "text", text: "real output", messageID: "msg_split" } })

      // then
      expect(afterEmptyMessage).toBe(STREAK)
      expect(state.consecutiveProviderFailures).toBe(0)
    })

    test("#given a tool execution after the continuation #when it finishes #then the streak still resets", () => {
      // given
      const sessionID = "ses_streak_tool_execution"
      const state = armAcceptedContinuation(sessionID)

      // when
      emit("tool.execute.after", { sessionID, tool: "bash" })

      // then
      expect(state.consecutiveProviderFailures).toBe(0)
    })

    test("#given another session #when it has real assistant progress #then this session streak is preserved", () => {
      // given
      const sessionID = "ses_streak_isolated"
      const otherSessionID = "ses_streak_isolated_other"
      const state = armAcceptedContinuation(sessionID)
      const otherState = armAcceptedContinuation(otherSessionID)

      // when
      emit("message.updated", {
        info: {
          id: "msg_other",
          sessionID: otherSessionID,
          role: "assistant",
          finish: "stop",
          tokens: { input: 1, output: 9, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      })
      emit("message.updated", {
        info: { id: "msg_empty", sessionID, role: "assistant", finish: "unknown", tokens: EMPTY_TOKENS },
      })

      // then
      expect(otherState.consecutiveProviderFailures).toBe(0)
      expect(state.consecutiveProviderFailures).toBe(STREAK)
    })

    test("#given a real user message after the continuation #when it arrives #then the genuine interruption still resets the streak", () => {
      // given
      const sessionID = "ses_streak_user_interruption"
      const state = armAcceptedContinuation(sessionID)

      // when
      emit("message.updated", { sessionID, info: { role: "user" }, parts: [{ type: "text", text: "stop and look at this" }] })

      // then
      expect(state.continuationBlockReason).toBe("user-interruption")
      expect(state.consecutiveProviderFailures).toBe(0)
    })
  })
})
