import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

const sharedLogMock = mock(() => {})
const readConnectedProvidersCacheMock = mock(() => null)
const readProviderModelsCacheMock = mock(() => null)
const shouldRetryErrorMock = mock(() => true)
const getNextFallbackMock = mock((chain: Array<{ model: string }>, attempt: number) => chain[attempt])
const hasMoreFallbacksMock = mock((chain: Array<{ model: string }>, attempt: number) => attempt < chain.length)
const isProviderScopedStopMock = mock(() => false)
const hasCrossProviderFallbackMock = mock(() => false)
const selectFallbackProviderMock = mock((providers: string[]) => providers[0])
const transformModelForProviderMock = mock((_provider: string, model: string) => model)

import type { BackgroundTask } from "./types"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"

async function importFreshFallbackRetryHandlerModule() {
  mock.module("../../shared/logger", () => ({
    log: sharedLogMock,
  }))

  mock.module("../../shared/connected-providers-cache", () => ({
    readConnectedProvidersCache: readConnectedProvidersCacheMock,
    readProviderModelsCache: readProviderModelsCacheMock,
  }))

  mock.module("../../shared/model-error-classifier", () => ({
    shouldRetryError: shouldRetryErrorMock,
    getNextFallback: getNextFallbackMock,
    hasMoreFallbacks: hasMoreFallbacksMock,
    isProviderScopedStop: isProviderScopedStopMock,
    hasCrossProviderFallback: hasCrossProviderFallbackMock,
    selectFallbackProvider: selectFallbackProviderMock,
  }))

  mock.module("../../shared/provider-model-id-transform", () => ({
    transformModelForProvider: transformModelForProviderMock,
  }))

  const retryHandlerModule = await import(`./fallback-retry-handler?test=${Date.now()}-${Math.random()}`)
  mock.restore()

  return {
    tryFallbackRetry: retryHandlerModule.tryFallbackRetry,
    shouldRetryError: shouldRetryErrorMock,
    selectFallbackProvider: selectFallbackProviderMock,
    readProviderModelsCache: readProviderModelsCacheMock,
    isProviderScopedStop: isProviderScopedStopMock,
    hasCrossProviderFallback: hasCrossProviderFallbackMock,
  }
}

const {
  tryFallbackRetry,
  shouldRetryError,
  selectFallbackProvider,
  readProviderModelsCache,
  isProviderScopedStop,
  hasCrossProviderFallback,
} = await importFreshFallbackRetryHandlerModule()

function createDeferredPromise(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolvePromise = () => {}
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: resolvePromise,
  }
}

function createMockTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "test-task-1",
    description: "test task",
    prompt: "test prompt",
    agent: "sisyphus-junior",
    status: "error",
    parentSessionId: "parent-session-1",
    parentMessageId: "parent-message-1",
    fallbackChain: [
      { model: "fallback-model-1", providers: ["provider-a"], variant: undefined },
      { model: "fallback-model-2", providers: ["provider-b"], variant: undefined },
    ],
    attemptCount: 0,
    concurrencyKey: "provider-a/original-model",
    model: { providerID: "provider-a", modelID: "original-model" },
    ...overrides,
  }
}

function createMockConcurrencyManager(): ConcurrencyManager {
  return {
    release: mock(() => {}),
    acquire: mock(async () => {}),
    getQueueLength: mock(() => 0),
    getActiveCount: mock(() => 0),
  } as unknown as ConcurrencyManager
}

function createMockClient(): {
  client: OpencodeClient
  abortMock: ReturnType<typeof mock>
} {
  const abortMock = mock(async () => ({}))
  return {
    client: {
      session: {
        abort: abortMock,
      },
    } as unknown as OpencodeClient,
    abortMock,
  }
}

function createDefaultArgs(taskOverrides: Partial<BackgroundTask> = {}) {
  const processKeyFn = mock(() => {})
  const queuesByKey = new Map<string, QueueItem[]>()
  const idleDeferralTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const concurrencyManager = createMockConcurrencyManager()
  const { client, abortMock } = createMockClient()
  const task = createMockTask(taskOverrides)

  return {
    task,
    errorInfo: { name: "OverloadedError", message: "model overloaded" },
    source: "polling",
    concurrencyManager,
    client,
    abortMock,
    idleDeferralTimers,
    queuesByKey,
    processKey: processKeyFn,
  }
}

describe("tryFallbackRetry", () => {
  afterAll(() => {
    mock.restore()
  })

  beforeEach(() => {
    ;(shouldRetryError as any).mockImplementation(() => true)
    ;(selectFallbackProvider as any).mockImplementation((providers: string[]) => providers[0])
    ;(readProviderModelsCache as any).mockReturnValue(null)
    ;(isProviderScopedStop as any).mockImplementation(() => false)
    ;(hasCrossProviderFallback as any).mockImplementation(() => false)
  })

  describe("#given retryable error with fallback chain", () => {
    test("returns true and enqueues retry", async () => {
      const args = createDefaultArgs()

      const result = await tryFallbackRetry(args)

      expect(result).toBe(true)
    })

    test("resets task status to pending", async () => {
      const args = createDefaultArgs()

      await tryFallbackRetry(args)

      expect(args.task.status).toBe("pending")
    })

    test("increments attemptCount", async () => {
      const args = createDefaultArgs()

      await tryFallbackRetry(args)

      expect(args.task.attemptCount).toBe(1)
    })

    test("updates task model to fallback", async () => {
      const args = createDefaultArgs()

      await tryFallbackRetry(args)

      expect(args.task.model?.modelID).toBe("fallback-model-1")
      expect(args.task.model?.providerID).toBe("provider-a")
    })

    test("clears sessionID and startedAt", async () => {
      const args = createDefaultArgs({
        sessionId: "old-session",
        startedAt: new Date(),
      })

      await tryFallbackRetry(args)

      expect(args.task.sessionId).toBeUndefined()
      expect(args.task.startedAt).toBeUndefined()
    })

    test("clears error field", async () => {
      const args = createDefaultArgs({ error: "previous error" })

      await tryFallbackRetry(args)

      expect(args.task.error).toBeUndefined()
    })

    test("sets new queuedAt", async () => {
      const args = createDefaultArgs()

      await tryFallbackRetry(args)

      expect(args.task.queuedAt).toBeInstanceOf(Date)
    })

    test("releases concurrency slot", async () => {
      const args = createDefaultArgs()

      await tryFallbackRetry(args)

      expect(args.concurrencyManager.release).toHaveBeenCalledWith("provider-a/original-model")
    })

    test("clears concurrencyKey after release", async () => {
      const args = createDefaultArgs()

      await tryFallbackRetry(args)

      expect(args.task.concurrencyKey).toBeUndefined()
    })

    test("aborts existing session", async () => {
      const args = createDefaultArgs({ sessionId: "session-to-abort" })

      await tryFallbackRetry(args)

      expect(args.abortMock).toHaveBeenCalledWith({
        path: { id: "session-to-abort" },
      })
    })

    test("waits for session abort before resolving", async () => {
      const args = createDefaultArgs({ sessionId: "session-to-abort" })
      const deferred = createDeferredPromise()
      args.abortMock.mockImplementationOnce(() => deferred.promise)

      const retryPromise = tryFallbackRetry(args)
      let settled = false
      void retryPromise.then(() => {
        settled = true
      })

      await Promise.resolve()

      expect(settled).toBe(false)

      deferred.resolve()
      await retryPromise

      expect(settled).toBe(true)
    })

    test("adds retry input to queue and calls processKey", async () => {
      const args = createDefaultArgs()

      await tryFallbackRetry(args)

      const key = `${args.task.model!.providerID}/${args.task.model!.modelID}`
      const queue = args.queuesByKey.get(key)
      expect(queue).toBeDefined()
      expect(queue!.length).toBe(1)
      expect(queue![0].task).toBe(args.task)
      expect(args.processKey).toHaveBeenCalledWith(key)
    })

    test("finalizes the failed attempt, creates a new pending attempt, and enqueues its explicit attemptID", async () => {
      const args = createDefaultArgs({
        status: "running",
        sessionId: "session-attempt-1",
        startedAt: new Date("2026-04-27T00:00:00.000Z"),
        attempts: [
          {
            attemptId: "attempt-1",
            attemptNumber: 1,
            sessionId: "session-attempt-1",
            providerId: "provider-a",
            modelId: "original-model",
            status: "running",
            startedAt: new Date("2026-04-27T00:00:00.000Z"),
          },
        ],
        currentAttemptID: "attempt-1",
      })

      await tryFallbackRetry(args)

      expect(args.task.attempts).toHaveLength(2)
      expect(args.task.attempts?.[0]).toMatchObject({
        attemptId: "attempt-1",
        sessionId: "session-attempt-1",
        status: "error",
        error: "model overloaded",
      })
      expect(args.task.attempts?.[0]?.completedAt).toBeInstanceOf(Date)

      const nextAttempt = args.task.attempts?.[1]
      expect(nextAttempt).toBeDefined()
      expect(nextAttempt?.attemptNumber).toBe(2)
      expect(nextAttempt?.providerId).toBe("provider-a")
      expect(nextAttempt?.modelId).toBe("fallback-model-1")
      expect(nextAttempt?.status).toBe("pending")

      expect(args.task.currentAttemptID).toBe(nextAttempt?.attemptId)
      expect(args.task.status).toBe("pending")
      expect(args.task.model).toEqual({
        providerID: "provider-a",
        modelID: "fallback-model-1",
        variant: undefined,
      })

      const key = `${args.task.model!.providerID}/${args.task.model!.modelID}`
      const queue = args.queuesByKey.get(key)
      expect(queue).toBeDefined()
      expect((queue?.[0] as QueueItem & { attemptID?: string })?.attemptID).toBe(nextAttempt?.attemptId)
    })
  })

  describe("#given non-retryable error", () => {
    test("returns false when shouldRetryError returns false", async () => {
      ;(shouldRetryError as any).mockImplementation(() => false)
      const args = createDefaultArgs()

      const result = await tryFallbackRetry(args)

      expect(result).toBe(false)
    })
  })

  describe("#given task.modelIntent is 'explicit' (sticky-model policy)", () => {
    test("returns false even when shouldRetryError is true and a fallback chain is available", async () => {
      // given — user explicitly picked a model (CLI --model / agents.<>.model
      // override / TeamSpec model:); chain is fully available and the error
      // is exactly the kind that previously triggered a silent swap.
      const args = createDefaultArgs({
        model: { providerID: "deepseek", modelID: "v4-pro" },
        modelIntent: "explicit",
        attemptCount: 0,
      })
      ;(shouldRetryError as any).mockImplementation(() => true)

      // when
      const result = await tryFallbackRetry(args)

      // then — the runtime refuses to advance the chain. The task model is
      // preserved; concurrency is NOT released; no retry is enqueued.
      expect(result).toBe(false)
      expect(args.task.model?.modelID).toBe("v4-pro")
      expect(args.task.model?.providerID).toBe("deepseek")
      expect(args.task.modelIntent).toBe("explicit")
      expect(args.task.attemptCount).toBe(0)
      expect(args.concurrencyManager.release).not.toHaveBeenCalled()
      expect(args.queuesByKey.size).toBe(0)
    })

    test("undefined modelIntent is treated as auto and chain advancement still works", async () => {
      // given — legacy task launched before the modelIntent field existed
      const args = createDefaultArgs({
        model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
        attemptCount: 0,
      })

      // when
      const result = await tryFallbackRetry(args)

      // then — backward compat: undefined modelIntent permits chain
      expect(result).toBe(true)
    })

    test("modelIntent='auto' permits chain advancement", async () => {
      // given — system-resolved or category-default model
      const args = createDefaultArgs({
        model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
        modelIntent: "auto",
        attemptCount: 0,
      })

      // when
      const result = await tryFallbackRetry(args)

      // then
      expect(result).toBe(true)
    })
  })

  describe("#given forceCrossProvider mode (sticky cross-provider escape)", () => {
    test("uses crossProviderProviders as the synthetic provider list, preserves modelID, and re-queues even when modelIntent='explicit' (sticky guard bypassed)", async () => {
      // given — sticky task whose original provider exhausted balance.
      // Manager passes the alternate connected provider list.
      const baseArgs = createDefaultArgs({
        model: { providerID: "opencode-go", modelID: "deepseek-v4-pro" },
        modelIntent: "explicit",
        attemptCount: 0,
      })
      const args = {
        ...baseArgs,
        forceCrossProvider: true,
        crossProviderProviders: ["github-copilot"],
      }

      // when
      const result = await tryFallbackRetry(args)

      // then — task was re-queued under the alternate provider with the
      // original modelID preserved. attemptCount stayed at 0 since this
      // is a provider swap, not a chain advancement.
      expect(result).toBe(true)
      expect(args.task.model?.modelID).toBe("deepseek-v4-pro")
      expect(args.task.model?.providerID).toBe("github-copilot")
      expect(args.task.attemptCount).toBe(0)
    })

    test("returns false when crossProviderProviders is empty (no alternate available)", async () => {
      // given
      const baseArgs = createDefaultArgs({
        model: { providerID: "opencode-go", modelID: "deepseek-v4-pro" },
        modelIntent: "explicit",
      })
      const args = { ...baseArgs, forceCrossProvider: true, crossProviderProviders: [] }

      // when
      const result = await tryFallbackRetry(args)

      // then — caller (manager) will fall through to the structured fail path
      expect(result).toBe(false)
    })

    test("two sequential swaps: each retry uses a strictly smaller candidate set as the caller accumulates failedProviders (ping-pong protection)", async () => {
      // given — first swap: opencode-go fails, alternates are
      // [github-copilot, anthropic]. The caller (manager) picks the head.
      const firstSwap = createDefaultArgs({
        model: { providerID: "opencode-go", modelID: "deepseek-v4-pro" },
        modelIntent: "explicit",
        attemptCount: 0,
      })
      const firstArgs = {
        ...firstSwap,
        forceCrossProvider: true,
        crossProviderProviders: ["github-copilot", "anthropic"],
      }
      await tryFallbackRetry(firstArgs)
      expect(firstArgs.task.model?.providerID).toBe("github-copilot")

      // when — second swap: github-copilot now ALSO fails. Caller has
      // accumulated failedProviders=[opencode-go, github-copilot] and
      // hands us only [anthropic] — i.e. github-copilot is excluded so
      // we cannot ping-pong back to it.
      const secondArgs = {
        ...firstArgs,
        crossProviderProviders: ["anthropic"],
      }
      const result = await tryFallbackRetry(secondArgs)

      // then
      expect(result).toBe(true)
      expect(secondArgs.task.model?.providerID).toBe("anthropic")
      expect(secondArgs.task.model?.modelID).toBe("deepseek-v4-pro")
      // Critically: NEVER returns to opencode-go or github-copilot.
      expect(["opencode-go", "github-copilot"]).not.toContain(secondArgs.task.model?.providerID)
    })

    test("exhausted alternates: empty crossProviderProviders falls through to false so the manager triggers structured fail-with-billing-URL", async () => {
      // given — every connected provider has been added to failedProviders.
      // The manager hands us an empty list. The function must return false
      // so the caller falls into the structured-fail path (Step 2 in
      // manager.handleSessionErrorEvent).
      const args = createDefaultArgs({
        model: { providerID: "opencode-go", modelID: "deepseek-v4-pro" },
        modelIntent: "explicit",
      })
      const exhaustedArgs = {
        ...args,
        forceCrossProvider: true,
        crossProviderProviders: [],
      }

      // when
      const result = await tryFallbackRetry(exhaustedArgs)

      // then — caller will surface [STICKY MODEL UNAVAILABLE] reminder
      expect(result).toBe(false)
      // And task.model is unchanged (no swap happened).
      expect(exhaustedArgs.task.model?.providerID).toBe("opencode-go")
    })

    test("does NOT advance the chain when forceCrossProvider succeeds (synthetic-entry path is independent of fallbackChain)", async () => {
      // given — sticky task with a real chain, but cross-provider escape
      // should NOT walk that chain (it would change the model, violating
      // sticky-on-model intent). The chain stays intact for any subsequent
      // failures.
      const baseArgs = createDefaultArgs({
        model: { providerID: "opencode-go", modelID: "claude-opus-4-7" },
        modelIntent: "explicit",
        attemptCount: 0,
      })
      const originalChainLength = baseArgs.task.fallbackChain?.length ?? 0
      const args = {
        ...baseArgs,
        forceCrossProvider: true,
        crossProviderProviders: ["anthropic", "github-copilot"],
      }

      // when
      await tryFallbackRetry(args)

      // then
      expect(args.task.fallbackChain?.length).toBe(originalChainLength)
      expect(args.task.attemptCount).toBe(0)
    })
  })

  describe("#given no fallback chain", () => {
    test("returns false when fallbackChain is undefined", async () => {
      const args = createDefaultArgs({ fallbackChain: undefined })

      const result = await tryFallbackRetry(args)

      expect(result).toBe(false)
    })

    test("returns false when fallbackChain is empty", async () => {
      const args = createDefaultArgs({ fallbackChain: [] })

      const result = await tryFallbackRetry(args)

      expect(result).toBe(false)
    })
  })

  describe("#given exhausted fallbacks", () => {
    test("returns false when attemptCount exceeds chain length", async () => {
      const args = createDefaultArgs({ attemptCount: 5 })

      const result = await tryFallbackRetry(args)

      expect(result).toBe(false)
    })
  })

  describe("#given task without concurrency key", () => {
    test("skips concurrency release", async () => {
      const args = createDefaultArgs({ concurrencyKey: undefined })

      await tryFallbackRetry(args)

      expect(args.concurrencyManager.release).not.toHaveBeenCalled()
    })
  })

  describe("#given task without session", () => {
    test("skips session abort", async () => {
      const args = createDefaultArgs({ sessionId: undefined })

      await tryFallbackRetry(args)

      expect(args.abortMock).not.toHaveBeenCalled()
    })
  })

  describe("#given active idle deferral timer", () => {
    test("clears the timer and removes from map", async () => {
      const args = createDefaultArgs()
      const timerId = setTimeout(() => {}, 10000)
      args.idleDeferralTimers.set("test-task-1", timerId)

      await tryFallbackRetry(args)

      expect(args.idleDeferralTimers.has("test-task-1")).toBe(false)
    })
  })

  describe("#given second attempt", () => {
    test("uses second fallback in chain", async () => {
      const args = createDefaultArgs({ attemptCount: 1 })

      await tryFallbackRetry(args)

      expect(args.task.model?.modelID).toBe("fallback-model-2")
      expect(args.task.attemptCount).toBe(2)
    })
  })

  describe("#given first fallback is a no-op for the current model", () => {
    test("skips the no-op fallback and advances to the next distinct model", async () => {
      const args = createDefaultArgs({
        model: { providerID: "provider-a", modelID: "fallback-model-1" },
        fallbackChain: [
          { model: "fallback-model-1", providers: ["provider-a"], variant: undefined },
          { model: "fallback-model-2", providers: ["provider-b"], variant: undefined },
        ],
      })

      const result = await tryFallbackRetry(args)

      expect(result).toBe(true)
      expect(args.task.model?.providerID).toBe("provider-b")
      expect(args.task.model?.modelID).toBe("fallback-model-2")
      expect(args.task.attemptCount).toBe(2)
    })
  })

  describe("#given disconnected fallback providers with connected preferred provider", () => {
    test("keeps fallback entry and selects connected preferred provider", async () => {
      ;(readProviderModelsCache as any).mockReturnValueOnce({ connected: ["provider-a"] })
      ;(selectFallbackProvider as any).mockImplementationOnce(
        (_providers: string[], preferredProviderID?: string) => preferredProviderID ?? "provider-b",
      )

      const args = createDefaultArgs({
        fallbackChain: [{ model: "fallback-model-1", providers: ["provider-b"], variant: undefined }],
        model: { providerID: "provider-a", modelID: "original-model" },
      })

      const result = await tryFallbackRetry(args)

      expect(result).toBe(true)
      expect(args.task.model?.providerID).toBe("provider-a")
      expect(args.task.model?.modelID).toBe("fallback-model-1")
    })
  })

  describe("#given provider-scoped stop with cross-provider chain (Copilot balance runout case)", () => {
    test("retries on a different-provider entry even though shouldRetryError says false", async () => {
      ;(shouldRetryError as any).mockImplementation(() => false)
      ;(isProviderScopedStop as any).mockImplementation(() => true)
      ;(hasCrossProviderFallback as any).mockImplementation(() => true)

      const args = createDefaultArgs({
        fallbackChain: [
          { model: "fallback-model-1", providers: ["provider-b"], variant: undefined },
        ],
        model: { providerID: "provider-a", modelID: "original-model" },
        attemptCount: 0,
      })
      args.errorInfo = { name: "InsufficientCreditsError", message: "402 insufficient balance" }

      const result = await tryFallbackRetry(args)

      expect(result).toBe(true)
      expect(args.task.model?.providerID).toBe("provider-b")
      expect(args.task.model?.modelID).toBe("fallback-model-1")
    })

    test("does NOT retry when chain is exhausted of cross-provider entries", async () => {
      ;(shouldRetryError as any).mockImplementation(() => false)
      ;(isProviderScopedStop as any).mockImplementation(() => true)
      ;(hasCrossProviderFallback as any).mockImplementation(() => false)

      const args = createDefaultArgs({
        fallbackChain: [
          { model: "same-prov-fallback", providers: ["provider-a"], variant: undefined },
        ],
        model: { providerID: "provider-a", modelID: "original-model" },
      })
      args.errorInfo = { name: "InsufficientCreditsError", message: "out of credits" }

      const result = await tryFallbackRetry(args)

      expect(result).toBe(false)
    })

    test("does NOT retry on user-fault errors even with a cross-provider chain", async () => {
      // PermissionDenied is non-retryable AND non-stop; cross-provider escape
      // must not rescue it.
      ;(shouldRetryError as any).mockImplementation(() => false)
      ;(isProviderScopedStop as any).mockImplementation(() => false)
      ;(hasCrossProviderFallback as any).mockImplementation(() => true)

      const args = createDefaultArgs()
      args.errorInfo = { name: "PermissionDeniedError", message: "denied by user" }

      const result = await tryFallbackRetry(args)

      expect(result).toBe(false)
    })

    test("baseRetry takes precedence (does not double-call cross-provider gate)", async () => {
      ;(shouldRetryError as any).mockImplementation(() => true)
      const isStopSpy = mock(() => true)
      const hasCrossSpy = mock(() => true)
      ;(isProviderScopedStop as any).mockImplementation(isStopSpy)
      ;(hasCrossProviderFallback as any).mockImplementation(hasCrossSpy)

      const args = createDefaultArgs()
      const result = await tryFallbackRetry(args)

      expect(result).toBe(true)
      // The escape gate is short-circuited when baseRetry is already true.
      expect(isStopSpy).not.toHaveBeenCalled()
      expect(hasCrossSpy).not.toHaveBeenCalled()
    })
  })
})
