import type { AgentSessionEvent, CreateAgentSessionOptions } from "@code-yeongyu/senpi"
import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"

import { createAgentSession, ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"

export const FALLBACK_PROVIDER = "omo-mock"
export const DEAD_PRIMARY = "dead-primary"
export const HEALTHY_FALLBACK = "healthy-fallback"

type RungBehavior = "error" | "stop"

type AssistantMessage = {
  readonly role: "assistant"
  readonly content: readonly { readonly type: "text"; readonly text: string }[]
  readonly api: "openai-completions"
  readonly provider: typeof FALLBACK_PROVIDER
  readonly model: string
  readonly usage: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
    readonly totalTokens: number
    readonly cost: number
  }
  readonly stopReason: RungBehavior
  readonly errorMessage?: string
  readonly timestamp: number
}

type EventStream = AsyncIterable<unknown> & {
  push(event: unknown): void
  end(message: AssistantMessage): void
  result(): Promise<AssistantMessage>
}

export type FallbackProviderHarness = {
  /** The registry snapshot the judge launch input carries; both rungs are registered on it. */
  readonly registry: ChildModelRegistry
  /** Model ids in the order the engine actually called the provider. */
  readonly calls: readonly string[]
  /** Every event the real child session emitted. */
  readonly events: readonly AgentSessionEvent[]
  /**
   * The runner's session seam: the REAL senpi session built from the options the judge spec
   * produced, plus the model runtime that owns the fake provider (an in-process child without a
   * parent runtime cannot execute a registry-registered provider).
   */
  readonly createSession: (options: CreateAgentSessionOptions) => Promise<Awaited<ReturnType<typeof createAgentSession>>["session"]>
}

/**
 * A live senpi engine fed by a fake provider: `dead-primary` answers as configured (503 by default),
 * `healthy-fallback` answers per `fallback`. The judge under test decides whether the chain rotates.
 */
export function fallbackProviderHarness(input: { readonly errorMessage: string; readonly fallback: RungBehavior }): FallbackProviderHarness {
  const modelRuntime = ModelRuntime.createSync({ modelsPath: null })
  const registry = new ModelRegistry(modelRuntime)
  const calls: string[] = []
  const events: AgentSessionEvent[] = []
  const provider = {
    api: "openai-completions",
    baseUrl: "file://kibitzer-fallback-test",
    apiKey: "test-key",
    models: [testModel(DEAD_PRIMARY), testModel(HEALTHY_FALLBACK)],
    streamSimple(model: { readonly id: string }) {
      calls.push(model.id)
      const behavior: RungBehavior = model.id === DEAD_PRIMARY ? "error" : input.fallback
      return streamMessage(behavior === "error"
        ? assistant(model.id, "error", "", input.errorMessage)
        : assistant(model.id, "stop", "no nudge"))
    },
  }
  Reflect.apply(registry.registerProvider, registry, [FALLBACK_PROVIDER, provider])
  const createSession = async (options: CreateAgentSessionOptions) => {
    const { session } = await createAgentSession({ ...options, modelRuntime })
    session.subscribe((event) => { events.push(event) })
    return session
  }
  return { registry, calls, events, createSession }
}

function testModel(id: string) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"] as Array<"text">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  }
}

function assistant(model: string, stopReason: RungBehavior, text: string, errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    content: text === "" ? [] : [{ type: "text", text }],
    api: "openai-completions",
    provider: FALLBACK_PROVIDER,
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: Date.now(),
  }
}

function streamMessage(message: AssistantMessage): EventStream {
  const queue: unknown[] = []
  const waiters: Array<(value: IteratorResult<unknown>) => void> = []
  let done = false
  let settle: (value: AssistantMessage) => void = () => {}
  const result = new Promise<AssistantMessage>((resolve) => { settle = resolve })
  const stream: EventStream = {
    push(event) {
      if (done) return
      const waiter = waiters.shift()
      if (waiter === undefined) queue.push(event)
      else waiter({ value: event, done: false })
    },
    end(value) {
      if (done) return
      done = true
      settle(value)
      for (const waiter of waiters.splice(0)) waiter({ value: undefined, done: true })
    },
    result: () => result,
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false })
          if (done) return Promise.resolve({ value: undefined, done: true })
          return new Promise<IteratorResult<unknown>>((resolve) => waiters.push(resolve))
        },
      }
    },
  }
  queueMicrotask(() => {
    stream.push(message.stopReason === "error"
      ? { type: "error", reason: "error", error: message }
      : { type: "done", reason: "stop", message })
    stream.end(message)
  })
  return stream
}
