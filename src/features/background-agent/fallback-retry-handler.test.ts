import { describe, test, expect, mock, beforeEach } from "bun:test"

mock.module("../../shared", () => ({
  log: mock(() => {}),
  readConnectedProvidersCache: mock(() => null),
  readProviderModelsCache: mock(() => null),
}))

mock.module("../../shared/model-error-classifier", () => ({
  shouldRetryError: mock(() => true),
  getNextFallback: mock((chain: Array<{ model: string }>, attempt: number) => chain[attempt]),
  hasMoreFallbacks: mock((chain: Array<{ model: string }>, attempt: number) => attempt < chain.length),
  selectFallbackProvider: mock((providers: string[]) => providers[0]),
}))

mock.module("../../shared/provider-model-id-transform", () => ({
  transformModelForProvider: mock((_provider: string, model: string) => model),
}))

import { tryFallbackRetry } from "./fallback-retry-handler"
import { shouldRetryError } from "../../shared/model-error-classifier"
import type { BackgroundTask } from "./types"
import type { ConcurrencyManager } from "./concurrency"

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

function createMockClient() {
  return {
    session: {
      abort: mock(async () => ({})),
    },
  } as any
}

function createDefaultArgs(taskOverrides: Partial<BackgroundTask> = {}) {
  const processKeyFn = mock(() => {})
  const queuesByKey = new Map<string, Array<{ task: BackgroundTask; input: any }>>()
  const idleDeferralTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const concurrencyManager = createMockConcurrencyManager()
  const client = createMockClient()
  const task = createMockTask(taskOverrides)

  return {
    task,
    errorInfo: { name: "OverloadedError", message: "model overloaded" },
    source: "polling",
    concurrencyManager,
    client,
    idleDeferralTimers,
    queuesByKey,
    processKey: processKeyFn,
  }
}

describe("tryFallbackRetry", () => {
  beforeEach(() => {
    ;(shouldRetryError as any).mockImplementation(() => true)
  })

  describe("#given retryable error with fallback chain", () => {
    test("returns true and enqueues retry", () => {
      const args = createDefaultArgs()

      const result = tryFallbackRetry(args)

      expect(result).toBe(true)
    })

    test("resets task status to pending", () => {
      const args = createDefaultArgs()

      tryFallbackRetry(args)

      expect(args.task.status).toBe("pending")
    })

    test("increments attemptCount", () => {
      const args = createDefaultArgs()

      tryFallbackRetry(args)

      expect(args.task.attemptCount).toBe(1)
    })

    test("updates task model to fallback", () => {
      const args = createDefaultArgs()

      tryFallbackRetry(args)

      expect(args.task.model?.modelID).toBe("fallback-model-1")
      expect(args.task.model?.providerID).toBe("provider-a")
    })

    test("clears sessionID and startedAt", () => {
      const args = createDefaultArgs({
        sessionID: "old-session",
        startedAt: new Date(),
      })

      tryFallbackRetry(args)

      expect(args.task.sessionID).toBeUndefined()
      expect(args.task.startedAt).toBeUndefined()
    })

    test("clears error field", () => {
      const args = createDefaultArgs({ error: "previous error" })

      tryFallbackRetry(args)

      expect(args.task.error).toBeUndefined()
    })

    test("sets new queuedAt", () => {
      const args = createDefaultArgs()

      tryFallbackRetry(args)

      expect(args.task.queuedAt).toBeInstanceOf(Date)
    })

    test("releases concurrency slot", () => {
      const args = createDefaultArgs()

      tryFallbackRetry(args)

      expect(args.concurrencyManager.release).toHaveBeenCalledWith("provider-a/original-model")
    })

    test("clears concurrencyKey after release", () => {
      const args = createDefaultArgs()

      tryFallbackRetry(args)

      expect(args.task.concurrencyKey).toBeUndefined()
    })

    test("aborts existing session", () => {
      const args = createDefaultArgs({ sessionID: "session-to-abort" })

      tryFallbackRetry(args)

      expect(args.client.session.abort).toHaveBeenCalledWith({
        path: { id: "session-to-abort" },
      })
    })

    test("adds retry input to queue and calls processKey", () => {
      const args = createDefaultArgs()

      tryFallbackRetry(args)

      const key = `${args.task.model!.providerID}/${args.task.model!.modelID}`
      const queue = args.queuesByKey.get(key)
      expect(queue).toBeDefined()
      expect(queue!.length).toBe(1)
      expect(queue![0].task).toBe(args.task)
      expect(args.processKey).toHaveBeenCalledWith(key)
    })
  })

  describe("#given non-retryable error", () => {
    test("returns false when shouldRetryError returns false", () => {
      ;(shouldRetryError as any).mockImplementation(() => false)
      const args = createDefaultArgs()

      const result = tryFallbackRetry(args)

      expect(result).toBe(false)
    })
  })

  describe("#given no fallback chain", () => {
    test("returns false when fallbackChain is undefined", () => {
      const args = createDefaultArgs({ fallbackChain: undefined })

      const result = tryFallbackRetry(args)

      expect(result).toBe(false)
    })

    test("returns false when fallbackChain is empty", () => {
      const args = createDefaultArgs({ fallbackChain: [] })

      const result = tryFallbackRetry(args)

      expect(result).toBe(false)
    })
  })

  describe("#given exhausted fallbacks", () => {
    test("returns false when attemptCount exceeds chain length", () => {
      const args = createDefaultArgs({ attemptCount: 5 })

      const result = tryFallbackRetry(args)

      expect(result).toBe(false)
    })
  })

  describe("#given task without concurrency key", () => {
    test("skips concurrency release", () => {
      const args = createDefaultArgs({ concurrencyKey: undefined })

      tryFallbackRetry(args)

      expect(args.concurrencyManager.release).not.toHaveBeenCalled()
    })
  })

  describe("#given task without session", () => {
    test("skips session abort", () => {
      const args = createDefaultArgs({ sessionID: undefined })

      tryFallbackRetry(args)

      expect(args.client.session.abort).not.toHaveBeenCalled()
    })
  })

  describe("#given active idle deferral timer", () => {
    test("clears the timer and removes from map", () => {
      const args = createDefaultArgs()
      const timerId = setTimeout(() => {}, 10000)
      args.idleDeferralTimers.set("test-task-1", timerId)

      tryFallbackRetry(args)

      expect(args.idleDeferralTimers.has("test-task-1")).toBe(false)
    })
  })

  describe("#given second attempt", () => {
    test("uses second fallback in chain", () => {
      const args = createDefaultArgs({ attemptCount: 1 })

      tryFallbackRetry(args)

      expect(args.task.model?.modelID).toBe("fallback-model-2")
      expect(args.task.attemptCount).toBe(2)
    })
  })
})
