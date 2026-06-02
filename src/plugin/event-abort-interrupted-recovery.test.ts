/// <reference path="../../bun-test.d.ts" />
import { afterEach, describe, expect, it, mock } from "bun:test"

import { _resetForTesting } from "../features/claude-code-session-state"
import { createEventHandler } from "./event"
import { unsafeTestValue } from "../../test-support/unsafe-test-value"

type EventInput = { readonly event: { readonly type: string; readonly properties?: unknown } }
type EventHandlerArgs = Parameters<typeof createEventHandler>[0]
type EventHandlerInput = Parameters<ReturnType<typeof createEventHandler>>[0]

function createHandler(callOrder: string[]): ReturnType<typeof createEventHandler> {
  return createEventHandler({
    ctx: unsafeTestValue<EventHandlerArgs["ctx"]>({
      directory: "/tmp",
      client: { session: {} },
    }),
    pluginConfig: unsafeTestValue<EventHandlerArgs["pluginConfig"]>({}),
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: unsafeTestValue<EventHandlerArgs["managers"]>({
      tmuxSessionManager: {
        onEvent: () => {},
        onSessionCreated: async () => {},
        onSessionDeleted: async () => {},
      },
      skillMcpManager: {
        disconnectSession: async () => {},
      },
    }),
    hooks: unsafeTestValue<EventHandlerArgs["hooks"]>({
      sessionRecovery: {
        isRecoverableError: () => false,
        handleInterruptedToolResultsOnIdle: async () => {
          callOrder.push("sessionRecovery")
          return true
        },
      },
      todoContinuationEnforcer: {
        handler: async (input: EventInput) => {
          if (input.event.type === "session.idle") {
            callOrder.push("todoContinuationEnforcer")
          }
        },
      },
    }),
  })
}

function toEventHandlerInput(input: EventInput): EventHandlerInput {
  return unsafeTestValue<EventHandlerInput>(input)
}

describe("createEventHandler user abort interrupted tool recovery", () => {
  afterEach(() => {
    mock.restore()
    _resetForTesting()
  })

  it("#given user abort before real idle #when interrupted tool recovery is available #then recovery is skipped and idle hooks still run", async () => {
    // given
    const callOrder: string[] = []
    const eventHandler = createHandler(callOrder)

    // when
    await eventHandler(toEventHandlerInput({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_user_abort_real_idle",
          error: { name: "MessageAbortedError", message: "User aborted" },
        },
      },
    }))
    await eventHandler(toEventHandlerInput({
      event: {
        type: "session.idle",
        properties: { sessionID: "ses_user_abort_real_idle" },
      },
    }))

    // then
    expect(callOrder).toEqual(["todoContinuationEnforcer"])
  })

  it("#given user abort before status idle #when interrupted tool recovery is available #then synthetic idle does not recover the cancelled turn", async () => {
    // given
    const callOrder: string[] = []
    const eventHandler = createHandler(callOrder)

    // when
    await eventHandler(toEventHandlerInput({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_user_abort_synthetic_idle",
          error: { name: "MessageAbortedError", message: "User aborted" },
        },
      },
    }))
    await eventHandler(toEventHandlerInput({
      event: {
        type: "session.status",
        properties: {
          sessionID: "ses_user_abort_synthetic_idle",
          status: { type: "idle" },
        },
      },
    }))

    // then
    expect(callOrder).toEqual(["todoContinuationEnforcer"])
  })

  it("#given assistant abort update before idle #when interrupted tool recovery is available #then recovery is skipped", async () => {
    // given
    const callOrder: string[] = []
    const eventHandler = createHandler(callOrder)

    // when
    await eventHandler(toEventHandlerInput({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "ses_user_abort_message_update",
          info: {
            id: "msg_aborted",
            role: "assistant",
            error: { name: "MessageAbortedError", message: "User aborted" },
          },
        },
      },
    }))
    await eventHandler(toEventHandlerInput({
      event: {
        type: "session.idle",
        properties: { sessionID: "ses_user_abort_message_update" },
      },
    }))

    // then
    expect(callOrder).toEqual(["todoContinuationEnforcer"])
  })
})
