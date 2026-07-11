#!/usr/bin/env node
// Lane-private mock provider for task-e2e.mjs (cross-lane contract: named after its driver, never the
// shared mock-provider/). Branches PARENT vs CHILD turns on the harness-injected child identity line so
// a background child's in-process streamSimple calls never consume the parent's scripted tool sequence.
declare const process: {
  argv: string[]
  cwd(): string
  getBuiltinModule<T>(id: string): T
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
const { join } = process.getBuiltinModule<PathModule>("path")
const { pathToFileURL } = process.getBuiltinModule<UrlModule>("url")

// The child identity line lives ONLY in a child session's message thread (buildSubagentPrompt). The
// parent's task tool-call arguments never contain it, so this is a leak-proof parent/child selector.
const CHILD_IDENTITY = "running as an omo senpi-task child"

type MockStep =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown>; id?: string }

interface MockScript {
  parentSteps: MockStep[]
  childSteps: MockStep[]
  customMessages?: ReadonlyArray<{
    readonly customType: string
    readonly content: string
    readonly details: Readonly<Record<string, unknown>>
  }>
}

type Api = "openai-completions"
type StopReason = "stop" | "toolUse" | "aborted"

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
  model: "mock-1"
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number }
  stopReason: StopReason
  timestamp: number
}

interface MockModel {
  id: string
  name: string
  reasoning: boolean
  input: Array<"text" | "image">
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow: number
  maxTokens: number
}

interface MockProvider {
  name: string
  baseUrl: string
  apiKey: string
  api: Api
  models: MockModel[]
  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AsyncIterable<unknown> & { result(): Promise<AssistantMessage> }
}

interface ExtensionAPI {
  registerProvider(id: string, provider: MockProvider): void
  on?(event: string, handler: () => void): void
  sendMessage?(message: Record<string, unknown>, options?: Record<string, unknown>): void
}

interface LocalAssistantMessageEventStream extends AsyncIterable<unknown> {
  push(event: unknown): void
  end(message: AssistantMessage): void
  result(): Promise<AssistantMessage>
}

const model: MockModel = {
  id: "mock-1",
  name: "Mock 1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 16_000,
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
  if (pi.on === undefined || pi.sendMessage === undefined) return
  pi.on("session_start", () => {
    const script = loadMockScript(process.cwd())
    for (const message of script.customMessages ?? []) {
      pi.sendMessage?.(
        { customType: message.customType, content: message.content, display: true, details: message.details },
        {},
      )
    }
  })
}

export function loadMockScript(cwd: string): MockScript {
  const scriptPath = join(cwd, "mock-script.json")
  if (!existsSync(scriptPath)) {
    return { parentSteps: [{ type: "text", text: "no script" }], childSteps: [{ type: "text", text: "child done" }] }
  }
  const parsed = JSON.parse(readFileSync(scriptPath, "utf8")) as MockScript
  return parsed
}

export function messagesContainChild(context: Context): boolean {
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

export function stepToAssistantMessage(step: MockStep, callCount: number): AssistantMessage {
  const content: AssistantContent[] =
    step.type === "text"
      ? [{ type: "text", text: step.text }]
      : [{ type: "toolCall", id: step.id ?? `omo-mock-tool-${callCount}`, name: step.name, arguments: step.arguments }]
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "omo-mock",
    model: "mock-1",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason: step.type === "tool_call" ? "toolUse" : "stop",
    timestamp: Date.now(),
  }
}

let parentCallCount = 0
let childCallCount = 0

function streamMockResponse(_model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
  const stream = createLocalAssistantMessageEventStream()
  const script = loadMockScript(context.cwd ?? process.cwd())
  const isChild = messagesContainChild(context)
  const steps = isChild ? script.childSteps : script.parentSteps
  const index = isChild ? childCallCount : parentCallCount
  const step = steps[Math.min(index, steps.length - 1)]
  if (isChild) childCallCount += 1
  else parentCallCount += 1
  const message = stepToAssistantMessage(step, index + 1)

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

function createLocalAssistantMessageEventStream(): LocalAssistantMessageEventStream {
  const queue: unknown[] = []
  const waiters: Array<(value: IteratorResult<unknown>) => void> = []
  let done = false
  let settleResult: (message: AssistantMessage) => void = () => {}
  const finalMessage = new Promise<AssistantMessage>((resolve) => {
    settleResult = resolve
  })
  finalMessage.catch(() => {})

  return {
    push(event: unknown) {
      if (done) return
      if (isTerminalAssistantMessageEvent(event)) {
        done = true
        settleResult(extractAssistantMessageResult(event))
      }
      const waiter = waiters.shift()
      if (waiter) waiter({ value: event, done: false })
      else queue.push(event)
    },
    end(message: AssistantMessage) {
      if (done) return
      done = true
      settleResult(message)
      while (waiters.length > 0) {
        const waiter = waiters.shift()
        if (waiter) waiter({ value: undefined, done: true })
      }
    },
    result() {
      return finalMessage
    },
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
}

function isTerminalAssistantMessageEvent(
  event: unknown,
): event is { type: "done"; message: AssistantMessage } | { type: "error"; error: AssistantMessage } {
  if (typeof event !== "object" || event === null) return false
  const candidate = event as { type?: unknown; message?: unknown; error?: unknown }
  if (candidate.type === "done") return isAssistantMessage(candidate.message)
  if (candidate.type === "error") return isAssistantMessage(candidate.error)
  return false
}

function extractAssistantMessageResult(
  event: { type: "done"; message: AssistantMessage } | { type: "error"; error: AssistantMessage },
): AssistantMessage {
  return event.type === "done" ? event.message : event.error
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { role?: unknown; content?: unknown; stopReason?: unknown }
  return candidate.role === "assistant" && Array.isArray(candidate.content) && typeof candidate.stopReason === "string"
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    // given a parent tool step
    const parent = stepToAssistantMessage({ type: "tool_call", name: "task", arguments: {} }, 1)
    // then it stops with toolUse
    if (parent.stopReason !== "toolUse") throw new Error("tool step must stop with toolUse")
    // given a child-identity context / when detected / then true
    const childCtx: Context = { messages: [{ role: "user", content: `You are ${CHILD_IDENTITY}. Task: x` }] }
    if (!messagesContainChild(childCtx)) throw new Error("child identity detection failed")
    // given a parent context / when detected / then false
    const parentCtx: Context = { messages: [{ role: "user", content: "ulw parent prompt" }] }
    if (messagesContainChild(parentCtx)) throw new Error("parent must not detect child identity")
    console.log("SELF-TEST OK")
  }
}
