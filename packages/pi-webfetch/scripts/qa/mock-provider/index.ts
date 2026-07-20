#!/usr/bin/env node
// allow: SIZE_OK - one-process manual QA mock provider keeps SSE, health, and chat endpoints in one launched fixture.
declare const process: {
  argv: string[]
  cwd(): string
  getBuiltinModule<T>(id: string): T
}

interface FsModule {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: string): string
  rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void
  writeFileSync(path: string, data: string): void
}

interface PathModule {
  dirname(path: string): string
  join(...paths: string[]): string
}

interface UrlModule {
  fileURLToPath(url: string | { href: string }): string
  pathToFileURL(path: string): { href: string }
}

const { existsSync, readFileSync, rmSync, writeFileSync } = process.getBuiltinModule<FsModule>("fs")
const { dirname, join } = process.getBuiltinModule<PathModule>("path")
const { fileURLToPath, pathToFileURL } = process.getBuiltinModule<UrlModule>("url")

type MockStep =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown>; id?: string }

interface MockScript {
  steps: MockStep[]
}

type LocalStreamEvent = unknown

type Api = "openai-completions"
type StopReason = "stop" | "toolUse" | "aborted"

interface Model<TApi extends string = Api> {
  id: string
  api?: TApi
}

interface Context {
  cwd?: string
  messages?: Array<{ role?: string }>
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
  streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AsyncIterable<LocalStreamEvent> & {
    result(): Promise<AssistantMessage>
  }
}

interface ExtensionAPI {
  registerProvider(id: string, provider: MockProvider): void
}

interface LocalAssistantMessageEventStream extends AsyncIterable<LocalStreamEvent> {
  push(event: LocalStreamEvent): void
  end(message: AssistantMessage): void
  fail(error: unknown): void
  result(): Promise<AssistantMessage>
}

const model = {
  id: "mock-1",
  name: "Mock 1",
  reasoning: false,
  input: ["text" as const],
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
}

export function loadMockScript(cwd: string): MockScript {
  const scriptPath = join(cwd, "mock-script.json")
  if (!existsSync(scriptPath)) {
    return { steps: [{ type: "text", text: "omo mock provider default response" }] }
  }

  const parsed = JSON.parse(readFileSync(scriptPath, "utf8")) as unknown
  if (!isMockScript(parsed)) {
    throw new Error(`${scriptPath} must contain {"steps":[...]} with text or tool_call steps`)
  }
  return parsed
}

export function stepToAssistantMessage(step: MockStep, callCount: number): AssistantMessage {
  const content =
    step.type === "text"
      ? [{ type: "text" as const, text: step.text }]
      : [
          {
            type: "toolCall" as const,
            id: step.id ?? `omo-mock-tool-${callCount}`,
            name: step.name,
            arguments: step.arguments,
          },
        ]

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

let callCount = 0

function streamMockResponse(_model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
  const stream = createLocalAssistantMessageEventStream()
  const script = loadMockScript(context.cwd ?? process.cwd())
  // Select the step from the conversation shape instead of a global call
  // counter so out-of-band model calls cannot consume scripted steps.
  const assistantMessageCount = (context.messages ?? []).filter((message) => message.role === "assistant").length
  const step = script.steps[Math.min(assistantMessageCount, script.steps.length - 1)]
  callCount += 1
  const message = stepToAssistantMessage(step, callCount)

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

export function createLocalAssistantMessageEventStream(): LocalAssistantMessageEventStream {
  const queue: LocalStreamEvent[] = []
  const waiters: Array<(value: IteratorResult<LocalStreamEvent>) => void> = []
  let done = false
  let settleResult: (message: AssistantMessage) => void = () => {}
  let rejectResult: (error: unknown) => void = () => {}
  const finalMessage = new Promise<AssistantMessage>((resolve, reject) => {
    settleResult = resolve
    rejectResult = reject
  })
  finalMessage.catch(() => {})

  return {
    push(event: LocalStreamEvent) {
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
    fail(error: unknown) {
      if (done) return
      done = true
      rejectResult(error)
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
          return new Promise<IteratorResult<LocalStreamEvent>>((resolve) => waiters.push(resolve))
        },
      }
    },
  }
}

function isTerminalAssistantMessageEvent(
  event: LocalStreamEvent,
): event is { type: "done"; message: AssistantMessage } | { type: "error"; error: AssistantMessage } {
  if (typeof event !== "object" || event === null) return false
  const candidate = event as { type?: unknown; message?: unknown; error?: unknown }
  if (candidate.type === "done") return isAssistantMessage(candidate.message)
  if (candidate.type === "error") return isAssistantMessage(candidate.error)
  return false
}

function extractAssistantMessageResult(event: { type: "done"; message: AssistantMessage } | { type: "error"; error: AssistantMessage }) {
  return event.type === "done" ? event.message : event.error
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { role?: unknown; content?: unknown; stopReason?: unknown }
  return candidate.role === "assistant" && Array.isArray(candidate.content) && typeof candidate.stopReason === "string"
}

function isMockScript(value: unknown): value is MockScript {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { steps?: unknown }).steps)) return false
  return (value as { steps: unknown[] }).steps.every(isMockStep)
}

function isMockStep(value: unknown): value is MockStep {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.type === "text") return typeof candidate.text === "string"
  if (candidate.type !== "tool_call") return false
  return typeof candidate.name === "string" && typeof candidate.arguments === "object" && candidate.arguments !== null
}

export async function selfTest(): Promise<void> {
  const tmp = dirname(fileURLToPath(import.meta.url))
  const scriptPath = join(tmp, "mock-script.json")
  const previous = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : undefined
  let capturedProvider: MockProvider | undefined
  try {
    writeFileSync(
      scriptPath,
      JSON.stringify({
        steps: [
          { type: "text", text: "hello" },
          { type: "tool_call", name: "write", arguments: { path: "x.ts", content: "const x = 1\n" } },
        ],
      }),
    )
    const script = loadMockScript(tmp)
    if (script.steps.length !== 2) throw new Error("expected two mock steps")
    if (stepToAssistantMessage(script.steps[0], 1).content[0]?.type !== "text") throw new Error("text step failed")
    const toolMessage = stepToAssistantMessage(script.steps[1], 2)
    if (toolMessage.content[0]?.type !== "toolCall") throw new Error("tool step failed")
    if (toolMessage.stopReason !== "toolUse") throw new Error("tool step must stop with toolUse")

    registerMockProvider({
      registerProvider(_id: string, provider: MockProvider) {
        capturedProvider = provider
      },
    })
    if (capturedProvider === undefined) throw new Error("mock provider was not registered")

    capturedProvider.streamSimple(model, { cwd: tmp })
    const stream = capturedProvider.streamSimple(model, { cwd: tmp })
    const events: LocalStreamEvent[] = []
    for await (const event of stream) events.push(event)
    const result = await stream.result()
    if (result.stopReason !== "toolUse") throw new Error("stream result must stop with toolUse")
    if (result.content[0]?.type !== "toolCall") throw new Error("stream result must contain toolCall content")
    if (!events.some((event) => isDoneToolUseEvent(event))) throw new Error("stream must emit done/toolUse")
  } finally {
    if (previous === undefined) {
      rmSync(scriptPath, { force: true })
    } else {
      writeFileSync(scriptPath, previous)
    }
  }
}

function isDoneToolUseEvent(event: LocalStreamEvent): boolean {
  if (typeof event !== "object" || event === null) return false
  const candidate = event as { type?: unknown; reason?: unknown }
  return candidate.type === "done" && candidate.reason === "toolUse"
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    await selfTest()
    console.log("SELF-TEST OK")
  }
}
