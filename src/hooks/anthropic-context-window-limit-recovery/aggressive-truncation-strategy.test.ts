/// <reference types="bun-types" />
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { preserveModuleMocksForTestFile, restoreModuleMocksForTestFile } from "../../testing/module-mock-lifecycle"
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

preserveModuleMocksForTestFile(import.meta.url)

import { _resetForTesting as resetSessionState, updateSessionAgent } from "../../features/claude-code-session-state/state"
import { runAggressiveTruncationStrategy } from "./aggressive-truncation-strategy"

type FakeClient = {
  session: {
    promptAsync: (input: PromptAsyncCall) => Promise<unknown>
    messages: () => Promise<{ data: readonly FakeSDKMessage[] }>
    status?: () => Promise<unknown>
  }
  tui: { showToast: (input: unknown) => Promise<unknown> }
}

type FakeSDKMessage = {
  readonly id: string
  readonly info: {
    readonly agent?: string
    readonly model?: { readonly providerID?: string; readonly modelID?: string; readonly variant?: string }
    readonly time: { readonly created: number }
  }
}

function createRecordingClient(params: {
  readonly messages?: readonly FakeSDKMessage[]
  readonly status?: () => Promise<unknown>
} = {}): { client: FakeClient; calls: PromptAsyncCall[] } {
  const calls: PromptAsyncCall[] = []
  const client: FakeClient = {
    session: {
      messages: async () => ({ data: params.messages ?? [] }),
      promptAsync: async (input: PromptAsyncCall) => {
        calls.push(input)
        return undefined
      },
      ...(params.status ? { status: params.status } : {}),
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
    resetSessionState()
    truncateUntilTargetTokensMock.mockClear()
  })

  afterEach(() => {
    resetSessionState()
  })

  afterAll(() => {
    restoreModuleMocksForTestFile(import.meta.url)
  })

  test("includes the session's resolved agent on promptAsync when agent is known", async () => {
    // given
    const { client, calls } = createRecordingClient()
    const sessionID = "session-truncation-agent"
    updateSessionAgent(sessionID, "sisyphus-junior")

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
    const { client, calls } = createRecordingClient({
      messages: [{
        id: "msg_1",
        info: {
          agent: "atlas",
          model: { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "high" },
          time: { created: 1 },
        },
      }],
    })
    const sessionID = "session-truncation-model"

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

  test("does not send the delayed auto prompt when the session becomes active before recovery fires", async () => {
    // given
    const sessionID = "session-truncation-active"
    const { client, calls } = createRecordingClient({
      status: async () => ({
        [sessionID]: { type: "busy" },
      }),
    })

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
    expect(calls).toHaveLength(0)
  })
})
