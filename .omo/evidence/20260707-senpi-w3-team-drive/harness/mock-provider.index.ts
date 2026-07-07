#!/usr/bin/env node
// allow: SIZE_OK - one-process manual QA mock provider keeps SSE, health, and chat endpoints in one launched fixture.
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
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

interface ContextToolResultContent {
  type?: string
  text?: string
}

interface ContextMessage {
  role?: string
  toolName?: string
  content?: ContextToolResultContent[] | string
  details?: { team_run_id?: unknown }
}

interface ContextTool {
  name?: string
}

interface Context {
  cwd?: string
  messages?: ContextMessage[]
  tools?: ContextTool[]
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

const TEAM_RUN_ID_PLACEHOLDER = "__TEAM_RUN_ID__"
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// A team lead session is the only session that carries the lead-only `team_create` tool; member
// children have the whole `team_*` family stripped (only a pre-scoped `team_send_message` survives).
// Keying on that tool lets the mock drive the full lead chain while member sessions just acknowledge.
export function isLeadContext(context: Context): boolean {
  return Array.isArray(context.tools) && context.tools.some((tool) => tool?.name === "team_create")
}

// Adaptive team_run_id extraction: the run id is minted at runtime by team_create, so the lead chain
// scripts a placeholder and the mock substitutes the real id read back from the team_create tool
// result. Keyed on toolName and pulled from the human-readable content text ("Created team 'x' (uuid)").
export function extractTeamRunId(messages: readonly ContextMessage[] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (const message of messages) {
    if (message.role !== "toolResult" || message.toolName !== "team_create") continue
    const parts: ContextToolResultContent[] = Array.isArray(message.content) ? message.content : []
    const text = parts.find((part) => part?.type === "text")?.text ?? ""
    const match = text.match(UUID_PATTERN)
    if (match) return match[0]
    const detail = message.details?.team_run_id
    if (typeof detail === "string" && detail.length > 0) return detail
  }
  return undefined
}

function substituteTeamRunId(step: MockStep, teamRunId: string | undefined): MockStep {
  if (step.type !== "tool_call") return step
  const serialized = JSON.stringify(step.arguments)
  if (!serialized.includes(TEAM_RUN_ID_PLACEHOLDER)) return step
  if (teamRunId === undefined) throw new Error("lead chain referenced __TEAM_RUN_ID__ before team_create produced one")
  return { ...step, arguments: JSON.parse(serialized.split(TEAM_RUN_ID_PLACEHOLDER).join(teamRunId)) as Record<string, unknown> }
}

function countLeadToolResults(messages: readonly ContextMessage[] | undefined): number {
  if (!Array.isArray(messages)) return 0
  return messages.filter((message) => message.role === "toolResult").length
}

// Lead sequencing is content-keyed, NOT counter-keyed: in-process members share this module's global
// callCount, so a member turn firing between two lead turns would desync a counter. The lead's own
// tool results are the only tool results in the lead context (members are separate sessions), so the
// count of tool results already present is exactly the next lead step index.
function memberHasSent(context: Context): boolean {
  return Array.isArray(context.messages) && context.messages.some((m) => m.role === "toolResult" && m.toolName === "team_send_message")
}

function memberCanSend(context: Context): boolean {
  return Array.isArray(context.tools) && context.tools.some((tool) => tool?.name === "team_send_message")
}

export function selectMockStep(context: Context, script: MockScript): MockStep {
  if (!isLeadContext(context)) {
    // Member->lead surfacing: a member child's only team tool is the pre-scoped team_send_message. It
    // reports to the lead once, then stops, so the lead-side delivery path is exercised end-to-end.
    if (memberCanSend(context) && !memberHasSent(context)) {
      return { type: "tool_call", name: "team_send_message", arguments: { to: "lead", body: "member report: starting work", summary: "member report" } }
    }
    return { type: "text", text: "member acknowledged; stopping." }
  }
  const index = countLeadToolResults(context.messages)
  const step = script.steps[Math.min(index, script.steps.length - 1)]
  return substituteTeamRunId(step, extractTeamRunId(context.messages))
}

function debugLog(context: Context, step: MockStep): void {
  const debugPath = process.env.OMO_W3_DEBUG
  if (debugPath === undefined || debugPath.length === 0) return
  const fs = process.getBuiltinModule<FsModule & { appendFileSync(path: string, data: string): void }>("fs")
  const toolNames = Array.isArray(context.tools) ? context.tools.map((tool) => tool?.name).filter(Boolean) : "NONE"
  const line = JSON.stringify({
    isLead: isLeadContext(context),
    toolCount: Array.isArray(context.tools) ? context.tools.length : "undef",
    hasTeamCreate: Array.isArray(context.tools) && context.tools.some((tool) => tool?.name === "team_create"),
    hasScopedSend: Array.isArray(context.tools) && context.tools.some((tool) => tool?.name === "team_send_message"),
    msgCount: Array.isArray(context.messages) ? context.messages.length : "undef",
    toolResults: Array.isArray(context.messages) ? context.messages.filter((m) => m.role === "toolResult").map((m) => m.toolName) : "undef",
    step: step.type === "tool_call" ? `tool:${step.name}` : `text:${step.text.slice(0, 20)}`,
    tools: toolNames,
  })
  fs.appendFileSync(debugPath, `${line}\n`)
}

function streamMockResponse(_model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
  const stream = createLocalAssistantMessageEventStream()
  const script = loadMockScript(context.cwd ?? process.cwd())
  const step = selectMockStep(context, script)
  debugLog(context, step)
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

    const leadScript: MockScript = {
      steps: [
        { type: "tool_call", name: "team_create", arguments: { inline_spec: { name: "t" } } },
        { type: "tool_call", name: "team_status", arguments: { team_run_id: "__TEAM_RUN_ID__" } },
        { type: "text", text: "done" },
      ],
    }
    const leadTools = [{ name: "team_create" }, { name: "team_status" }]
    // first lead turn: no tool results yet -> team_create
    const first = selectMockStep({ cwd: tmp, tools: leadTools, messages: [] }, leadScript)
    if (first.type !== "tool_call" || first.name !== "team_create") throw new Error("lead step 0 must be team_create")
    // second lead turn: team_create result present -> team_status with substituted run id
    const runId = "686f410d-bdbc-43ea-861d-657cab68a3b7"
    const afterCreate: ContextMessage[] = [
      { role: "toolResult", toolName: "team_create", content: [{ type: "text", text: `Created team 't' (${runId}) with 2 members.` }] },
    ]
    const second = selectMockStep({ cwd: tmp, tools: leadTools, messages: afterCreate }, leadScript)
    if (second.type !== "tool_call" || second.name !== "team_status") throw new Error("lead step 1 must be team_status")
    if ((second.arguments as { team_run_id?: string }).team_run_id !== runId) throw new Error("team_run_id was not substituted")
    // member first turn: scoped team_send_message tool present, none sent yet -> report to lead
    const memberFirst = selectMockStep({ cwd: tmp, tools: [{ name: "team_send_message" }], messages: [] }, leadScript)
    if (memberFirst.type !== "tool_call" || memberFirst.name !== "team_send_message") throw new Error("member turn 0 must report to lead")
    // member second turn: already reported -> plain text acknowledgement and stop
    const memberSent: ContextMessage[] = [{ role: "toolResult", toolName: "team_send_message", content: [{ type: "text", text: "ok" }] }]
    const memberSecond = selectMockStep({ cwd: tmp, tools: [{ name: "team_send_message" }], messages: memberSent }, leadScript)
    if (memberSecond.type !== "text") throw new Error("member turn 1 must be text")
    // no team tools at all -> plain text
    const bare = selectMockStep({ cwd: tmp, tools: [], messages: [] }, leadScript)
    if (bare.type !== "text") throw new Error("toolless session must be text")
    if (extractTeamRunId(afterCreate) !== runId) throw new Error("extractTeamRunId failed")

    registerMockProvider({
      registerProvider(_id: string, provider: MockProvider) {
        capturedProvider = provider
      },
    })
    if (capturedProvider === undefined) throw new Error("mock provider was not registered")

    writeFileSync(scriptPath, JSON.stringify(leadScript))
    const stream = capturedProvider.streamSimple(model, { cwd: tmp, tools: leadTools, messages: [] })
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
