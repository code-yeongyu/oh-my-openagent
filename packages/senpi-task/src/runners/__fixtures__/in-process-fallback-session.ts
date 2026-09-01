import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentSessionEvent, createAgentSession } from "@code-yeongyu/senpi"

import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { createMinimalSenpiResourceLoader } from "../../senpi/minimal-resource-loader"
import { createRuntimeFallbackSettings } from "../in-process/runtime-fallback-settings"

type StopReason = "stop" | "error"

type AssistantMessage = {
  readonly role: "assistant"
  readonly content: readonly { readonly type: "text"; readonly text: string }[]
  readonly api: "openai-completions"
  readonly provider: "runtime-fallback-test"
  readonly model: string
  readonly usage: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
    readonly totalTokens: number
    readonly cost: number
  }
  readonly stopReason: StopReason
  readonly errorMessage?: string
  readonly timestamp: number
}

type EventStream = AsyncIterable<unknown> & {
  push(event: unknown): void
  end(message: AssistantMessage): void
  result(): Promise<AssistantMessage>
}

export type FallbackSessionHarness = {
  readonly calls: readonly string[]
  readonly events: readonly AgentSessionEvent[]
  readonly session: Awaited<ReturnType<typeof createAgentSession>>["session"]
  dispose(): void
}

export async function createFallbackSessionHarness(errorMessage: string): Promise<FallbackSessionHarness> {
  const {
    createAgentSession,
    ModelRegistry,
    ModelRuntime,
    SessionManager,
    createExtensionRuntime,
  } = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "senpi-task-access-terminated-"))
  const modelRuntime = ModelRuntime.createSync()
  const modelRegistry = new ModelRegistry(modelRuntime)
  const calls: string[] = []
  const provider = {
    api: "openai-completions",
    baseUrl: "file://runtime-fallback-test",
    apiKey: "test-key",
    models: [
      testModel("dead-primary"),
      testModel("healthy-fallback"),
    ],
    streamSimple(model: { readonly id: string }) {
      calls.push(model.id)
      return streamMessage(
        model.id === "dead-primary"
          ? assistant(model.id, "error", "", errorMessage)
          : assistant(model.id, "stop", "fallback completed"),
      )
    },
  }
  Reflect.apply(modelRegistry.registerProvider, modelRegistry, ["runtime-fallback-test", provider])
  const primary = modelRegistry.find("runtime-fallback-test", "dead-primary")
  if (primary === undefined) throw new Error("primary model missing")
  const settingsManager = createRuntimeFallbackSettings(
    "runtime-fallback-test/dead-primary",
    [{
      source: "category",
      provider: "runtime-fallback-test",
      model_id: "healthy-fallback",
      display: "runtime-fallback-test/healthy-fallback",
    }],
  )
  if (settingsManager === undefined) throw new Error("fallback settings missing")
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: join(root, "agent"),
    model: primary,
    modelRuntime,
    modelRegistry,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
    resourceLoader: createMinimalSenpiResourceLoader({
      runtime: createExtensionRuntime(),
    }),
    tools: [],
    customTools: [],
    scopedModels: [],
    favoriteModels: [],
  })
  const events: AgentSessionEvent[] = []
  const unsubscribe = session.subscribe((event) => events.push(event))
  return {
    calls,
    events,
    session,
    dispose() {
      unsubscribe()
      session.dispose()
      rmSync(root, { recursive: true, force: true })
    },
  }
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

function assistant(
  model: string,
  stopReason: StopReason,
  text: string,
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: text === "" ? [] : [{ type: "text", text }],
    api: "openai-completions",
    provider: "runtime-fallback-test",
    model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: 0,
    },
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
  const result = new Promise<AssistantMessage>((resolve) => {
    settle = resolve
  })
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
    const event = message.stopReason === "error"
      ? { type: "error", reason: "error", error: message }
      : { type: "done", reason: "stop", message }
    stream.push(event)
    stream.end(message)
  })
  return stream
}
