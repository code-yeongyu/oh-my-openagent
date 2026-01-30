import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { executeCompact } from "./executor"
import type { AutoCompactState } from "./types"
import * as storage from "./storage"

type TimerCallback = (...args: any[]) => void

interface FakeTimeouts {
  advanceBy: (ms: number) => Promise<void>
  restore: () => void
}

function createFakeTimeouts(): FakeTimeouts {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { id: number; time: number; callback: TimerCallback; args: any[] }>()
  const cleared = new Set<number>()

  const original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  }

  const normalizeDelay = (delay?: number) => {
    if (typeof delay !== "number" || !Number.isFinite(delay)) return 0
    return delay < 0 ? 0 : delay
  }

  globalThis.setTimeout = ((callback: TimerCallback, delay?: number, ...args: any[]) => {
    const id = nextId++
    timers.set(id, {
      id,
      time: now + normalizeDelay(delay),
      callback,
      args,
    })
    return id as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  globalThis.clearTimeout = ((id?: number) => {
    if (typeof id !== "number") return
    cleared.add(id)
    timers.delete(id)
  }) as typeof clearTimeout

  const advanceBy = async (ms: number) => {
    const target = now + Math.max(0, ms)
    while (true) {
      let next: { id: number; time: number; callback: TimerCallback; args: any[] } | undefined
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
    globalThis.setTimeout = original.setTimeout
    globalThis.clearTimeout = original.clearTimeout
  }

  return { advanceBy, restore }
}

describe("executeCompact lock management", () => {
  let autoCompactState: AutoCompactState
  let mockClient: any
  let fakeTimeouts: FakeTimeouts
  const sessionID = "test-session-123"
  const directory = "/test/dir"
  const msg = { providerID: "anthropic", modelID: "claude-opus-4-5" }

  beforeEach(() => {
    // #given: Fresh state for each test
    autoCompactState = {
      pendingCompact: new Set<string>(),
      errorDataBySession: new Map(),
      retryStateBySession: new Map(),
      truncateStateBySession: new Map(),
      emptyContentAttemptBySession: new Map(),
      compactionInProgress: new Set<string>(),
    }

    mockClient = {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
        summarize: mock(() => Promise.resolve()),
        revert: mock(() => Promise.resolve()),
        prompt_async: mock(() => Promise.resolve()),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    }

    fakeTimeouts = createFakeTimeouts()
  })

  afterEach(() => {
    fakeTimeouts.restore()
  })

  test("clears lock on successful summarize completion", async () => {
    // #given: Valid session with providerID/modelID
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // #when: Execute compaction successfully
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // #then: Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when summarize throws exception", async () => {
    // #given: Summarize will fail
    mockClient.session.summarize = mock(() =>
      Promise.reject(new Error("Network timeout")),
    )
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // #when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // #then: Lock should still be cleared despite exception
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("shows toast when lock already held", async () => {
    // #given: Lock already held
    autoCompactState.compactionInProgress.add(sessionID)

    // #when: Try to execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // #then: Toast should be shown with warning message
    expect(mockClient.tui.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          title: "Compact In Progress",
          message: expect.stringContaining("Recovery already running"),
          variant: "warning",
        }),
      }),
    )

    // #then: compactionInProgress should still have the lock
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(true)
  })

  test("clears lock when fixEmptyMessages path executes", async () => {
    // #given: Empty content error scenario
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "non-empty content required",
      messageIndex: 0,
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // #when: Execute compaction (fixEmptyMessages will be called)
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // #then: Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when truncation is sufficient", async () => {
    // #given: Aggressive truncation scenario with sufficient truncation
    // This test verifies the early return path in aggressive truncation
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 250000,
      maxTokens: 200000,
    })

    const experimental = {
      truncate_all_tool_outputs: false,
      aggressive_truncation: true,
    }

    // #when: Execute compaction with experimental flag
    await executeCompact(
      sessionID,
      msg,
      autoCompactState,
      mockClient,
      directory,
      experimental,
    )

    // #then: Lock should be cleared even on early return
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("prevents concurrent compaction attempts", async () => {
    // #given: Lock already held (simpler test)
    autoCompactState.compactionInProgress.add(sessionID)

    // #when: Try to execute compaction while lock is held
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // #then: Toast should be shown
    const toastCalls = (mockClient.tui.showToast as any).mock.calls
    const blockedToast = toastCalls.find(
      (call: any) => call[0]?.body?.title === "Compact In Progress",
    )
    expect(blockedToast).toBeDefined()

    // #then: Lock should still be held (not cleared by blocked attempt)
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(true)
  })

  test("clears lock after max recovery attempts exhausted", async () => {
    // #given: All retry/revert attempts exhausted
    mockClient.session.messages = mock(() => Promise.resolve({ data: [] }))

    // Max out all attempts
    autoCompactState.retryStateBySession.set(sessionID, {
      attempt: 5,
      lastAttemptTime: Date.now(),
    })
    autoCompactState.truncateStateBySession.set(sessionID, {
      truncateAttempt: 5,
    })
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // #when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // #then: Should show failure toast
    const toastCalls = (mockClient.tui.showToast as any).mock.calls
    const failureToast = toastCalls.find(
      (call: any) => call[0]?.body?.title === "Auto Compact Failed",
    )
    expect(failureToast).toBeDefined()

    // #then: Lock should still be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when client.tui.showToast throws", async () => {
    // #given: Toast will fail (this should never happen but testing robustness)
    mockClient.tui.showToast = mock(() =>
      Promise.reject(new Error("Toast failed")),
    )
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // #when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // #then: Lock should be cleared even if toast fails
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when prompt_async in continuation throws", async () => {
    // #given: prompt_async will fail during continuation
    mockClient.session.prompt_async = mock(() =>
      Promise.reject(new Error("Prompt failed")),
    )
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // #when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // Wait for setTimeout callback
    await fakeTimeouts.advanceBy(600)

    // #then: Lock should be cleared
    // The continuation happens in setTimeout, but lock is cleared in finally before that
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("falls through to summarize when truncation is insufficient", async () => {
    // #given: Over token limit with truncation returning insufficient
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 250000,
      maxTokens: 200000,
    })

    const truncateSpy = spyOn(storage, "truncateUntilTargetTokens").mockReturnValue({
      success: true,
      sufficient: false,
      truncatedCount: 3,
      totalBytesRemoved: 10000,
      targetBytesToRemove: 50000,
      truncatedTools: [
        { toolName: "Grep", originalSize: 5000 },
        { toolName: "Read", originalSize: 3000 },
        { toolName: "Bash", originalSize: 2000 },
      ],
    })

    // #when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // #then: Truncation was attempted
    expect(truncateSpy).toHaveBeenCalled()

    // #then: Summarize should be called (fall through from insufficient truncation)
    expect(mockClient.session.summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: sessionID },
        body: { providerID: "anthropic", modelID: "claude-opus-4-5", auto: true },
      }),
    )

    // #then: Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)

    truncateSpy.mockRestore()
  })

  test("does NOT call summarize when truncation is sufficient", async () => {
    // #given: Over token limit with truncation returning sufficient
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 250000,
      maxTokens: 200000,
    })

    const truncateSpy = spyOn(storage, "truncateUntilTargetTokens").mockReturnValue({
      success: true,
      sufficient: true,
      truncatedCount: 5,
      totalBytesRemoved: 60000,
      targetBytesToRemove: 50000,
      truncatedTools: [
        { toolName: "Grep", originalSize: 30000 },
        { toolName: "Read", originalSize: 30000 },
      ],
    })

    // #when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // Wait for setTimeout callback
    await fakeTimeouts.advanceBy(600)

    // #then: Truncation was attempted
    expect(truncateSpy).toHaveBeenCalled()

    // #then: Summarize should NOT be called (early return from sufficient truncation)
    expect(mockClient.session.summarize).not.toHaveBeenCalled()

    // #then: prompt_async should be called (Continue after successful truncation)
    expect(mockClient.session.prompt_async).toHaveBeenCalled()

    // #then: Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)

    truncateSpy.mockRestore()
  })
})
