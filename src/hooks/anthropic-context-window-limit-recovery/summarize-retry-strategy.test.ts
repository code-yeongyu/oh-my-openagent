import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { runSummarizeRetryStrategy } from "./summarize-retry-strategy"
import type { AutoCompactState, ParsedTokenLimitError, RetryState } from "./types"
import type { OhMyOpenCodeConfig } from "../../config"

type TimeoutCall = {
  handle: ReturnType<typeof setTimeout>
  delay: number
}

function createAutoCompactState(): AutoCompactState {
  return {
    pendingCompact: new Set<string>(),
    errorDataBySession: new Map<string, ParsedTokenLimitError>(),
    retryStateBySession: new Map<string, RetryState>(),
    retryTimerBySession: new Map(),
    truncateStateBySession: new Map(),
    emptyContentAttemptBySession: new Map(),
    compactionInProgress: new Set<string>(),
  }
}

describe("runSummarizeRetryStrategy", () => {
  const sessionID = "ses_retry_timeout"
  const directory = "/tmp"
  let autoCompactState: AutoCompactState

  const summarizeMock = mock(() => Promise.resolve())
  const showToastMock = mock(() => Promise.resolve())
  const client = {
    session: {
      summarize: summarizeMock,
      messages: mock(() => Promise.resolve({ data: [] })),
      promptAsync: mock(() => Promise.resolve()),
      revert: mock(() => Promise.resolve()),
    },
    tui: {
      showToast: showToastMock,
    },
  }

  beforeEach(() => {
    autoCompactState = createAutoCompactState()
    summarizeMock.mockReset()
    showToastMock.mockReset()
    summarizeMock.mockResolvedValue(undefined)
    showToastMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout
  })

  const originalSetTimeout = globalThis.setTimeout

  test("stops retries when total summarize timeout is exceeded", async () => {
    //#given
    autoCompactState.pendingCompact.add(sessionID)
    autoCompactState.errorDataBySession.set(sessionID, {
      currentTokens: 250000,
      maxTokens: 200000,
      errorType: "token_limit_exceeded",
    })
    autoCompactState.retryStateBySession.set(sessionID, {
      attempt: 1,
      lastAttemptTime: Date.now(),
      firstAttemptTime: Date.now() - 130000,
    })

    //#when
    await runSummarizeRetryStrategy({
      sessionID,
      msg: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      autoCompactState,
      client: client as never,
      directory,
      pluginConfig: {} as OhMyOpenCodeConfig,
    })

    //#then
    expect(summarizeMock).not.toHaveBeenCalled()
    expect(autoCompactState.pendingCompact.has(sessionID)).toBe(false)
    expect(autoCompactState.errorDataBySession.has(sessionID)).toBe(false)
    expect(autoCompactState.retryStateBySession.has(sessionID)).toBe(false)
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          title: "Auto Compact Timed Out",
        }),
      }),
    )
  })

  test("caps retry delay by remaining total timeout window", async () => {
    //#given
    const timeoutCalls: TimeoutCall[] = []
    globalThis.setTimeout = ((_: (...args: unknown[]) => void, delay?: number) => {
      const handle = timeoutCalls.length + 1 as unknown as ReturnType<typeof setTimeout>
      timeoutCalls.push({ handle, delay: delay ?? 0 })
      return handle
    }) as typeof setTimeout

    autoCompactState.pendingCompact.add(sessionID)
    autoCompactState.retryStateBySession.set(sessionID, {
      attempt: 0,
      lastAttemptTime: Date.now(),
      firstAttemptTime: Date.now() - 100000,
    })
    summarizeMock.mockRejectedValueOnce(new Error("rate limited"))

    //#when
    await runSummarizeRetryStrategy({
      sessionID,
      msg: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      autoCompactState,
      client: client as never,
      directory,
      pluginConfig: {} as OhMyOpenCodeConfig,
    })

    //#then
    const retryTimer = autoCompactState.retryTimerBySession.get(sessionID)
    const retryTimeoutCall = timeoutCalls.find(({ handle }) => handle === retryTimer)

    expect(retryTimeoutCall).toBeDefined()
    expect(retryTimeoutCall?.delay).toBeGreaterThan(0)
    expect(retryTimeoutCall?.delay).toBeLessThanOrEqual(2000)
  })

  test("#given pending retry timer after session cleanup #when scheduled callback fires #then it does not recreate retry state", async () => {
    //#given
    let scheduledCallback: (() => void) | undefined
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number) => {
      scheduledCallback = () => callback()
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout

    autoCompactState.pendingCompact.add(sessionID)
    summarizeMock.mockRejectedValueOnce(new Error("rate limited"))

    await runSummarizeRetryStrategy({
      sessionID,
      msg: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      autoCompactState,
      client: client as never,
      directory,
      pluginConfig: {} as OhMyOpenCodeConfig,
    })

    autoCompactState.pendingCompact.delete(sessionID)
    autoCompactState.retryStateBySession.delete(sessionID)

    //#when
    scheduledCallback?.()

    //#then
    expect(autoCompactState.retryStateBySession.has(sessionID)).toBe(false)
  })

  test("#given max empty-content recovery attempts reached #when summarize retry exits early #then it clears full recovery state", async () => {
    //#given
    autoCompactState.pendingCompact.add(sessionID)
    autoCompactState.errorDataBySession.set(sessionID, {
      currentTokens: 250000,
      maxTokens: 200000,
      errorType: "non-empty content",
    })
    autoCompactState.retryStateBySession.set(sessionID, {
      attempt: 1,
      lastAttemptTime: Date.now(),
      firstAttemptTime: Date.now(),
    })
    autoCompactState.truncateStateBySession.set(sessionID, {
      truncateAttempt: 2,
    })
    autoCompactState.emptyContentAttemptBySession.set(sessionID, 3)
    autoCompactState.retryTimerBySession.set(
      sessionID,
      1 as unknown as ReturnType<typeof setTimeout>,
    )

    //#when
    await runSummarizeRetryStrategy({
      sessionID,
      msg: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      autoCompactState,
      client: client as never,
      directory,
      pluginConfig: {} as OhMyOpenCodeConfig,
      errorType: "non-empty content",
    })

    //#then
    expect(autoCompactState.pendingCompact.has(sessionID)).toBe(false)
    expect(autoCompactState.errorDataBySession.has(sessionID)).toBe(false)
    expect(autoCompactState.retryStateBySession.has(sessionID)).toBe(false)
    expect(autoCompactState.retryTimerBySession.has(sessionID)).toBe(false)
    expect(autoCompactState.truncateStateBySession.has(sessionID)).toBe(false)
    expect(autoCompactState.emptyContentAttemptBySession.has(sessionID)).toBe(false)
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          title: "Recovery Failed",
        }),
      }),
    )
  })
})
