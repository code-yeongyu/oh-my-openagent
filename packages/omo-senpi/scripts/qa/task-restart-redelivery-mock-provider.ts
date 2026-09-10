#!/usr/bin/env node
// Lane-private mock provider for task-restart-redelivery-e2e.mjs (cross-lane contract: named after
// its driver, never the shared mock-provider/). Two lane-specific behaviours on top of the usual
// parent-script / child-identity routing:
//   - the CHILD's first turn blocks on a driver-written file gate, so the child can only reach its
//     terminal state after the driver has observed the parent go idle. That makes the completion
//     wake land on an IDLE parent (append + triggerTurn), exactly the incident shape.
//   - a parent step of type "hang" stalls at the MODEL, so the turn triggered by the wake never
//     produces an assistant message. The driver SIGKILLs the parent in that stall, reproducing a
//     server restart between "wake appended to the parent JSONL" and "parent answered it".
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

// The child identity line lives ONLY in a child session's message thread (buildSubagentPrompt). The
// parent's task tool-call arguments never contain it, so this is a leak-proof parent/child selector.
const CHILD_IDENTITY = "running as an omo senpi-task child"

// Token contract mirrored by task-restart-redelivery-e2e.mjs (its --self-test pins the equality).
export const CHILD_DONE_TOKEN = "RESTART_REDELIVERY_CHILD_DONE"
const GATE_POLL_MS = 20
const GATE_TIMEOUT_MS = 60_000

type MockStep =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown>; id?: string }
  | { type: "hang" }

interface MockScript {
  parentSteps: MockStep[]
  // Absolute path the driver creates to release the child's first turn. Absent = release immediately.
  childGate?: string
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

export function messagesContainChild(context: Context): boolean {
  return (context.messages ?? []).some((message) => messageText(message).includes(CHILD_IDENTITY))
}

let parentCallCount = 0

export function stepToAssistantMessage(step: Exclude<MockStep, { type: "hang" }>, callCount: number): AssistantMessage {
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
  const script = loadMockScript(context.cwd ?? process.cwd())
  if (messagesContainChild(context)) return streamChildResponse(script, options)
  const step = nextParentStep(script)
  if (step.type === "hang") return streamHangingResponse(options)
  const stream = createStream()
  queueMicrotask(() => emitStep(stream, step, options))
  return stream
}

// The child answers in ONE turn, but only after the gate file exists: the driver owns the moment the
// child may reach a terminal state, so the wake it produces always lands on the parent state the
// scenario is about. The wait polls the filesystem asynchronously (the child shares the parent's
// event loop; a busy wait would freeze the parent turn we are timing against).
function streamChildResponse(script: MockScript, options?: SimpleStreamOptions) {
  const stream = createStream()
  const step: MockStep = { type: "text", text: CHILD_DONE_TOKEN }
  const gate = script.childGate
  if (gate === undefined || existsSync(gate)) {
    queueMicrotask(() => emitStep(stream, step, options))
    return stream
  }
  const deadline = Date.now() + GATE_TIMEOUT_MS
  const poll = (): void => {
    if (options?.signal?.aborted === true) {
      emitStep(stream, step, options)
      return
    }
    if (existsSync(gate) || Date.now() > deadline) {
      emitStep(stream, step, options)
      return
    }
    setTimeout(poll, GATE_POLL_MS)
  }
  setTimeout(poll, GATE_POLL_MS)
  return stream
}

function emitStep(stream: LocalStream, step: Exclude<MockStep, { type: "hang" }>, options?: SimpleStreamOptions): void {
  const message = stepToAssistantMessage(step, parentCallCount)
  if (options?.signal?.aborted === true) {
    endAborted(stream, { ...message, stopReason: "aborted" })
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
}

function nextParentStep(script: MockScript): MockStep {
  const steps = script.parentSteps
  const step = steps[Math.min(parentCallCount, steps.length - 1)]
  parentCallCount += 1
  return step
}

function streamHangingResponse(options?: SimpleStreamOptions) {
  const stream = createStream()
  const aborted = { ...stepToAssistantMessage({ type: "text", text: "hang aborted" }, 0), stopReason: "aborted" as const }
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
  if (process.argv.includes("--self-test")) {
    // given a child-identity thread / when routed / then the child selector matches
    if (!messagesContainChild({ messages: [{ role: "user", content: `You are ${CHILD_IDENTITY}.` }] })) {
      throw new Error("self-test: child identity detection failed")
    }
    // given a parent thread / when routed / then the child selector must not match
    if (messagesContainChild({ messages: [{ role: "user", content: "spawn one background child" }] })) {
      throw new Error("self-test: parent must not detect child identity")
    }
    // given a tool step / when converted / then it stops with toolUse
    if (stepToAssistantMessage({ type: "tool_call", name: "task", arguments: {} }, 1).stopReason !== "toolUse") {
      throw new Error("self-test: tool step must stop with toolUse")
    }
    console.log("SELF-TEST OK")
  }
}
