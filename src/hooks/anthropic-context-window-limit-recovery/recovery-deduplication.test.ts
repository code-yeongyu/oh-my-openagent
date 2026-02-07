import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ExperimentalConfig } from "../../config"

const attemptDeduplicationRecoveryMock = mock(async () => {})

mock.module("./deduplication-recovery", () => ({
  attemptDeduplicationRecovery: attemptDeduplicationRecoveryMock,
}))

function createImmediateTimeouts(): () => void {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
    callback(...args)
    return 0 as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  globalThis.clearTimeout = ((_: ReturnType<typeof setTimeout>) => {}) as typeof clearTimeout

  return () => {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
}

describe("createAnthropicContextWindowLimitRecoveryHook", () => {
  beforeEach(() => {
    attemptDeduplicationRecoveryMock.mockClear()
  })

  test("calls deduplication recovery when compaction is already in progress", async () => {
    //#given
    const restoreTimeouts = createImmediateTimeouts()

    const experimental = {
      dynamic_context_pruning: {
        enabled: true,
        strategies: {
          deduplication: { enabled: true },
        },
      },
    } satisfies ExperimentalConfig

    let resolveSummarize: (() => void) | null = null
    const summarizePromise = new Promise<void>((resolve) => {
      resolveSummarize = resolve
    })

    const mockClient = {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
        summarize: mock(() => summarizePromise),
        revert: mock(() => Promise.resolve()),
        prompt_async: mock(() => Promise.resolve()),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    }

    try {
      const { createAnthropicContextWindowLimitRecoveryHook } = await import("./recovery-hook")
      const ctx = { client: mockClient, directory: "/tmp" } as PluginInput
      const hook = createAnthropicContextWindowLimitRecoveryHook(ctx, { experimental })

      // first error triggers compaction (setTimeout runs immediately due to mock)
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-96", error: "prompt is too long" },
        },
      })

      //#when - second error while compaction is in progress
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-96", error: "prompt is too long" },
        },
      })

      //#then - deduplication recovery was called for the second error
      expect(attemptDeduplicationRecoveryMock).toHaveBeenCalledTimes(1)
      expect(attemptDeduplicationRecoveryMock.mock.calls[0]![0]).toBe("session-96")
    } finally {
      if (resolveSummarize) resolveSummarize()
      restoreTimeouts()
    }
  })

  test("does not call deduplication when compaction is not in progress", async () => {
    //#given
    const mockClient = {
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

    const { createAnthropicContextWindowLimitRecoveryHook } = await import("./recovery-hook")
    const ctx = { client: mockClient, directory: "/tmp" } as PluginInput
    const hook = createAnthropicContextWindowLimitRecoveryHook(ctx)

    //#when - single error (no compaction in progress)
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "session-no-dedup", error: "some other error" },
      },
    })

    //#then
    expect(attemptDeduplicationRecoveryMock).not.toHaveBeenCalled()
  })
})
