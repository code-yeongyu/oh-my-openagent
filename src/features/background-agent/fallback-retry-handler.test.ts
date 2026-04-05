import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

const sharedLogMock = mock(() => {})
const readConnectedProvidersCacheMock = mock(() => null)
const readProviderModelsCacheMock = mock(() => null)
const shouldRetryErrorMock = mock(() => true)
const getNextFallbackMock = mock((chain: Array<{ model: string }>, attempt: number) => chain[attempt])
const hasMoreFallbacksMock = mock((chain: Array<{ model: string }>, attempt: number) => attempt < chain.length)
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
  }
}

const { tryFallbackRetry, shouldRetryError, selectFallbackProvider, readProviderModelsCache } =
  await importFreshFallbackRetryHandlerModule()

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
    parentSessionID: "parent-session-1",
    parentMessageID: "parent-message-1",
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
        sessionID: "old-session",
        startedAt: new Date(),
      })

      await tryFallbackRetry(args)

      expect(args.task.sessionID).toBeUndefined()
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
      const args = createDefaultArgs({ sessionID: "session-to-abort" })

      await tryFallbackRetry(args)

      expect(args.abortMock).toHaveBeenCalledWith({
        path: { id: "session-to-abort" },
      })
    })

    test("waits for session abort before resolving", async () => {
      const args = createDefaultArgs({ sessionID: "session-to-abort" })
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
  })

  describe("#given non-retryable error", () => {
    test("returns false when shouldRetryError returns false", async () => {
      ;(shouldRetryError as any).mockImplementation(() => false)
      const args = createDefaultArgs()

      const result = await tryFallbackRetry(args)

      expect(result).toBe(false)
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
      const args = createDefaultArgs({ sessionID: undefined })

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
})
