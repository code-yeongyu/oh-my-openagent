import { describe, expect, mock, test } from "bun:test"
import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { OpencodeClient, QueueItem } from "./constants"
import { ConcurrencyManager } from "./concurrency"
import type { BackgroundTask } from "./types"
import { tryFallbackRetry, type FallbackRetryHandlerDeps } from "./fallback-retry-handler"

const fallbackChain: FallbackEntry[] = [
  { model: "fallback-model-1", providers: ["provider-a"], variant: undefined },
]

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "test-task-1",
    description: "test task",
    prompt: "test prompt",
    agent: "sisyphus-junior",
    status: "error",
    parentSessionId: "parent-session-1",
    parentMessageId: "parent-message-1",
    parentAgent: "sisyphus",
    fallbackChain,
    attemptCount: 0,
    concurrencyKey: "provider-a/original-model",
    model: { providerID: "provider-a", modelID: "original-model" },
    ...overrides,
  }
}

function createClient(): OpencodeClient {
  return { session: { abort: mock(async () => ({})) } } as OpencodeClient
}

function createDeps(): Partial<FallbackRetryHandlerDeps> {
  return {
    log: mock(() => {}),
    readConnectedProvidersCache: mock(() => null),
    readProviderModelsCache: mock((): ProviderModelsCache | null => null),
    shouldRetryError: mock(() => false),
    getNextFallback: mock((chain: FallbackEntry[], attempt: number) => chain[attempt]),
    hasMoreFallbacks: mock((chain: FallbackEntry[], attempt: number) => attempt < chain.length),
    selectFallbackProvider: mock((providers: string[]) => providers[0]),
    transformModelForProvider: mock((_provider: string, model: string) => model),
  }
}

function createRetryArgs(overrides: Partial<BackgroundTask> = {}) {
  return {
    task: createTask(overrides),
    errorInfo: {
      message: "Subscription quota exceeded. You can continue using free models.",
    },
    source: "session.error",
    concurrencyManager: new ConcurrencyManager(),
    client: createClient(),
    idleDeferralTimers: new Map<string, ReturnType<typeof setTimeout>>(),
    queuesByKey: new Map<string, QueueItem[]>(),
    processKey: mock(() => {}),
    admitRetrySpawn: mock(async () => {}),
    deps: createDeps(),
  }
}

describe("tryFallbackRetry provider-exhaustion opt-in", () => {
  test("#given legacy STOP semantics reject provider exhaustion #when background retry opts in #then it queues the fallback", async () => {
    const args = createRetryArgs()

    const result = await tryFallbackRetry(args)

    expect(result).toBe(true)
    expect(args.deps.shouldRetryError).toHaveBeenCalledWith(args.errorInfo)
    expect(args.task.attemptCount).toBe(1)
    expect(args.task.model).toEqual({
      providerID: "provider-a",
      modelID: "fallback-model-1",
      variant: undefined,
    })
    expect(args.queuesByKey.get("provider-a/fallback-model-1")).toHaveLength(1)
  })

  test("#given provider exhaustion after all fallbacks were attempted #when retry handling runs #then it does not requeue", async () => {
    const args = createRetryArgs({ attemptCount: 1 })

    const result = await tryFallbackRetry(args)

    expect(result).toBe(false)
    expect(args.task.attemptCount).toBe(1)
    expect(args.queuesByKey.size).toBe(0)
  })
})
