/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OhMyOpenCodeConfigSchema } from "../../config"
import { executeCompact } from "./executor"
import type { AutoCompactState } from "./types"
import type { Client } from "./client"
import * as recoveryStrategy from "./recovery-strategy"
import * as messagesReader from "./storage/messages-reader"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

type MockClient = {
  session: {
    status: ReturnType<typeof mock>
    messages: ReturnType<typeof mock>
    summarize: ReturnType<typeof mock>
    revert: ReturnType<typeof mock>
    promptAsync: ReturnType<typeof mock>
  }
  tui: { showToast: ReturnType<typeof mock> }
}

const asClient = (client: MockClient): Client => unsafeTestValue<Client>(client)

type TimerCallback = (...args: unknown[]) => void

interface FakeTimeouts {
  advanceBy: (ms: number) => Promise<void>
  restore: () => void
}

// Capture the real implementations at module load time, before any test can patch them.
// This ensures restore() always returns to the true originals regardless of test execution order.
const TRUE_ORIGINAL_SET_TIMEOUT = globalThis.setTimeout
const TRUE_ORIGINAL_CLEAR_TIMEOUT = globalThis.clearTimeout

function createFakeTimeouts(): FakeTimeouts {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { id: number; time: number; callback: TimerCallback; args: unknown[] }>()
  const cleared = new Set<number>()

  const normalizeDelay = (delay?: number) => {
    if (typeof delay !== "number" || !Number.isFinite(delay)) return 0
    return delay < 0 ? 0 : delay
  }

  globalThis.setTimeout = ((callback: TimerCallback, delay?: number, ...args: unknown[]) => {
    const id = nextId++
    timers.set(id, {
      id,
      time: now + normalizeDelay(delay),
      callback,
      args,
    })
    return unsafeTestValue<ReturnType<typeof setTimeout>>(id)
  }) as typeof setTimeout

  globalThis.clearTimeout = ((id?: number) => {
    if (typeof id !== "number") return
    cleared.add(id)
    timers.delete(id)
  }) as typeof clearTimeout

  const advanceBy = async (ms: number) => {
    const target = now + Math.max(0, ms)
    while (true) {
      let next: { id: number; time: number; callback: TimerCallback; args: unknown[] } | undefined
      for (const timer of timers.values()) {
        if (timer.time <= target && (!next || timer.time < next.time)) {
          next = timer
        }
      }
      if (!next) break

      now = next.time
      timers.delete(next.id)
      if (!cleared.has(next.id)) {
        next.callback(...next.args)
      }
      cleared.delete(next.id)
      await Promise.resolve()
    }
    now = target
    await Promise.resolve()
  }

  const restore = () => {
    globalThis.setTimeout = TRUE_ORIGINAL_SET_TIMEOUT
    globalThis.clearTimeout = TRUE_ORIGINAL_CLEAR_TIMEOUT
  }

  return { advanceBy, restore }
}

describe("executeCompact lock management", () => {
  let autoCompactState: AutoCompactState
  let mockClient: MockClient
  let fakeTimeouts: FakeTimeouts
  let pluginConfig: ReturnType<typeof OhMyOpenCodeConfigSchema.parse>
  const sessionID = "test-session-123"
  const directory = "/test/dir"
  const msg = { providerID: "anthropic", modelID: "claude-opus-4-7" }

  beforeEach(() => {
    // given: Fresh state for each test
    autoCompactState = {
      pendingCompact: new Set<string>([sessionID]),
      errorDataBySession: new Map(),
      retryStateBySession: new Map(),
      retryTimerBySession: new Map(),
      truncateStateBySession: new Map(),
      emptyContentAttemptBySession: new Map(),
      compactionInProgress: new Set<string>(),
    }

    mockClient = {
      session: {
        status: mock(() => Promise.resolve({ data: { [sessionID]: { type: "idle" } } })),
        messages: mock(() => Promise.resolve({ data: [] })),
        summarize: mock(() => Promise.resolve()),
        revert: mock(() => Promise.resolve()),
        promptAsync: mock(() => Promise.resolve()),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    }

    pluginConfig = OhMyOpenCodeConfigSchema.parse({})
    fakeTimeouts = createFakeTimeouts()
  })

  afterEach(() => {
    fakeTimeouts.restore()
  })

  test("clears lock on successful summarize completion", async () => {
    // given: Valid session with providerID/modelID
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction successfully
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    expect(mockClient.session.summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: sessionID },
        body: { providerID: "anthropic", modelID: "claude-opus-4-7", auto: true },
      }),
    )

    // then: Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("does not start summarize recovery while the original session loop is still busy", async () => {
    // given: OpenCode is still processing the context-overflow turn
    mockClient.session.status = mock(() => Promise.resolve({ data: { [sessionID]: { type: "busy" } } }))
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit_exceeded_unknown",
      currentTokens: 0,
      maxTokens: 0,
    })

    // when: The delayed auto-compact callback fires before OpenCode reaches idle
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    // then: OMO leaves recovery pending for the real session.idle event instead of racing summarize
    expect(mockClient.session.summarize).not.toHaveBeenCalled()
    expect(autoCompactState.pendingCompact.has(sessionID)).toBe(true)
    expect(autoCompactState.errorDataBySession.has(sessionID)).toBe(true)
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when summarize throws exception", async () => {
    // given: Summarize will fail
    mockClient.session.summarize = mock(() =>
      Promise.reject(new Error("Network timeout")),
    )
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    expect(mockClient.session.summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: sessionID },
        body: { providerID: "anthropic", modelID: "claude-opus-4-7", auto: true },
      }),
    )

    // then: Lock should still be cleared despite exception
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("shows toast when lock already held", async () => {
    // given: Lock already held
    autoCompactState.compactionInProgress.add(sessionID)

    // when: Try to execute compaction
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    // then: Toast should be shown with warning message
    expect(mockClient.tui.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          title: "Compact In Progress",
          message: expect.stringContaining("Recovery already running"),
          variant: "warning",
        }),
      }),
    )

    // then: compactionInProgress should still have the lock
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(true)
  })

  test("clears lock when fixEmptyMessages path executes", async () => {
    //#given - Empty content error scenario with no messages in storage
    const readMessagesSpy = spyOn(messagesReader, "readMessages").mockReturnValue([])
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "non-empty content required",
      messageIndex: 0,
      currentTokens: 100000,
      maxTokens: 200000,
    })

    //#when - Execute compaction (fixEmptyMessages will be called)
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    //#then - Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
    readMessagesSpy.mockRestore()
  })

  test("clears lock when truncation is sufficient", async () => {
    //#given - Aggressive truncation scenario with no messages in storage
    const readMessagesSpy = spyOn(messagesReader, "readMessages").mockReturnValue([])
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 250000,
      maxTokens: 200000,
    })

    const experimental = {
      truncate_all_tool_outputs: false,
      aggressive_truncation: true,
    }

    //#when - Execute compaction with experimental flag
    await executeCompact(
      sessionID,
      msg,
      autoCompactState,
      asClient(mockClient),
      directory,
      pluginConfig,
      experimental,
    )

    //#then - Lock should be cleared even on early return
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
    readMessagesSpy.mockRestore()
  })

  test("prevents concurrent compaction attempts", async () => {
    // given: Lock already held (simpler test)
    autoCompactState.compactionInProgress.add(sessionID)

    // when: Try to execute compaction while lock is held
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    // then: Toast should be shown
    const toastCalls = mockClient.tui.showToast.mock.calls
    const blockedToast = toastCalls.find(
      (call) => call[0]?.body?.title === "Compact In Progress",
    )
    expect(blockedToast).toBeDefined()

    // then: Lock should still be held (not cleared by blocked attempt)
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(true)
  })

  test("clears lock after max recovery attempts exhausted", async () => {
    // given: All retry/revert attempts exhausted
    mockClient.session.messages = mock(() => Promise.resolve({ data: [] }))

    // Max out all attempts
    autoCompactState.retryStateBySession.set(sessionID, {
      attempt: 5,
      lastAttemptTime: Date.now(),
      firstAttemptTime: Date.now(),
    })
    autoCompactState.truncateStateBySession.set(sessionID, {
      truncateAttempt: 5,
    })
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    // then: Should show failure toast
    const toastCalls = mockClient.tui.showToast.mock.calls
    const failureToast = toastCalls.find(
      (call) => call[0]?.body?.title === "Auto Compact Failed",
    )
    expect(failureToast).toBeDefined()

    // then: Lock should still be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when client.tui.showToast throws", async () => {
    // given: Toast will fail (this should never happen but testing robustness)
    mockClient.tui.showToast = mock(() =>
      Promise.reject(new Error("Toast failed")),
    )
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    // then: Lock should be cleared even if toast fails
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when promptAsync in continuation throws", async () => {
    // given: promptAsync will fail during continuation
    mockClient.session.promptAsync = mock(() =>
      Promise.reject(new Error("Prompt failed")),
    )
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    // Wait for setTimeout callback
    await fakeTimeouts.advanceBy(600)

    // then: Lock should be cleared
    // The continuation happens in setTimeout, but lock is cleared in finally before that
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("falls through to summarize when truncation is insufficient", async () => {
    // given: Over token limit with truncation returning insufficient, aggressive truncation opted in
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 250000,
      maxTokens: 200000,
    })

    const truncateSpy = spyOn(
      recoveryStrategy,
      "runAggressiveTruncationStrategy",
    ).mockImplementation(async (params) => ({
      handled: false,
      nextTruncateAttempt: params.truncateAttempt + 1,
    }))

    const experimental = {
      aggressive_truncation: true,
    }

    // when: Execute compaction with aggressive truncation enabled
    await executeCompact(
      sessionID,
      msg,
      autoCompactState,
      asClient(mockClient),
      directory,
      pluginConfig,
      experimental,
    )

    // then: Truncation was attempted
    expect(truncateSpy).toHaveBeenCalled()

    // then: Summarize should be called (fall through from insufficient truncation)
    expect(mockClient.session.summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: sessionID },
        body: { providerID: "anthropic", modelID: "claude-opus-4-7", auto: true },
      }),
    )

    // then: Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)

    truncateSpy.mockRestore()
  })

  test("does NOT run aggressive truncation when experimental.aggressive_truncation is not enabled (#3899)", async () => {
    //#given - Over token limit but experimental.aggressive_truncation is undefined (default)
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 250000,
      maxTokens: 200000,
    })

    const truncateSpy = spyOn(
      recoveryStrategy,
      "runAggressiveTruncationStrategy",
    ).mockImplementation(async (params) => ({
      handled: false,
      nextTruncateAttempt: params.truncateAttempt + 1,
    }))

    //#when - Execute compaction without experimental config (default behavior)
    await executeCompact(sessionID, msg, autoCompactState, asClient(mockClient), directory, pluginConfig)

    //#then - Aggressive truncation must be skipped per docs (defaults false)
    expect(truncateSpy).not.toHaveBeenCalled()

    //#and - Summarize should still run as the primary recovery path
    expect(mockClient.session.summarize).toHaveBeenCalled()

    truncateSpy.mockRestore()
  })

  test("does NOT run aggressive truncation when experimental.aggressive_truncation is explicitly false (#3899)", async () => {
    //#given - Over token limit with experimental flag explicitly false
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 250000,
      maxTokens: 200000,
    })

    const truncateSpy = spyOn(
      recoveryStrategy,
      "runAggressiveTruncationStrategy",
    ).mockImplementation(async (params) => ({
      handled: false,
      nextTruncateAttempt: params.truncateAttempt + 1,
    }))

    const experimental = {
      aggressive_truncation: false,
    }

    //#when - Execute compaction with explicit false
    await executeCompact(
      sessionID,
      msg,
      autoCompactState,
      asClient(mockClient),
      directory,
      pluginConfig,
      experimental,
    )

    //#then - Aggressive truncation must be skipped
    expect(truncateSpy).not.toHaveBeenCalled()

    //#and - Summarize should run
    expect(mockClient.session.summarize).toHaveBeenCalled()

    truncateSpy.mockRestore()
  })

  test("does NOT call summarize when truncation is sufficient", async () => {
    // given: Over token limit with truncation returning sufficient, aggressive truncation opted in
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 250000,
      maxTokens: 200000,
    })

    const truncateSpy = spyOn(
      recoveryStrategy,
      "runAggressiveTruncationStrategy",
    ).mockImplementation(async (params) => {
      setTimeout(() => {
        void params.client.session
          .promptAsync({
            path: { id: params.sessionID },
            body: { auto: true } as never,
            query: { directory: params.directory },
          })
          .catch(() => {})
      }, 500)

      return {
        handled: true,
        nextTruncateAttempt: params.truncateAttempt + 1,
      }
    })

    const experimental = {
      aggressive_truncation: true,
    }

    // when: Execute compaction with aggressive truncation enabled
    await executeCompact(
      sessionID,
      msg,
      autoCompactState,
      asClient(mockClient),
      directory,
      pluginConfig,
      experimental,
    )

    // Wait for setTimeout callback
    await fakeTimeouts.advanceBy(600)

    // then: Truncation was attempted
    expect(truncateSpy).toHaveBeenCalled()

    // then: Summarize should NOT be called (early return from sufficient truncation)
    expect(mockClient.session.summarize).not.toHaveBeenCalled()

    // then: promptAsync should be called (Continue after successful truncation)
    expect(mockClient.session.promptAsync).toHaveBeenCalled()

    // then: Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)

    truncateSpy.mockRestore()
  })
})
