import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

let capturedDeps: HookDeps | undefined

const mockCreateAutoRetryHelpers = mock((deps: HookDeps) => {
  capturedDeps = deps

  return {
    abortSessionRequest: async () => {},
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => {},
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
})

const mockCreateEventHandler = mock(() => async () => {})
const mockCreateMessageUpdateHandler = mock(() => async () => {})
const mockCreateChatMessageHandler = mock(() => async () => {})

mock.module("./auto-retry", () => ({
  createAutoRetryHelpers: mockCreateAutoRetryHelpers,
}))

mock.module("./event-handler", () => ({
  createEventHandler: mockCreateEventHandler,
}))

mock.module("./message-update-handler", () => ({
  createMessageUpdateHandler: mockCreateMessageUpdateHandler,
}))

mock.module("./chat-message-handler", () => ({
  createChatMessageHandler: mockCreateChatMessageHandler,
}))

afterAll(() => {
  mock.restore()
})

const { createRuntimeFallbackHook } = await import("./hook")

function createMockContext(): RuntimeFallbackPluginInput {
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

describe("createRuntimeFallbackHook dispose", () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const originalClearTimeout = globalThis.clearTimeout
  const createdIntervals: Array<ReturnType<typeof originalSetInterval>> = []
  const clearedIntervals: Array<Parameters<typeof originalClearInterval>[0]> = []
  const clearedTimeouts: Array<Parameters<typeof originalClearTimeout>[0]> = []
  const timeoutMapSizesDuringClear: number[] = []

  beforeEach(() => {
    capturedDeps = undefined
    createdIntervals.length = 0
    clearedIntervals.length = 0
    clearedTimeouts.length = 0
    timeoutMapSizesDuringClear.length = 0

    mockCreateAutoRetryHelpers.mockClear()
    mockCreateEventHandler.mockClear()
    mockCreateMessageUpdateHandler.mockClear()
    mockCreateChatMessageHandler.mockClear()

    const wrappedSetInterval = ((handler: () => void, timeout?: number) => {
      const interval = originalSetInterval(handler, timeout)
      createdIntervals.push(interval)
      return interval
    }) as typeof globalThis.setInterval

    const wrappedClearInterval = ((interval?: Parameters<typeof clearInterval>[0]) => {
      clearedIntervals.push(interval)
      return originalClearInterval(interval)
    }) as typeof globalThis.clearInterval

    const wrappedClearTimeout = ((timeout?: Parameters<typeof clearTimeout>[0]) => {
      timeoutMapSizesDuringClear.push(capturedDeps?.sessionFallbackTimeouts.size ?? -1)
      clearedTimeouts.push(timeout)
      return originalClearTimeout(timeout)
    }) as typeof globalThis.clearTimeout

    globalThis.setInterval = wrappedSetInterval
    globalThis.clearInterval = wrappedClearInterval
    globalThis.clearTimeout = wrappedClearTimeout
  })

  afterEach(() => {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    globalThis.clearTimeout = originalClearTimeout
  })

  test("#given runtime-fallback hook created #when dispose() is called #then cleanup interval is cleared", () => {
    // given
    const hook = createRuntimeFallbackHook(createMockContext(), { pluginConfig: {} })

    // when
    hook.dispose?.()

    // then
    expect(createdIntervals).toHaveLength(1)
    expect(clearedIntervals).toEqual([createdIntervals[0]])
  })

  test("#given hook with session state data #when dispose() is called #then all Maps and Sets are empty", () => {
    // given
    const hook = createRuntimeFallbackHook(createMockContext(), { pluginConfig: {} })
    const fallbackTimeout = setTimeout(() => {}, 60_000)

    capturedDeps?.sessionStates.set("session-1", {
      originalModel: "anthropic/claude-opus-4-6",
      currentModel: "openai/gpt-5.4",
      fallbackIndex: 1,
      failedModels: new Map([["anthropic/claude-opus-4-6", 1]]),
      attemptCount: 1,
    })
    capturedDeps?.sessionLastAccess.set("session-1", Date.now())
    capturedDeps?.sessionRetryInFlight.add("session-1")
    capturedDeps?.sessionAwaitingFallbackResult.add("session-1")
    capturedDeps?.sessionFallbackTimeouts.set("session-1", fallbackTimeout)

    // when
    hook.dispose?.()

    // then
    expect(capturedDeps?.sessionStates.size).toBe(0)
    expect(capturedDeps?.sessionLastAccess.size).toBe(0)
    expect(capturedDeps?.sessionRetryInFlight.size).toBe(0)
    expect(capturedDeps?.sessionAwaitingFallbackResult.size).toBe(0)
    expect(capturedDeps?.sessionFallbackTimeouts.size).toBe(0)
  })

  test("#given hook with pending fallback timeouts #when dispose() is called #then timeouts are cleared before Map is emptied", () => {
    // given
    const hook = createRuntimeFallbackHook(createMockContext(), { pluginConfig: {} })
    const fallbackTimeout = setTimeout(() => {}, 60_000)
    capturedDeps?.sessionFallbackTimeouts.set("session-1", fallbackTimeout)

    // when
    hook.dispose?.()

    // then
    expect(clearedTimeouts).toEqual([fallbackTimeout])
    expect(timeoutMapSizesDuringClear).toEqual([1])
    expect(capturedDeps?.sessionFallbackTimeouts.size).toBe(0)
  })
})
