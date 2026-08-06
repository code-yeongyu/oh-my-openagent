#!/usr/bin/env node
// Lane-private mock provider for task-resume-e2e.mjs (cross-lane contract: named after its driver,
// never the shared mock-provider/). Parent turns follow the scripted parentSteps sequence, one per
// model call. Child turns route on message CONTENT, not call order: a quit kills the process and
// the resumed process's counters reset, so only the persisted thread itself can deterministically
// pick a revived child's next response.
declare const process: {
  argv: string[]
  cwd(): string
  exit(code: number): never
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

const CHILD_IDENTITY = "running as an omo senpi-task child"

// Token contract mirrored by task-resume-e2e-scenarios.mjs; resume-e2e-runtime.test.mjs pins equality.
export const CONTINUATION_MARKER = "interrupted by a host process restart"
export const PING_TOKEN = "RESUME_PING_TOKEN"
export const PONG_TOKEN = "RESUME_PONG_TOKEN"
export const MIDTURN_CONTINUED_TOKEN = "MIDTURN_CONTINUED_TOKEN"
export const FINISHED_CHILD_TOKEN = "FINISHED_CHILD_DONE"
export const CANCEL_CHILD_TOKEN = "CANCEL_CHILD_DONE"
export const LRU_CHILD_TOKEN = "LRU_CHILD_DONE"
export const TTL_CHILD_TOKEN = "TTL_CHILD_DONE"

type MockStep =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown>; id?: string }
  | { type: "hang" }

interface MockScript {
  parentSteps: Array<Exclude<MockStep, { type: "hang" }>>
}

type StopReason = "stop" | "toolUse" | "aborted"

interface MessagePart {
  type?: string
  text?: string
}

interface Message {
  role: string
  content: string | MessagePart[]
}

interface Context {
  cwd?: string
  messages?: Message[]
}

interface SimpleStreamOptions {
  signal?: AbortSignal
}

type AssistantContent = { type: "text"; text: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }

interface AssistantMessage {
  role: "assistant"
  content: AssistantContent[]
  api: "openai-completions"
  provider: "omo-mock"
  model: "mock-1"
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number }
  stopReason: StopReason
  timestamp: number
}

interface ExtensionAPI {
  registerProvider(id: string, provider: {
    name: string
    baseUrl: string
    apiKey: string
    api: "openai-completions"
    models: Array<{ id: string; name: string; reasoning: boolean; input: Array<"text" | "image">; cost: { input: number; output: number; cacheRead: number; cacheWrite: number }; contextWindow: number; maxTokens: number }>
    streamSimple(model: { id: string }, context: Context, options?: SimpleStreamOptions): AsyncIterable<unknown> & { result(): Promise<AssistantMessage> }
  }): void
}

const model = { id: "mock-1", name: "Mock 1", reasoning: false, input: ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 4096 }

export default function registerMockProvider(pi: ExtensionAPI): void {
  pi.registerProvider("omo-mock", {
    name: "omo mock provider",
    baseUrl: "file://mock-provider",
    apiKey: "mock",
    api: "openai-completions",
    models: [model],
    streamSimple: (_streamModel, context, options) => streamMockResponse(context, options),
  })
}

function loadMockScript(cwd: string): MockScript {
  const scriptPath = join(cwd, "mock-script.json")
  if (!existsSync(scriptPath)) return { parentSteps: [{ type: "text", text: "no script" }] }
  return JSON.parse(readFileSync(scriptPath, "utf8")) as MockScript
}

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content
  return message.content.map((part) => (typeof part.text === "string" ? part.text : "")).join("\n")
}

function threadText(context: Context): string {
  return (context.messages ?? []).map(messageText).join("\n")
}

function lastUserText(context: Context): string {
  const users = (context.messages ?? []).filter((message) => message.role === "user")
  const last = users[users.length - 1]
  return last === undefined ? "" : messageText(last)
}

function isChild(context: Context): boolean {
  return threadText(context).includes(CHILD_IDENTITY)
}

// Child routing. The continuation nudge and the post-resume task_send are followUp USER messages,
// so they win first; the initial-prompt branches only ever see the child's first turn(s).
export function routeChildStep(context: Context): MockStep {
  const lastUser = lastUserText(context)
  if (lastUser.includes(CONTINUATION_MARKER)) return { type: "text", text: MIDTURN_CONTINUED_TOKEN }
  if (lastUser.includes(PING_TOKEN)) return { type: "text", text: `${PONG_TOKEN} steerability proven` }
  const thread = threadText(context)
  const hasAssistant = (context.messages ?? []).some((message) => message.role === "assistant")
  if (thread.includes("midturn-child")) {
    // Turn one persists an assistant message via an instant read; turn two hangs MID-TURN at the
    // model so the quit suspends a child that already owns a session file (never fresh-relaunch).
    return hasAssistant
      ? { type: "hang" }
      : { type: "tool_call", name: "read", arguments: { path: "mock-script.json" } }
  }
  if (thread.includes("finished-child")) return { type: "text", text: FINISHED_CHILD_TOKEN }
  if (thread.includes("cancel-child")) return { type: "text", text: CANCEL_CHILD_TOKEN }
  if (thread.includes("lru-child")) return { type: "text", text: LRU_CHILD_TOKEN }
  if (thread.includes("ttl-child")) return { type: "text", text: TTL_CHILD_TOKEN }
  return { type: "text", text: "resume child fallback" }
}

let parentCallCount = 0

function stepToAssistantMessage(step: Exclude<MockStep, { type: "hang" }>, callCount: number): AssistantMessage {
  const content: AssistantContent[] = step.type === "text"
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

function streamMockResponse(context: Context, options?: SimpleStreamOptions) {
  const stream = createStream()
  const child = isChild(context)
  const step = child ? routeChildStep(context) : nextParentStep(context)
  if (step.type === "hang") return streamHangingResponse(options)
  const message = stepToAssistantMessage(step, parentCallCount)
  queueMicrotask(() => {
    if (options?.signal?.aborted) {
      endAborted(stream, message)
      return
    }
    stream.push({ type: "start", partial: { ...message, content: [] } })
    if (step.type === "text") {
      stream.push({ type: "text_start", contentIndex: 0, partial: message })
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

function nextParentStep(context: Context): Exclude<MockStep, { type: "hang" }> {
  const steps = loadMockScript(context.cwd ?? process.cwd()).parentSteps
  const step = steps[Math.min(parentCallCount, steps.length - 1)]
  parentCallCount += 1
  return step
}

function streamHangingResponse(options?: SimpleStreamOptions) {
  const stream = createStream()
  const aborted = stepToAssistantMessage({ type: "text", text: "hang aborted" }, 0)
  aborted.stopReason = "aborted"
  const abort = () => endAborted(stream, aborted)
  queueMicrotask(() => {
    if (options?.signal?.aborted === true) {
      abort()
      return
    }
    stream.push({ type: "start", partial: { ...aborted, content: [] } })
    options?.signal?.addEventListener("abort", abort, { once: true })
  })
  return stream
}

function endAborted(stream: LocalStream, message: AssistantMessage): void {
  stream.push({ type: "error", reason: "aborted", error: message })
  stream.end(message)
}

interface LocalStream extends AsyncIterable<unknown> {
  push(event: unknown): void
  end(message: AssistantMessage): void
  result(): Promise<AssistantMessage>
}

function createStream(): LocalStream {
  const queue: unknown[] = []
  const waiters: Array<(value: IteratorResult<unknown>) => void> = []
  let done = false
  let settleResult: (message: AssistantMessage) => void = () => {}
  const finalMessage = new Promise<AssistantMessage>((resolve) => { settleResult = resolve })
  finalMessage.catch(() => {})
  return {
    push(event: unknown) {
      if (done) return
      if (isTerminalEvent(event)) {
        done = true
        settleResult(event.type === "done" ? event.message : event.error)
      }
      const waiter = waiters.shift()
      if (waiter) waiter({ value: event, done: false })
      else queue.push(event)
    },
    end(message: AssistantMessage) {
      if (done) return
      done = true
      settleResult(message)
      while (waiters.length > 0) waiters.shift()?.({ value: undefined, done: true })
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

function isTerminalEvent(event: unknown): event is { type: "done"; message: AssistantMessage } | { type: "error"; error: AssistantMessage } {
  if (typeof event !== "object" || event === null) return false
  const candidate = event as { type?: unknown; message?: unknown; error?: unknown }
  if (candidate.type === "done") return isAssistantMessage(candidate.message)
  if (candidate.type === "error") return isAssistantMessage(candidate.error)
  return false
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { role?: unknown; content?: unknown; stopReason?: unknown }
  return candidate.role === "assistant" && Array.isArray(candidate.content) && typeof candidate.stopReason === "string"
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log("SELF-TEST OK")
}
