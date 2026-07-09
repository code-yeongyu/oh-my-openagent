#!/usr/bin/env node
// Lane-private mock provider for team-e2e.mjs (todo 28). A COPY of scripts/qa/mock-provider extended
// for the team lifecycle drive: it branches lead vs each member child on the spawn-prompt marker
// (`MOCKROLE=<role>`), resolves `__TEAM_RUN_ID__` / `__TASK_ID__` placeholders from the live message
// thread so a static script can address the run team-core minted, and writes observation files so the
// driver can assert cross-session delivery (lead->member envelope, member->lead custom message) without
// scraping a background child's transcript.
declare const process: {
  argv: string[]
  cwd(): string
  env: Record<string, string | undefined>
  getBuiltinModule<T>(id: string): T
}

interface FsModule {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: string): string
  readdirSync(path: string): string[]
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  writeFileSync(path: string, data: string): void
}

interface PathModule {
  join(...paths: string[]): string
}

interface UrlModule {
  pathToFileURL(path: string): { href: string }
}

interface CryptoModule {
  randomUUID(): string
}

const { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } = process.getBuiltinModule<FsModule>("fs")
const { join } = process.getBuiltinModule<PathModule>("path")
const { pathToFileURL } = process.getBuiltinModule<UrlModule>("url")
const { randomUUID } = process.getBuiltinModule<CryptoModule>("crypto")

type MockStep =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown>; id?: string }
  | { type: "hang" }

type MockScript = Record<string, MockStep[]>

type Api = "openai-completions"
type StopReason = "stop" | "toolUse" | "aborted"

interface Model<TApi extends string = Api> {
  id: string
  api?: TApi
}

interface MessagePart {
  type?: string
  text?: string
  arguments?: unknown
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
  models: Array<{ id: string; name: string; reasoning: boolean; input: Array<"text" | "image">; cost: { input: number; output: number; cacheRead: number; cacheWrite: number }; contextWindow: number; maxTokens: number }>
  streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AsyncIterable<unknown> & { result(): Promise<AssistantMessage> }
}

interface ExtensionAPI {
  registerProvider(id: string, provider: MockProvider): void
}

interface LocalAssistantMessageEventStream extends AsyncIterable<unknown> {
  push(event: unknown): void
  end(message: AssistantMessage): void
  result(): Promise<AssistantMessage>
}

const model = { id: "mock-1", name: "Mock 1", reasoning: false, input: ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16_000, maxTokens: 4096 }

const ROLE_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ["MOCKROLE=quick", "quick"],
  ["MOCKROLE=fixture", "fixture"],
  ["MOCKROLE=dura", "dura"],
]

export default function registerMockProvider(pi: ExtensionAPI): void {
  pi.registerProvider("omo-mock", {
    name: "omo mock provider",
    baseUrl: "file://mock-provider",
    apiKey: "mock",
    api: "openai-completions",
    models: [model],
    streamSimple: (streamModel, context, options) => streamMockResponse(streamModel, context, options),
  })
}

function loadMockScript(cwd: string): MockScript {
  const scriptPath = join(cwd, "mock-script.json")
  if (!existsSync(scriptPath)) return { lead: [{ type: "text", text: "no script" }] }
  return JSON.parse(readFileSync(scriptPath, "utf8")) as MockScript
}

function messageText(context: Context): string {
  const parts: string[] = []
  for (const message of context.messages ?? []) {
    if (typeof message.content === "string") {
      parts.push(message.content)
      continue
    }
    for (const part of message.content) if (typeof part.text === "string") parts.push(part.text)
  }
  return parts.join("\n")
}

function detectRole(text: string): string {
  for (const [marker, role] of ROLE_MARKERS) if (text.includes(marker)) return role
  return "lead"
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text)
  return match?.[1]
}

function resolvePlaceholders(step: MockStep, text: string): MockStep {
  if (step.type !== "tool_call") return step
  const teamRunId = firstMatch(text, /team_run_id"\s*:\s*"([^"]+)"/) ?? firstMatch(text, /Created team '[^']*' \(([^)]+)\)/)
  const taskId = firstMatch(text, /Created task (\d+)/) ?? firstMatch(text, /"id"\s*:\s*"(\d+)"/)
  const raw = JSON.stringify(step.arguments)
  const substituted = raw
    .split("__TEAM_RUN_ID__").join(teamRunId ?? "__TEAM_RUN_ID__")
    .split("__TASK_ID__").join(taskId ?? "__TASK_ID__")
  return { ...step, arguments: JSON.parse(substituted) as Record<string, unknown> }
}

function recordObservation(role: string, text: string): void {
  const obsDir = process.env.OMO_TEAM_E2E_OBS
  if (obsDir === undefined || obsDir.length === 0) return
  mkdirSync(obsDir, { recursive: true })
  if (role === "quick" && text.includes("LEAD2QUICK")) {
    writeFileSync(join(obsDir, "quick-received.txt"), extractLine(text, "LEAD2QUICK"))
  }
  if (role === "lead" && text.includes("QUICK2LEAD")) {
    const carriesCustomType = text.includes("senpi-task.team-message") || text.includes("peer_message")
    writeFileSync(join(obsDir, "lead-received.txt"), `${carriesCustomType ? "custom-message" : "plain"}\n${extractLine(text, "QUICK2LEAD")}`)
  }
}

function extractLine(text: string, needle: string): string {
  for (const line of text.split(/\r?\n/)) if (line.includes(needle)) return line.trim()
  return needle
}

// Durability fixture (W3-V F1 escalation): on the `dura` member's spawn turn, write ONE already-unread
// message into its own live inbox, standing in for a prior live delivery that failed and released its
// message back to unread. The lead's later live send then drives the revive-unread-injection path,
// which must drain this backlog to zero. The inbox is located from OUR run's runtime tree so the seed
// lands in the exact inbox team-core minted (never a guessed path).
function seedDuraBacklog(cwd: string): void {
  const obsDir = process.env.OMO_TEAM_E2E_OBS
  const runtimeRoot = join(cwd, ".omo", "senpi-task", "teams", "runtime")
  if (!existsSync(runtimeRoot)) return
  for (const runId of readdirSync(runtimeRoot)) {
    const inboxDir = join(runtimeRoot, runId, "inboxes", "dura")
    if (!existsSync(inboxDir)) continue
    const messageId = randomUUID()
    const message = { version: 1, messageId, from: "teammate", to: "dura", kind: "message", body: "DURA-BACKLOG redeliver me", timestamp: Date.now() }
    writeFileSync(join(inboxDir, `${messageId}.json`), `${JSON.stringify(message, null, 2)}\n`)
    if (obsDir !== undefined && obsDir.length > 0) {
      mkdirSync(obsDir, { recursive: true })
      writeFileSync(join(obsDir, "dura-seeded.txt"), `${messageId}\n${inboxDir}`)
    }
    return
  }
}

const roleCallCounts = new Map<string, number>()

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

function streamMockResponse(_model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
  const stream = createLocalAssistantMessageEventStream()
  const cwd = context.cwd ?? process.cwd()
  const text = messageText(context)
  const role = detectRole(text)
  recordObservation(role, text)
  const script = loadMockScript(cwd)
  const steps = script[role] ?? [{ type: "text", text: `no ${role} script` }]
  const index = roleCallCounts.get(role) ?? 0
  roleCallCounts.set(role, index + 1)
  if (role === "dura" && index === 0) seedDuraBacklog(cwd)
  const step = resolvePlaceholders(steps[Math.min(index, steps.length - 1)], text)
  if (step.type === "hang") return streamHangingResponse(index + 1, options)
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

function streamHangingResponse(callCount: number, options?: SimpleStreamOptions) {
  const stream = createLocalAssistantMessageEventStream()
  const aborted = assistantMessage("aborted", [{ type: "text", text: `hang aborted ${callCount}` }])
  const abort = () => {
    stream.push({ type: "error", reason: "aborted", error: aborted })
    stream.end(aborted)
  }
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

function assistantMessage(stopReason: StopReason, content: AssistantContent[]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "omo-mock",
    model: "mock-1",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason,
    timestamp: Date.now(),
  }
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

function isTerminalAssistantMessageEvent(event: unknown): event is { type: "done"; message: AssistantMessage } | { type: "error"; error: AssistantMessage } {
  if (typeof event !== "object" || event === null) return false
  const candidate = event as { type?: unknown; message?: unknown; error?: unknown }
  if (candidate.type === "done") return isAssistantMessage(candidate.message)
  if (candidate.type === "error") return isAssistantMessage(candidate.error)
  return false
}

function extractAssistantMessageResult(event: { type: "done"; message: AssistantMessage } | { type: "error"; error: AssistantMessage }): AssistantMessage {
  return event.type === "done" ? event.message : event.error
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { role?: unknown; content?: unknown; stopReason?: unknown }
  return candidate.role === "assistant" && Array.isArray(candidate.content) && typeof candidate.stopReason === "string"
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    if (detectRole("prompt with MOCKROLE=quick here") !== "quick") throw new Error("quick role detection failed")
    if (detectRole("plain lead prompt") !== "lead") throw new Error("lead role detection failed")
    const resolved = resolvePlaceholders(
      { type: "tool_call", name: "task_send", arguments: { team_run_id: "__TEAM_RUN_ID__", to: "quick", message: "hello" } },
      'foo "team_run_id":"run-xyz" bar',
    )
    if (resolved.type !== "tool_call" || resolved.arguments.team_run_id !== "run-xyz") throw new Error("placeholder resolution failed")
    const withTask = resolvePlaceholders(
      { type: "tool_call", name: "task_update", arguments: { task_id: "__TASK_ID__" } },
      "Created task 7.",
    )
    if (withTask.type !== "tool_call" || withTask.arguments.task_id !== "7") throw new Error("task id resolution failed")
    console.log("SELF-TEST OK")
  }
}
