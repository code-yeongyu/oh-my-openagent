/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { AutoCompactState } from "./types"

type PromptAsyncCall = {
  path: { id: string }
  body: {
    auto?: boolean
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
    tools?: Record<string, boolean>
    parts?: unknown
  }
  query: { directory: string }
}

const truncateUntilTargetTokensMock = mock(async () => ({
  truncatedCount: 1,
  totalBytesRemoved: 1000,
  truncatedTools: [{ toolName: "bash" }],
  sufficient: true,
}))

mock.module("./storage", () => ({
  truncateUntilTargetTokens: truncateUntilTargetTokensMock,
}))

const findNearestMessageWithFieldsFromSDKMock = mock(async () => null)
const findNearestMessageWithFieldsMock = mock(() => null)

mock.module("../../features/hook-message-injector", () => ({
  findNearestMessageWithFieldsFromSDK: findNearestMessageWithFieldsFromSDKMock,
  findNearestMessageWithFields: findNearestMessageWithFieldsMock,
}))

const sessionAgentMap = new Map<string, string>()
const resolveRegisteredAgentNameMock = mock((name: string | undefined) => name)

mock.module("../../features/claude-code-session-state/state", () => ({
  _resetForTesting: () => { sessionAgentMap.clear() },
  setSessionAgent: (sessionID: string, agent: string) => { sessionAgentMap.set(sessionID, agent) },
  getSessionAgent: (sessionID: string) => sessionAgentMap.get(sessionID),
  resolveRegisteredAgentName: resolveRegisteredAgentNameMock,
  registerAgentName: () => {},
  isAgentRegistered: () => false,
  resolveInheritedPromptTools: () => undefined,
}))

import { runAggressiveTruncationStrategy } from "./aggressive-truncation-strategy"

type FakeClient = {
  session: { promptAsync: (input: PromptAsyncCall) => Promise<unknown> }
  tui: { showToast: (input: unknown) => Promise<unknown> }
}

function createRecordingClient(): { client: FakeClient; calls: PromptAsyncCall[] } {
  const calls: PromptAsyncCall[] = []
  const client: FakeClient = {
    session: {
      promptAsync: async (input: PromptAsyncCall) => {
        calls.push(input)
        return undefined
      },
    },
    tui: {
      showToast: async () => undefined,
    },
  }
  return { client, calls }
}

function createAutoCompactState(): AutoCompactState {
  return {
    pendingCompact: new Set<string>(),
    errorDataBySession: new Map(),
    retryStateBySession: new Map(),
    retryTimerBySession: new Map(),
    truncateStateBySession: new Map(),
    emptyContentAttemptBySession: new Map(),
    compactionInProgress: new Set<string>(),
  }
}

async function flushDeferredPrompt(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600))
}

describe("runAggressiveTruncationStrategy - pins agent/model/variant on recovered promptAsync", () => {
  beforeEach(() => {
    sessionAgentMap.clear()
    truncateUntilTargetTokensMock.mockClear()
    findNearestMessageWithFieldsFromSDKMock.mockClear()
    findNearestMessageWithFieldsMock.mockClear()
    resolveRegisteredAgentNameMock.mockClear()
    findNearestMessageWithFieldsFromSDKMock.mockResolvedValue(null)
    findNearestMessageWithFieldsMock.mockReturnValue(null)
    resolveRegisteredAgentNameMock.mockImplementation((name: string | undefined) => name)
  })

  afterEach(() => {
    sessionAgentMap.clear()
  })

  test("includes the session's resolved agent on promptAsync when agent is known", async () => {
    // given
    const { client, calls } = createRecordingClient()
    const sessionID = "session-truncation-agent"
    sessionAgentMap.set(sessionID, "sisyphus-junior")

    // when
    await runAggressiveTruncationStrategy({
      sessionID,
      autoCompactState: createAutoCompactState(),
      client: client as never,
      directory: "/tmp/test-truncation",
      truncateAttempt: 0,
      currentTokens: 250_000,
      maxTokens: 200_000,
    })
    await flushDeferredPrompt()

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0].path.id).toBe(sessionID)
    expect(calls[0].body.agent).toBe("sisyphus-junior")
    expect(calls[0].body.auto).toBe(true)
  })

  test("pins provider/model/variant resolved from the nearest prior assistant message", async () => {
    // given
    const { client, calls } = createRecordingClient()
    const sessionID = "session-truncation-model"
    findNearestMessageWithFieldsFromSDKMock.mockResolvedValue({
      agent: "atlas",
      model: { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "high" },
      tools: undefined,
    } as never)
    findNearestMessageWithFieldsMock.mockReturnValue({
      agent: "atlas",
      model: { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "high" },
      tools: undefined,
    } as never)

    // when
    await runAggressiveTruncationStrategy({
      sessionID,
      autoCompactState: createAutoCompactState(),
      client: client as never,
      directory: "/tmp/test-truncation",
      truncateAttempt: 0,
      currentTokens: 250_000,
      maxTokens: 200_000,
    })
    await flushDeferredPrompt()

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0].body.agent).toBe("atlas")
    expect(calls[0].body.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
    expect(calls[0].body.variant).toBe("high")
    expect(calls[0].body.auto).toBe(true)
  })

  test("omits agent/model/variant when the session has nothing resolvable", async () => {
    // given
    const { client, calls } = createRecordingClient()
    const sessionID = "session-truncation-empty"

    // when
    await runAggressiveTruncationStrategy({
      sessionID,
      autoCompactState: createAutoCompactState(),
      client: client as never,
      directory: "/tmp/test-truncation",
      truncateAttempt: 0,
      currentTokens: 250_000,
      maxTokens: 200_000,
    })
    await flushDeferredPrompt()

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0].body.agent).toBeUndefined()
    expect(calls[0].body.model).toBeUndefined()
    expect(calls[0].body.variant).toBeUndefined()
    expect(calls[0].body.auto).toBe(true)
  })
})
