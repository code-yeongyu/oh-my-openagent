declare module "bun:test" {
  export interface Matchers {
    toBeDefined(): void
    toBeUndefined(): void
    toHaveLength(expected: number): void
  }
}

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test"

import * as actualSessionStateModule from "./session-state"
import type { SessionStateStore } from "./session-state"

let createdSessionStateStore: SessionStateStore | undefined
const createActualSessionStateStore = actualSessionStateModule.createSessionStateStore

const mockModule = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void
}

mockModule.module("./session-state", () => ({
  ...actualSessionStateModule,
  createSessionStateStore: () => {
    const sessionStateStore = createActualSessionStateStore()
    createdSessionStateStore = sessionStateStore
    return sessionStateStore
  },
}))

const { createTodoContinuationEnforcer } = await import(".")

type PluginInput = Parameters<typeof createTodoContinuationEnforcer>[0]

function createMockPluginInput(): PluginInput {
  return {
    directory: "/tmp/test",
  } as PluginInput
}

function getCreatedSessionStateStore(): SessionStateStore {
  if (!createdSessionStateStore) {
    throw new Error("expected session state store to be created")
  }

  return createdSessionStateStore
}

describe("todo-continuation-enforcer dispose", () => {
  afterEach(() => {
    createdSessionStateStore?.shutdown()
    createdSessionStateStore = undefined
  })

  afterAll(() => {
    mockModule.module("./session-state", () => actualSessionStateModule)
  })

  it("#given todo-continuation-enforcer created #when dispose exists on return value #then it is a function", () => {
    // given
    const enforcer = createTodoContinuationEnforcer(createMockPluginInput())

    // when
    const { dispose } = enforcer

    // then
    expect(typeof dispose).toBe("function")

    enforcer.dispose()
  })

  it("#given enforcer with active session states #when dispose is called #then internal session state store is shut down", () => {
    // given
    const originalClearInterval = globalThis.clearInterval
    const clearIntervalCalls: Array<Parameters<typeof clearInterval>[0]> = []
    globalThis.clearInterval = ((timer?: Parameters<typeof clearInterval>[0]) => {
      clearIntervalCalls.push(timer)
      return originalClearInterval(timer)
    }) as typeof clearInterval

    try {
      const enforcer = createTodoContinuationEnforcer(createMockPluginInput())
      const sessionStateStore = getCreatedSessionStateStore()

      enforcer.markRecovering("session-1")
      enforcer.markRecovering("session-2")

      expect(sessionStateStore.getExistingState("session-1")).toBeDefined()
      expect(sessionStateStore.getExistingState("session-2")).toBeDefined()

      // when
      enforcer.dispose()

      // then
      expect(clearIntervalCalls).toHaveLength(1)
      expect(sessionStateStore.getExistingState("session-1")).toBeUndefined()
      expect(sessionStateStore.getExistingState("session-2")).toBeUndefined()
    } finally {
      globalThis.clearInterval = originalClearInterval
    }
  })
})
