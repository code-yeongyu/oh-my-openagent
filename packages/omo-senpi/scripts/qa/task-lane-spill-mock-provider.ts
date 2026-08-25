#!/usr/bin/env node
// allow: SIZE_OK - one launched QA fixture keeps the provider registration, the parked-child
// protocol, and the stream shim in the single file senpi loads with `-e`.
// Lane-private mock provider for task-lane-spill-e2e.mjs (cross-lane contract: named after its
// driver, never the shared mock-provider/).
//
// Proving lane occupancy LIVE needs a child that is genuinely still running when the next task is
// admitted. A child here therefore parks until the driver drops a per-child release file, so the
// lane it holds is occupied for a reason the test controls rather than for a lucky interval. The
// parent script is a plain step list read from lane-script.json.
declare const process: {
  argv: string[]
  cwd(): string
  env: Record<string, string | undefined>
  getBuiltinModule<T>(id: string): T
}

interface FsModule {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: string): string
  appendFileSync(path: string, data: string): void
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  writeFileSync(path: string, data: string): void
}

interface PathModule {
  join(...paths: string[]): string
}

interface UrlModule {
  pathToFileURL(path: string): { href: string }
}

const { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } =
  process.getBuiltinModule<FsModule>("fs")
const { join } = process.getBuiltinModule<PathModule>("path")
const { pathToFileURL } = process.getBuiltinModule<UrlModule>("url")

// The child identity line lives ONLY in a child session's message thread (buildSubagentPrompt), so
// it is a leak-proof parent/child selector: the parent's own tool-call arguments never contain it.
const CHILD_IDENTITY = "running as an omo senpi-task child"
const CHILD_FINAL = "omo lane spill child final text"
// Bounded so a wedged child can never hang the whole driver; the release file is the real signal.
const PARK_TIMEOUT_MS = 90_000
const PARK_POLL_MS = 25

type Api = "openai-completions"
type StopReason = "stop" | "toolUse" | "aborted" | "error"

type MockStep =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown>; id?: string }

interface LaneScript {
  readonly parentSteps: readonly MockStep[]
  readonly models: readonly string[]
  // Models whose children must park until released. Absent => no child ever parks.
  readonly parkModels?: readonly string[]
}

interface Model<TApi extends string = Api> {
  readonly id: string
  readonly api?: TApi
}

interface Message {
  readonly role: string
  readonly content: string | ReadonlyArray<{ readonly type?: string; readonly text?: string }>
}

interface Context {
  readonly cwd?: string
  readonly messages?: readonly Message[]
}

type AssistantContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "toolCall"; readonly id: string; readonly name: string; readonly arguments: Record<string, unknown> }

interface AssistantMessage {
  readonly role: "assistant"
  readonly content: readonly AssistantContent[]
  readonly api: Api
  readonly provider: string
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
  readonly timestamp: number
}

interface MockModel {
  readonly id: string
  readonly name: string
  readonly reasoning: boolean
  readonly input: readonly ["text"]
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number }
  readonly contextWindow: number
  readonly maxTokens: number
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
    readonly api: Api
    readonly models: readonly MockModel[]
    streamSimple(model: Model, context: Context): EventStream
  }): void
}

const FALLBACK_SCRIPT: LaneScript = { parentSteps: [{ type: "text", text: "no script" }], models: ["primary"] }

// JSON.parse returns `any`, so the fixture file is narrowed through an explicit shape check at this
// filesystem boundary instead of being cast into the type we hope it has.
function readProp(value: object, key: string): unknown {
  return Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined
}

function toLaneScript(value: unknown): LaneScript {
  if (typeof value !== "object" || value === null) return FALLBACK_SCRIPT
  const parentSteps = readProp(value, "parentSteps")
  const models = readProp(value, "models")
  const parkModels = readProp(value, "parkModels")
  if (!Array.isArray(parentSteps) || !Array.isArray(models)) return FALLBACK_SCRIPT
  return {
    parentSteps: parentSteps.filter(isMockStep),
    models: models.filter((model): model is string => typeof model === "string"),
    ...(Array.isArray(parkModels)
      ? { parkModels: parkModels.filter((model): model is string => typeof model === "string") }
      : {}),
  }
}

function isMockStep(value: unknown): value is MockStep {
  if (typeof value !== "object" || value === null) return false
  const type = readProp(value, "type")
  return type === "text" || type === "tool_call"
}

export function loadLaneScript(cwd: string): LaneScript {
  const scriptPath = join(cwd, "lane-script.json")
  if (!existsSync(scriptPath)) return FALLBACK_SCRIPT
  return toLaneScript(JSON.parse(readFileSync(scriptPath, "utf8")))
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

// Providers are derived from the script's model list so a chain like ["vendor-a/primary",
// "vendor-b/fallback"] registers both lanes without the driver naming them twice.
export function providersOf(models: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const providers = new Map<string, string[]>()
  for (const display of models) {
    const separator = display.indexOf("/")
    if (separator <= 0) continue
    const provider = display.slice(0, separator)
    const modelId = display.slice(separator + 1)
    const existing = providers.get(provider)
    if (existing === undefined) providers.set(provider, [modelId])
    else if (!existing.includes(modelId)) existing.push(modelId)
  }
  return providers
}

export default function registerLaneSpillProvider(pi: ExtensionAPI): void {
  const script = loadLaneScript(process.cwd())
  const observeDir = process.env.LANE_OBSERVE_DIR
  const releaseDir = process.env.LANE_RELEASE_DIR
  for (const [provider, modelIds] of providersOf(script.models)) {
    pi.registerProvider(provider, {
      name: `omo lane spill ${provider}`,
      baseUrl: "file://omo-lane-spill-mock",
      apiKey: "mock",
      api: "openai-completions",
      models: modelIds.map((id) => mockModel(id)),
      streamSimple(model, context) {
        const display = `${provider}/${model.id}`
        if (!messagesContainChild(context)) return streamMessage(parentStep(script, display, provider))
        // A child's arrival on a lane is the live occupancy signal; record it before parking so the
        // driver can assert which lane each task actually landed on.
        recordArrival(observeDir, display)
        return streamParkedChild(display, provider, releaseDir, script.parkModels ?? [])
      },
    })
  }
}

let parentCallCount = 0

function parentStep(script: LaneScript, display: string, provider: string): AssistantMessage {
  const steps = script.parentSteps
  const step = steps[Math.min(parentCallCount, steps.length - 1)] ?? { type: "text" as const, text: "done" }
  parentCallCount += 1
  return step.type === "text"
    ? assistant(display, provider, "stop", [{ type: "text", text: step.text }])
    : assistant(display, provider, "toolUse", [{
        type: "toolCall",
        id: step.id ?? `omo-lane-tool-${parentCallCount}`,
        name: step.name,
        arguments: step.arguments,
      }])
}

function recordArrival(observeDir: string | undefined, display: string): void {
  if (observeDir === undefined || observeDir.length === 0) return
  mkdirSync(observeDir, { recursive: true })
  appendFileSync(join(observeDir, "arrivals.log"), `${JSON.stringify({ model: display, at: Date.now() })}\n`)
}

// Parks the child until <releaseDir>/<provider>.release appears, so the lane stays occupied for as
// long as the driver needs and not one scheduler tick longer.
function streamParkedChild(
  display: string,
  provider: string,
  releaseDir: string | undefined,
  parkModels: readonly string[],
): EventStream {
  const stream = createStream()
  const message = assistant(display, provider, "stop", [{ type: "text", text: `${CHILD_FINAL} ${display}` }])
  const shouldPark = releaseDir !== undefined && releaseDir.length > 0 && parkModels.includes(display)
  if (!shouldPark) {
    queueMicrotask(() => finish(stream, message))
    return stream
  }
  const releasePath = join(releaseDir, `${provider}.release`)
  const deadline = Date.now() + PARK_TIMEOUT_MS
  const poll = () => {
    if (existsSync(releasePath) || Date.now() >= deadline) {
      finish(stream, message)
      return
    }
    setTimeout(poll, PARK_POLL_MS)
  }
  poll()
  return stream
}

function finish(stream: EventStream, message: AssistantMessage): void {
  const content = message.content[0]
  stream.push({ type: "start", partial: { ...message, content: [] } })
  if (content?.type === "text") {
    stream.push({ type: "text_start", contentIndex: 0, partial: message })
    stream.push({ type: "text_delta", contentIndex: 0, delta: content.text, partial: message })
    stream.push({ type: "text_end", contentIndex: 0, content: content.text, partial: message })
  } else if (content?.type === "toolCall") {
    stream.push({ type: "toolcall_start", contentIndex: 0, partial: { ...message, content: [] } })
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(content.arguments), partial: message })
    stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: content, partial: message })
  }
  stream.push({ type: "done", reason: message.stopReason, message })
  stream.end(message)
}

function mockModel(id: string): MockModel {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  }
}

function assistant(
  model: string,
  provider: string,
  stopReason: StopReason,
  content: readonly AssistantContent[],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider,
    model: model.slice(model.indexOf("/") + 1),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason,
    timestamp: Date.now(),
  }
}

function streamMessage(message: AssistantMessage): EventStream {
  const stream = createStream()
  queueMicrotask(() => finish(stream, message))
  return stream
}

function createStream(): EventStream {
  const queue: unknown[] = []
  const waiters: Array<(value: IteratorResult<unknown>) => void> = []
  let done = false
  let settle: (value: AssistantMessage) => void = () => {}
  const result = new Promise<AssistantMessage>((resolve) => {
    settle = resolve
  })
  result.catch(() => {})
  return {
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
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    if (!messagesContainChild({ messages: [{ role: "user", content: `You are ${CHILD_IDENTITY}.` }] })) {
      throw new Error("self-test: child identity must be detected")
    }
    if (messagesContainChild({ messages: [{ role: "user", content: "parent prompt" }] })) {
      throw new Error("self-test: parent must not detect child identity")
    }
    const providers = providersOf(["vendor-a/primary", "vendor-b/fallback", "vendor-a/primary"])
    if (providers.size !== 2 || providers.get("vendor-a")?.length !== 1) {
      throw new Error("self-test: providers must dedupe per provider")
    }
    console.log("SELF-TEST OK")
  }
}
