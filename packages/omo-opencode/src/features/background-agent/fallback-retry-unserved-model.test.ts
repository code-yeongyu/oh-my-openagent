import { describe, expect, mock, test } from "bun:test"
import { tryFallbackRetry, type FallbackRetryHandlerDeps } from "./fallback-retry-handler"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import type { BackgroundTask } from "./types"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"

const GEMINI_ENTRY: FallbackEntry = { model: "gemini-3.1-pro", providers: ["google", "github-copilot", "opencode"], variant: "high" }
const OPUS_ENTRY: FallbackEntry = { model: "claude-opus-5", providers: ["anthropic", "github-copilot", "opencode"], variant: "max" }
const OPENCODE_FREE_MODELS = ["big-pickle", "nemotron-3-ultra-free", "mimo-v2.5-free"]

function createArgs(cache: ProviderModelsCache, fallbackChain: FallbackEntry[]) {
  const connectedSet = new Set(cache.connected.map((provider) => provider.toLowerCase()))
  const deps: Partial<FallbackRetryHandlerDeps> = {
    log: mock(() => {}),
    readProviderModelsCache: () => cache,
    readConnectedProvidersCache: () => cache.connected,
    shouldRetryError: () => true,
    isProviderExhaustionFallbackEligible: () => false,
    getNextFallback: (chain, attempt) => chain[attempt],
    hasMoreFallbacks: (chain, attempt) => attempt < chain.length,
    selectFallbackProvider: (providers, preferred) =>
      providers.find((provider) => connectedSet.has(provider.toLowerCase())) ?? preferred ?? providers[0],
    transformModelForProvider: (_provider, model) => model,
  }
  const task: BackgroundTask = {
    id: "bg_unserved",
    description: "Re-review repaired U1",
    prompt: "review",
    agent: "oracle",
    status: "running",
    sessionId: "ses_original",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    fallbackChain,
    attemptCount: 0,
    model: { providerID: "opencode", modelID: "big-pickle" },
  }
  const queuesByKey = new Map<string, QueueItem[]>()
  return {
    task,
    errorInfo: { name: "SessionRetry", message: "rate limited" },
    source: "session.status",
    concurrencyManager: {
      release: mock(() => {}),
      getConcurrencyKey: (key: string) => key,
    } as unknown as ConcurrencyManager,
    client: { session: { abort: mock(async () => ({})) } } as unknown as OpencodeClient,
    idleDeferralTimers: new Map<string, ReturnType<typeof setTimeout>>(),
    queuesByKey,
    processKey: mock(() => {}),
    deps,
  }
}

function queuedModels(queuesByKey: Map<string, QueueItem[]>): string[] {
  return [...queuesByKey.values()].flat().map((item) => `${item.input.model?.providerID}/${item.input.model?.modelID}`)
}

describe("tryFallbackRetry with provider model lists (#8540)", () => {
  test("does not spawn a retry when the only connected provider serves none of the chain models", async () => {
    // given only opencode is connected and its cached model list has neither gemini-3.1-pro nor claude-opus-5
    const args = createArgs(
      { connected: ["opencode"], models: { opencode: OPENCODE_FREE_MODELS }, updatedAt: "2026-09-25T00:00:00.000Z" },
      [GEMINI_ENTRY, OPUS_ENTRY],
    )

    // when a retryable error reaches the fallback handler
    const retried = await tryFallbackRetry(args)

    // then no fallback session is queued and the task keeps its current model
    expect(retried).toBe(false)
    expect(queuedModels(args.queuesByKey)).toEqual([])
    expect(args.task.model).toEqual({ providerID: "opencode", modelID: "big-pickle" })
    expect(args.processKey).not.toHaveBeenCalled()
  })

  test("picks a later connected provider that serves the model over an earlier one that does not", async () => {
    // given opencode and github-copilot are connected and only github-copilot lists gemini-3.1-pro
    const args = createArgs(
      {
        connected: ["opencode", "github-copilot"],
        models: { opencode: OPENCODE_FREE_MODELS, "github-copilot": [{ id: "gemini-3.1-pro" }] },
        updatedAt: "2026-09-25T00:00:00.000Z",
      },
      [{ ...GEMINI_ENTRY, providers: ["google", "opencode", "github-copilot"] }],
    )

    // when
    const retried = await tryFallbackRetry(args)

    // then the retry targets the provider that actually serves the model
    expect(retried).toBe(true)
    expect(queuedModels(args.queuesByKey)).toEqual(["github-copilot/gemini-3.1-pro"])
  })

  test("skips an unserved chain entry and retries on the next served one", async () => {
    // given anthropic is connected and serves claude-opus-5 but nothing connected serves gemini-3.1-pro
    const args = createArgs(
      {
        connected: ["opencode", "anthropic"],
        models: { opencode: OPENCODE_FREE_MODELS, anthropic: ["claude-opus-5"] },
        updatedAt: "2026-09-25T00:00:00.000Z",
      },
      [GEMINI_ENTRY, OPUS_ENTRY],
    )

    // when
    const retried = await tryFallbackRetry(args)

    // then the gemini entry is consumed without a session and the retry uses claude-opus-5
    expect(retried).toBe(true)
    expect(queuedModels(args.queuesByKey)).toEqual(["anthropic/claude-opus-5"])
    expect(args.task.attemptCount).toBe(2)
  })

  test("keeps the connected provider when its model list is not cached", async () => {
    // given opencode is connected but the cache has no model list for it
    const args = createArgs(
      { connected: ["opencode"], models: {}, updatedAt: "2026-09-25T00:00:00.000Z" },
      [GEMINI_ENTRY],
    )

    // when
    const retried = await tryFallbackRetry(args)

    // then the previous behavior is preserved because availability is unknown
    expect(retried).toBe(true)
    expect(queuedModels(args.queuesByKey)).toEqual(["opencode/gemini-3.1-pro"])
  })
})
