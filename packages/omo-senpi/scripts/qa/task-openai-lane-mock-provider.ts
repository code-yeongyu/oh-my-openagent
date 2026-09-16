#!/usr/bin/env node
// Live fixture for the OpenAI lane policy (#8300), driven by task-openai-lane-e2e.mjs. senpi's
// `openai` provider is the metered API-key lane and `openai-codex` is the ChatGPT subscription lane;
// both serve the same model ids. What this proves end to end: a delegated task(category) child is
// never routed to the API lane when the subscription lane serves the same model, while a registry
// that ONLY holds the API key still resolves through the resolver's cross-provider fallthrough.
// The parent's first turn spawns one child; the scenario's lane providers are the only models that
// can serve it, so the recorded child model names the lane that won.
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
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

interface MockModel {
  readonly id: string
  readonly name: string
  readonly reasoning: boolean
  readonly input: readonly ["text"]
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number }
  readonly contextWindow: number
  readonly maxTokens: number
}

interface AssistantMessage {
  readonly role: "assistant"
  readonly content: readonly (
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "toolCall"; readonly id: string; readonly name: string; readonly arguments: Readonly<Record<string, unknown>> }
  )[]
  readonly api: "openai-completions"
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

interface EventStream extends AsyncIterable<unknown> {
  push(event: unknown): void
  end(message: AssistantMessage): void
  result(): Promise<AssistantMessage>
}

interface MockProviderRegistration {
  readonly name: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly api: "openai-completions"
  readonly models: readonly MockModel[]
  streamSimple(model: Model, context: Context): EventStream
}

interface ExtensionAPI {
  registerProvider(id: string, provider: MockProviderRegistration): void
}

const CHILD_IDENTITY = "running as an omo senpi-task child"
const FINAL_TEXT = "omo e2e openai lane child final text"
const PARENT_PROVIDER = "omo-openai-lane-mock"
const LANE_MODEL_ID = "gpt-6-astra"
// Scenarios: "both-lanes" (API lane and subscription lane both serve the model - the subscription
// lane must win), "api-key-only" (cross-provider fallthrough must keep the API lane reachable),
// "codex-only" (subscription lane alone still resolves).
const LANE_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  "both-lanes": ["openai", "openai-codex"],
  "api-key-only": ["openai"],
  "codex-only": ["openai-codex"],
}
const SCENARIO = process.env.OMO_OPENAI_LANE_SCENARIO ?? "both-lanes"
const CATEGORY = process.env.OMO_OPENAI_LANE_CATEGORY ?? "deep"
let parentCalls = 0

export default function registerOpenAiLaneMockProvider(pi: ExtensionAPI): void {
  pi.registerProvider(PARENT_PROVIDER, {
    name: "omo openai lane mock",
    baseUrl: "file://omo-openai-lane-mock",
    apiKey: "mock",
    api: "openai-completions",
    models: [laneModel("parent", "Parent")],
    streamSimple(model, context) {
      // A child served here would mean the category escaped both lanes; answering with the final
      // text keeps the run finite and the driver's resolved_model check still records the miss.
      if (isChild(context)) return streamMessage(finalReply(PARENT_PROVIDER, model.id))
      parentCalls += 1
      return streamMessage(parentCalls === 1
        ? assistant(PARENT_PROVIDER, model.id, "toolUse", [{
            type: "toolCall",
            id: "openai-lane-task-call",
            name: "task",
            arguments: {
              category: CATEGORY,
              prompt: "answer with your final text and stop",
              run_in_background: false,
              name: "lane-child",
            },
          }])
        : assistant(PARENT_PROVIDER, model.id, "stop", [{ type: "text", text: "parent observed the lane child" }]))
    },
  })

  // The lane fixtures serve the SAME model id, so only provider ranking can decide between them.
  // reasoning: true is required for the runtime to accept the chain rung's variant (max/high).
  for (const provider of laneProviders(SCENARIO)) {
    pi.registerProvider(provider, {
      name: `omo openai lane ${provider} fixture`,
      baseUrl: "file://omo-openai-lane-mock",
      apiKey: "mock",
      api: "openai-completions",
      models: [{ ...laneModel(LANE_MODEL_ID, `Lane model (${provider})`), reasoning: true }],
      streamSimple(model) {
        return streamMessage(finalReply(provider, model.id))
      },
    })
  }
}

function laneProviders(scenario: string): readonly string[] {
  return Object.hasOwn(LANE_PROVIDERS, scenario) ? LANE_PROVIDERS[scenario] : LANE_PROVIDERS["both-lanes"]
}

function laneModel(id: string, name: string): MockModel {
  return {
    id,
    name,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  }
}

function finalReply(provider: string, modelId: string): AssistantMessage {
  return assistant(provider, modelId, "stop", [{ type: "text", text: FINAL_TEXT }])
}

function isChild(context: Context): boolean {
  return (context.messages ?? []).some((message) => {
    if (typeof message.content === "string") return message.content.includes(CHILD_IDENTITY)
    return message.content.some((part) => part.text?.includes(CHILD_IDENTITY) === true)
  })
}

function assistant(
  provider: string,
  model: string,
  stopReason: StopReason,
  content: AssistantMessage["content"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider,
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason,
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
    stream.push({ type: "done", reason: message.stopReason, message })
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

if (process.argv[1]?.endsWith("task-openai-lane-mock-provider.ts") && process.argv.includes("--self-test")) {
  if (!isChild({ messages: [{ content: `You are ${CHILD_IDENTITY}.` }] })) throw new Error("child detection failed")
  if (isChild({ messages: [{ content: "parent" }] })) throw new Error("parent misclassified")
  if (JSON.stringify(laneProviders("both-lanes")) !== JSON.stringify(["openai", "openai-codex"])) {
    throw new Error("both-lanes must register the API lane and the subscription lane")
  }
  if (JSON.stringify(laneProviders("api-key-only")) !== JSON.stringify(["openai"])) throw new Error("api-key-only lane set wrong")
  if (JSON.stringify(laneProviders("codex-only")) !== JSON.stringify(["openai-codex"])) throw new Error("codex-only lane set wrong")
  if (JSON.stringify(laneProviders("nonsense")) !== JSON.stringify(laneProviders("both-lanes"))) {
    throw new Error("unknown scenario must fall back to both lanes")
  }
  const reply = finalReply("openai-codex", LANE_MODEL_ID)
  if (reply.provider !== "openai-codex" || reply.model !== LANE_MODEL_ID) throw new Error("child reply must name the serving lane")
  if (reply.stopReason !== "stop" || JSON.stringify(reply.content).includes(FINAL_TEXT) === false) {
    throw new Error("child reply must stop with the fixed final text")
  }
  console.log("SELF-TEST OK")
}
