#!/usr/bin/env node
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  getBuiltinModule<T>(id: string): T
}
type StopReason = "stop" | "toolUse" | "error"

interface Model {
  readonly id: string
}

interface Message {
  readonly content: string | ReadonlyArray<{ readonly text?: string }>
}

interface Context {
  readonly messages?: readonly Message[]
}

interface AssistantMessage {
  readonly role: "assistant"
  readonly content: readonly (
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "toolCall"; readonly id: string; readonly name: string; readonly arguments: Readonly<Record<string, unknown>> }
  )[]
  readonly api: "openai-completions"
  readonly provider: "omo-fallback-mock"
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

interface EventStream extends AsyncIterable<unknown> {
  push(event: unknown): void
  end(message: AssistantMessage): void
  result(): Promise<AssistantMessage>
}

interface ExtensionAPI {
  registerProvider(id: string, provider: {
    readonly name: string
    readonly baseUrl: string
    readonly apiKey: string
    readonly api: "openai-completions"
    readonly models: readonly {
      readonly id: string
      readonly name: string
      readonly reasoning: boolean
      readonly input: readonly ["text"]
      readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number }
      readonly contextWindow: number
      readonly maxTokens: number
    }[]
    streamSimple(model: Model, context: Context): EventStream
  }): void
}

const CHILD_IDENTITY = "running as an omo senpi-task child"
const QUOTA_ERROR = `403: {"message":"You've reached your usage limit for this billing cycle. Your quota will be refreshed in the next cycle.","type":"access_terminated_error"}`
const FINAL_TEXT = "omo e2e fallback child final text"
// Scenarios: "user-fallback" (custom category, user fallback_models), "builtin-chain-fallback"
// (builtin quick rung-1 dead, rung-2 healthy, no user fallback_models), "chain-exhausted"
// (every available rung dead).
const SCENARIO = process.env.OMO_FALLBACK_SCENARIO ?? "user-fallback"
let parentCalls = 0

export default function registerFallbackMockProvider(pi: ExtensionAPI): void {
  pi.registerProvider("omo-fallback-mock", {
    name: "omo runtime fallback mock",
    baseUrl: "file://omo-runtime-fallback-mock",
    apiKey: "mock",
    api: "openai-completions",
    models: [
      mockModel("parent", "Parent"),
      mockModel("dead-primary", "Dead primary"),
      mockModel("healthy-fallback", "Healthy fallback"),
    ],
    streamSimple(model, context) {
      if (isChild(context)) {
        return streamMessage(childReply(model.id))
      }
      parentCalls += 1
      return streamMessage(parentCalls === 1
        ? assistant(model.id, "toolUse", [{
            type: "toolCall",
            id: "fallback-task-call",
            name: "task",
            arguments: {
              category: SCENARIO === "user-fallback" ? "fallbackcat" : "quick",
              prompt: "complete through the configured fallback chain",
              run_in_background: false,
              name: "fallback-child",
            },
          }])
        : assistant(model.id, "stop", [{ type: "text", text: "parent observed fallback completion" }]))
    },
  })

  // Builtin chain fixture providers for the "quick" category: rung 1 (kimi-coding/
  // kimi-for-coding-highspeed) always dies on the child; rung 2 (quotio-openai/gpt-5.4-mini-fast)
  // answers unless the scenario exhausts the chain. quotio-openai needs reasoning so the runtime
  // accepts the rung variant (":minimal") in its fallback selector.
  pi.registerProvider("kimi-coding", {
    name: "omo runtime fallback kimi-coding fixture",
    baseUrl: "file://omo-runtime-fallback-mock",
    apiKey: "mock",
    api: "openai-completions",
    models: [mockModel("kimi-for-coding-highspeed", "Dead chain rung one")],
    streamSimple(model, context) {
      return streamMessage(childReply(model.id))
    },
  })
  pi.registerProvider("quotio-openai", {
    name: "omo runtime fallback quotio-openai fixture",
    baseUrl: "file://omo-runtime-fallback-mock",
    apiKey: "mock",
    api: "openai-completions",
    models: [{ ...mockModel("gpt-5.4-mini-fast", "Chain rung two"), reasoning: true }],
    streamSimple(model, context) {
      return streamMessage(childReply(model.id))
    },
  })

  if (process.env.OMO_FALLBACK_DEBUG_DUMP === "1") {
    const fs = process.getBuiltinModule<typeof import("node:fs")>("node:fs")
    const dump = (label: string) => {
      const registry = (pi as unknown as { modelRegistry?: { getAll(): { provider: string; id: string }[]; find(p: string, i: string): unknown } }).modelRegistry
      const ids = registry?.getAll().map((model) => `${model.provider}/${model.id}`) ?? []
      fs.writeFileSync(`/tmp/fallback-dump-${label}.json`, JSON.stringify({
        label,
        count: ids.length,
        quotio: ids.filter((id) => id.includes("quotio")),
        kimi: ids.filter((id) => id.includes("kimi")),
        mock: ids.filter((id) => id.includes("omo-fallback-mock")),
        findQuotio: registry?.find("quotio-openai", "gpt-5.4-mini-fast") !== undefined,
      }, null, 2))
    }
    dump("t0")
    setTimeout(() => dump("t3s"), 3000)
    setTimeout(() => dump("t8s"), 8000)
  }
}

function childReply(modelId: string): AssistantMessage {
  if (modelId === "healthy-fallback") {
    return assistant(modelId, "stop", [{ type: "text", text: FINAL_TEXT }])
  }
  if (modelId === "gpt-5.4-mini-fast" && SCENARIO !== "chain-exhausted") {
    return assistant(modelId, "stop", [{ type: "text", text: FINAL_TEXT }])
  }
  return assistant(modelId, "error", [], QUOTA_ERROR)
}

function mockModel(id: string, name: string) {
  return {
    id,
    name,
    reasoning: false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  }
}

function isChild(context: Context): boolean {
  return (context.messages ?? []).some((message) => {
    if (typeof message.content === "string") return message.content.includes(CHILD_IDENTITY)
    return message.content.some((part) => part.text?.includes(CHILD_IDENTITY) === true)
  })
}

function assistant(
  model: string,
  stopReason: StopReason,
  content: AssistantMessage["content"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "omo-fallback-mock",
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
  const result = new Promise<AssistantMessage>((resolve) => {
    settle = resolve
  })

  queueMicrotask(() => {
    const event = message.stopReason === "error"
      ? { type: "error", reason: "error", error: message }
      : { type: "done", reason: message.stopReason, message }
    stream.push(event)
    stream.end(message)
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
  return stream
}

if (process.argv[1]?.endsWith("task-runtime-fallback-mock-provider.ts") && process.argv.includes("--self-test")) {
  if (!isChild({ messages: [{ content: `You are ${CHILD_IDENTITY}.` }] })) throw new Error("child detection failed")
  if (isChild({ messages: [{ content: "parent" }] })) throw new Error("parent misclassified")
  console.log("SELF-TEST OK")
}
