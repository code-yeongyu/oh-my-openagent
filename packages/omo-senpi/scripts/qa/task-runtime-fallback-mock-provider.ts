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
// Usage-limit scenarios (#8296): "limit-account" spends the whole mock account (every omo-fallback-mock
// model answers a session limit, only omo-fallback-other serves); "limit-model" caps only limit-fable.
const LIMIT_ERRORS: Readonly<Record<string, string>> = {
  "limit-account": "You've hit your session limit · resets 3pm (Asia/Seoul)",
  "limit-model": "You've hit your Fable weekly limit · resets Oct 2, 9am",
}
// "limit-after-tool" (#9512): the child's primary first makes a tool call, then hits a usage limit on
// the request that carries the tool result, so the fallback has to happen inside the running turn.
const LIMIT_AFTER_TOOL = "limit-after-tool"
const LIMIT_AFTER_TOOL_ERROR = "You've hit your session limit · resets 3pm (Asia/Seoul)"
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
      mockModel("limit-fable", "Usage-limited primary"),
      mockModel("limit-opus", "Same-account sibling"),
      mockModel("limit-after-tool", "Primary limited after a tool call"),
    ],
    streamSimple(model, context) {
      if (isChild(context)) {
        return streamMessage(childReply(model.id, context))
      }
      parentCalls += 1
      return streamMessage(parentCalls === 1
        ? assistant(model.id, "toolUse", [{
            type: "toolCall",
            id: "fallback-task-call",
            name: "task",
            arguments: {
              category: SCENARIO === "user-fallback"
                ? "fallbackcat"
                : SCENARIO === LIMIT_AFTER_TOOL ? "toolcat" : SCENARIO in LIMIT_ERRORS ? "limitcat" : "quick",
              prompt: "complete through the configured fallback chain",
              run_in_background: false,
              name: "fallback-child",
            },
          }])
        : assistant(model.id, "stop", [{ type: "text", text: "parent observed fallback completion" }]))
    },
  })

  // Builtin chain fixture providers for the "quick" category: rung 1 (chatgpt-subscription/
  // gpt-6-luna-fast) always dies on the child; rung 2 (deepseek/deepseek-flash) answers
  // unless the scenario exhausts the chain. Both fixtures declare reasoning so the runtime
  // accepts the rung variants ("low" / "off") in its fallback selector.
  pi.registerProvider("chatgpt-subscription", {
    name: "omo runtime fallback chatgpt subscription fixture",
    baseUrl: "file://omo-runtime-fallback-mock",
    apiKey: "mock",
    api: "openai-completions",
    models: [{ ...mockModel("gpt-6-luna-fast", "Dead chain rung one"), reasoning: true }],
    streamSimple(model, context) {
      return streamMessage(childReply(model.id))
    },
  })
  pi.registerProvider("omo-fallback-other", {
    name: "omo runtime fallback second provider",
    baseUrl: "file://omo-runtime-fallback-mock",
    apiKey: "mock",
    api: "openai-completions",
    models: [mockModel("limit-kimi", "Other-provider rung")],
    streamSimple(model, context) {
      return streamMessage(childReply(model.id))
    },
  })
  pi.registerProvider("deepseek", {
    name: "omo runtime fallback deepseek fixture",
    baseUrl: "file://omo-runtime-fallback-mock",
    apiKey: "mock",
    api: "openai-completions",
    models: [{ ...mockModel("deepseek-flash", "Chain rung two"), reasoning: true }],
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
        quick: ids.filter((id) => id.includes("chatgpt-subscription") || id.includes("deepseek")),
        mock: ids.filter((id) => id.includes("omo-fallback-mock")),
        findQuickPrimary: registry?.find("chatgpt-subscription", "gpt-6-luna-fast") !== undefined,
      }, null, 2))
    }
    dump("t0")
    setTimeout(() => dump("t3s"), 3000)
    setTimeout(() => dump("t8s"), 8000)
  }
}

function childReply(modelId: string, context: Context): AssistantMessage {
  if (SCENARIO === LIMIT_AFTER_TOOL && modelId === LIMIT_AFTER_TOOL) {
    return hasToolResult(context)
      ? assistant(modelId, "error", [], LIMIT_AFTER_TOOL_ERROR)
      : assistant(modelId, "toolUse", [{
          type: "toolCall",
          id: "limit-after-tool-call",
          name: "bash",
          arguments: { command: "printf limit-after-tool-ran" },
        }])
  }
  const limitError = LIMIT_ERRORS[SCENARIO]
  if (limitError !== undefined) {
    const spent = modelId === "limit-fable" || (modelId === "limit-opus" && SCENARIO === "limit-account")
    return spent ? assistant(modelId, "error", [], limitError) : assistant(modelId, "stop", [{ type: "text", text: FINAL_TEXT }])
  }
  if (modelId === "healthy-fallback") {
    return assistant(modelId, "stop", [{ type: "text", text: FINAL_TEXT }])
  }
  if (modelId === "deepseek-flash" && SCENARIO !== "chain-exhausted") {
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

// The identity line is written by the in-process subagent prompt only. A per-child process and a
// task daemon session both run senpi in `--mode rpc` while the driver's parent runs `-p`, so the rpc
// argv is the structural child signal there (the same selector task-e2e-mock-provider.ts uses).
function isChild(context: Context): boolean {
  return messagesContainChild(context) || process.argv.includes("rpc")
}

function hasToolResult(context: Context): boolean {
  return (context.messages ?? []).some((message) => (message as { readonly role?: string }).role === "toolResult")
}

function messagesContainChild(context: Context): boolean {
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
