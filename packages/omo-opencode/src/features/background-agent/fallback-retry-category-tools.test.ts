import { expect, mock, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"
import { tryFallbackRetry } from "./fallback-retry-handler"
import type { BackgroundTask } from "./types"

test("preserves category tools in fallback retry input", async () => {
  const fallbackChain: FallbackEntry[] = [
    { model: "fallback-model", providers: ["provider-a"], variant: undefined },
  ]
  const task: BackgroundTask = {
    id: "task-category-tools",
    description: "category tools",
    prompt: "check tools",
    agent: "sisyphus-junior",
    status: "error",
    parentSessionId: "ses_parent",
    parentMessageId: "msg_parent",
    fallbackChain,
    attemptCount: 0,
    concurrencyKey: "provider-a/original-model",
    model: { providerID: "provider-a", modelID: "original-model" },
    sessionPermission: [
      { permission: "grep", action: "deny", pattern: "*" },
      { permission: "question", action: "deny", pattern: "*" },
    ],
    categoryTools: { grep: false },
  }
  const queuesByKey = new Map<string, QueueItem[]>()
  const processKey = mock(() => {})

  await tryFallbackRetry({
    task,
    errorInfo: { name: "OverloadedError", message: "model overloaded" },
    source: "polling",
    concurrencyManager: unsafeTestValue<ConcurrencyManager>({
      release: mock(() => {}),
      getConcurrencyKey: mock((key: string) => key),
    }),
    client: unsafeTestValue<OpencodeClient>({
      session: { abort: mock(async () => ({})) },
    }),
    idleDeferralTimers: new Map(),
    queuesByKey,
    processKey,
    deps: {
      shouldRetryError: mock(() => true),
      hasMoreFallbacks: mock((chain: FallbackEntry[], attempt: number) => attempt < chain.length),
      getNextFallback: mock((chain: FallbackEntry[], attempt: number) => chain[attempt]),
      readProviderModelsCache: mock(() => null),
      readConnectedProvidersCache: mock(() => null),
      selectFallbackProvider: mock((providers: string[]) => providers[0]),
      transformModelForProvider: mock((_provider: string, model: string) => model),
    },
  })

  const key = `${task.model?.providerID}/${task.model?.modelID}`
  const retryInput = queuesByKey.get(key)?.[0]?.input
  expect(retryInput?.categoryTools).toEqual({ grep: false })
  expect(retryInput?.sessionPermission).toEqual([
    { permission: "grep", action: "deny", pattern: "*" },
    { permission: "question", action: "deny", pattern: "*" },
  ])
  expect(processKey).toHaveBeenCalledWith(key)
})
