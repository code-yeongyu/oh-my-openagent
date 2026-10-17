#!/usr/bin/env node
// Lane-private mock provider for task-terminal-provider-error-qa.mjs (cross-lane contract: named
// after its driver, never the shared mock-provider/). Adds one step vocabulary to the rpc lane's
// shape: `provider_error`, a turn that ends with stopReason "error" and the provider's own
// errorMessage - the senpi#3262 repro class (a stream-start timeout with an exhausted retry
// budget). The sandbox disables in-turn retries (settings retry.maxRetries 0), so the first such
// message is terminal (`willRetry: false`) with no fallback chain configured.
declare const process: {
  argv: string[]
  cwd(): string
  exit(code: number): never
  getBuiltinModule<T>(id: string): T
  env: Record<string, string | undefined>
}

interface FsModule {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: string): string
}

interface PathModule {
  join(...paths: string[]): string
}

interface UrlModule {
  pathToFileURL(path: string): { href: string }
}

const { existsSync, readFileSync } = process.getBuiltinModule<FsModule>("fs")
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const { join } = process.getBuiltinModule<PathModule>("path")
void env

const CHILD_IDENTITY = "running as an omo senpi-task child"

type MockStep =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown>; id?: string }
  | { type: "provider_error"; errorMessage: string }

interface MockScript {
  parentSteps: MockStep[]
  childSteps: MockStep[]
}

type Api = "openai-completions"
type StopReason = "stop" | "toolUse" | "aborted" | "error"

interface Model<TApi extends string = Api> {
  id: string
  api?: TApi
}

interface Message {
  role: string
  content: string | Array<{ type?: string; text?: string }>
}

interface Context {
  cwd?: string
  messages?: Message[]
}

interface SimpleStreamOptions {
  signal?: AbortSignal
}

type AssistantContent =
  | { type: "text"; text: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }

interface AssistantMessage {
  role: "assistant"
  content: AssistantContent[]
  api: Api
  provider: "omo-mock"
  model: string
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number }
  stopReason: StopReason
  errorMessage?: string
  timestamp: number
}

interface MockProvider {
  name: string
  baseUrl: string
  apiKey: string
  api: Api
  models: Array<{
    id: string
    name: string
    reasoning: boolean
    input: Array<"text" | "image">
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
    contextWindow: number
    maxTokens: number
  }>
  streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AsyncIterable<unknown> & {
    result(): Promise<AssistantMessage>
  }
}

interface ExtensionAPI {
  registerProvider(id: string, provider: MockProvider): void
}

interface LocalAssistantMessageEventStream extends AsyncIterable<unknown> {
  push(event: unknown): void
  end(message: AssistantMessage): void
  result(): Promise<AssistantMessage>
}

const model = {
  id: "mock-1",
  name: "Mock 1",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
}

export default function registerMockProvider(pi: ExtensionAPI): void {
  pi.registerProvider("omo-mock", {
    name: "omo mock provider",
    baseUrl: "file://mock-provider",
    apiKey: "mock",
    api: "openai-completions",
    models: [model],
    streamSimple(streamModel: Model<Api>, context: Context, options?: SimpleStreamOptions) {
      return streamMockResponse(streamModel, context, options)
    },
  })
}

function loadMockScript(cwd: string): MockScript {
  const scriptPath = join(cwd, "mock-script.json")
  if (!existsSync(scriptPath)) {
    return { parentSteps: [{ type: "text", text: "no script" }], childSteps: [{ type: "text", text: "child done" }] }
  }
  return JSON.parse(readFileSync(scriptPath, "utf8")) as MockScript
}

function messagesContainChild(context: Context): boolean {
  for (const message of context.messages ?? []) {
    if (typeof message.content === "string") {
      if (message.content.includes(CHILD_IDENTITY)) return true
      continue
    }
    for (const part of message.content) {
      if (typeof part.text === "string" && part.text.includes(CHILD_IDENTITY)) return true
    }
  }
  return false
}

function stepToAssistantMessage(step: MockStep, callCount: number): AssistantMessage {
  const content: AssistantContent[] =
    step.type === "tool_call"
      ? [{ type: "toolCall", id: step.id ?? `omo-mock-tool-${callCount}`, name: step.name, arguments: step.arguments }]
      : [{ type: "text", text: step.type === "text" ? step.text : "" }]
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "omo-mock",
    model: "mock-1",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason: step.type === "tool_call" ? "toolUse" : step.type === "provider_error" ? "error" : "stop",
    ...(step.type === "provider_error" ? { errorMessage: step.errorMessage } : {}),
    timestamp: Date.now(),
  }
}

let parentCallCount = 0
let childCallCount = 0

function isChildTurn(context: Context): boolean {
  if (messagesContainChild(context)) return true
  const sessionDir = process.env.SENPI_CODING_AGENT_SESSION_DIR ?? ""
  return sessionDir.includes("/children/") || sessionDir.includes("\\children\\")
}

function streamMockResponse(
  streamModel: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AsyncIterable<unknown> & { result(): Promise<AssistantMessage> } {
  const stream = createLocalStream()
  const script = loadMockScript(context.cwd ?? process.cwd())
  const isChild = isChildTurn(context)
  const steps = isChild ? script.childSteps : script.parentSteps
  const index = isChild ? childCallCount : parentCallCount
  const step = steps[Math.min(index, steps.length - 1)]
  if (isChild) childCallCount += 1
  else parentCallCount += 1
  const message = stepToAssistantMessage(step, index + 1)

  if (step.type === "provider_error") {
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message })
      stream.push({ type: "error", reason: "error", error: message })
      stream.end(message)
    })
    return stream
  }

  queueMicrotask(() => {
    if (options?.signal?.aborted) {
      const aborted = { ...message, stopReason: "aborted" as const }
      stream.push({ type: "error", reason: "aborted", error: aborted })
      stream.end(aborted)
      return
    }
    stream.push({ type: "start", partial: { ...message, content: [] } })
    if (step.type === "text") {
      const partial = { ...message, content: [{ type: "text" as const, text: "" }] }
      stream.push({ type: "text_start", contentIndex: 0, partial })
      stream.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: message })
      stream.push({ type: "text_end", contentIndex: 0, content: step.text, partial: message })
    } else {
      const toolCall = message.content[0]
      stream.push({ type: "toolcall_start", contentIndex: 0, partial: { ...message, content: [] } })
      stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: message })
      stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message })
    }
    stream.push({ type: "done", reason: message.stopReason, message })
    stream.end(message)
  })
  return stream
}

function createLocalStream(): LocalAssistantMessageEventStream {
  const queue: unknown[] = []
  const waiters: Array<(result: IteratorResult<unknown>) => void> = []
  let finalMessage: AssistantMessage | undefined
  let ended = false

  const notify = (): void => {
    while (waiters.length > 0 && queue.length > 0) {
      const waiter = waiters.shift()
      waiter?.({ value: queue.shift(), done: false })
    }
    if (ended && queue.length === 0) {
      while (waiters.length > 0) waiters.shift()?.({ value: undefined, done: true })
    }
  }

  return {
    push(event: unknown): void {
      queue.push(event)
      notify()
    },
    end(message: AssistantMessage): void {
      finalMessage = message
      ended = true
      notify()
    },
    result(): Promise<AssistantMessage> {
      if (finalMessage === undefined) return Promise.reject(new Error("stream ended without a message"))
      return Promise.resolve(finalMessage)
    },
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false })
          if (ended) return Promise.resolve({ value: undefined, done: true })
          return new Promise((resolve) => waiters.push(resolve))
        },
      }
    },
  }
}
