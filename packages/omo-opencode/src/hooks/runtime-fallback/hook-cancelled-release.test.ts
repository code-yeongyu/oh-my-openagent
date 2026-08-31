import { describe, expect, test } from "bun:test"
import { createRuntimeFallbackHook } from "./hook"
import { DEFAULT_CONFIG } from "./constants"
import type { AutoRetryHelpers } from "./auto-retry"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

type CapturedEvent = { type: string; properties?: unknown }

function createInertHelpers(): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => {},
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => {},
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

function createTestContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({}),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test",
  }
}

describe("runtime fallback hook message.updated routing", () => {
  test("#given a user message.updated event reaches the hook #when the hook routes the event #then both the message-update handler and the base event handler receive it", async () => {
    // given
    const baseEvents: CapturedEvent[] = []
    const messageUpdateProps: unknown[] = []
    const sessionID = "session-hook-message-routing"
    const properties = { sessionID, info: { role: "user" } }
    const hook = createRuntimeFallbackHook(
      createTestContext(),
      { config: { ...DEFAULT_CONFIG, enabled: true } },
      {
        createAutoRetryHelpers: (_deps: HookDeps) => createInertHelpers(),
        createEventHandler: (_deps: HookDeps, _helpers: AutoRetryHelpers) =>
          async ({ event }: { event: CapturedEvent }) => {
            baseEvents.push(event)
          },
        createMessageUpdateHandler: (_deps: HookDeps, _helpers: AutoRetryHelpers) =>
          async (props: unknown) => {
            messageUpdateProps.push(props)
          },
      },
    )

    // when
    await hook.event({ event: { type: "message.updated", properties } })

    // then
    expect(messageUpdateProps).toEqual([properties])
    expect(baseEvents).toEqual([{ type: "message.updated", properties }])
    hook.dispose()
  })

  test("#given a session.error event reaches the hook #when the hook routes the event #then only the base event handler receives it", async () => {
    // given
    const baseEvents: CapturedEvent[] = []
    const messageUpdateProps: unknown[] = []
    const hook = createRuntimeFallbackHook(
      createTestContext(),
      { config: { ...DEFAULT_CONFIG, enabled: true } },
      {
        createAutoRetryHelpers: (_deps: HookDeps) => createInertHelpers(),
        createEventHandler: (_deps: HookDeps, _helpers: AutoRetryHelpers) =>
          async ({ event }: { event: CapturedEvent }) => {
            baseEvents.push(event)
          },
        createMessageUpdateHandler: (_deps: HookDeps, _helpers: AutoRetryHelpers) =>
          async (props: unknown) => {
            messageUpdateProps.push(props)
          },
      },
    )

    // when
    await hook.event({
      event: { type: "session.error", properties: { sessionID: "session-hook-error-routing", error: { name: "MessageAbortedError" } } },
    })

    // then
    expect(messageUpdateProps).toEqual([])
    expect(baseEvents).toHaveLength(1)
    expect(baseEvents[0]?.type).toBe("session.error")
    hook.dispose()
  })
})
