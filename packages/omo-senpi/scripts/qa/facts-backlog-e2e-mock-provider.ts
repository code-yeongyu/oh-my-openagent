#!/usr/bin/env node
// Lane-private mock provider for facts-backlog-e2e.mjs (cross-lane contract: named after its
// driver, never the shared mock-provider/). The CHILD here is a REAL `senpi -p` process spawned by
// the real facts runner - only the model is mocked, so the sandbox, supervisor, payload and
// extraction paths are all exercised for real.
//
// The scripted turn is derived from the run's OWN env (FACTS_PAYLOAD_PATH/FACTS_EXTRACTION_PATH),
// because a capped backlog produces MANY runs with different payload and extraction paths - a
// static mock-script.json could not address them.
declare const process: {
  argv: string[]
  cwd(): string
  getBuiltinModule<T>(id: string): T
}

interface FsModule {
  readFileSync(path: string, encoding: string): string
}

const { readFileSync } = process.getBuiltinModule<FsModule>("fs")
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}

type Api = "openai-completions"

interface Model<TApi extends string = Api> {
  id: string
  api?: TApi
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
  stopReason: "stop" | "toolUse" | "aborted" | "error"
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
    input: Array<"text">
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
    contextWindow: number
    maxTokens: number
  }>
  streamSimple(model: Model<Api>, context: unknown, options?: SimpleStreamOptions): AsyncIterable<unknown> & {
    result(): Promise<AssistantMessage>
  }
}

interface ExtensionAPI {
  registerProvider(id: string, provider: MockProvider): void
}

// Failure induction: a payload carrying this sentinel makes the mock CHILD EXIT 7 instead of
// writing an extraction - the driver's mid-drain failure scenario (G) drives it.
const FAIL_SENTINEL = "FAILCHILD"

/** One extraction line per shipped batch, tagged with the batch's endpoints so the driver can
 * prove which queue entries reached the model. */
export function extractionFor(payloadPath: string, today: string): string {
  const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as {
    readonly entries: ReadonlyArray<{ readonly conversationId?: string; readonly range?: { readonly end_message_id?: string } }>
  }
  const shipped = payload.entries
    .map((entry) => `${entry.conversationId ?? "?"}:${entry.range?.end_message_id ?? "?"}`)
    .join(" ")
  return `${JSON.stringify({ scope: "project", text: `QA backlog batch covered ${shipped}`, date: today })}\n`
}

function message(content: AssistantContent[], modelId: string, stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "omo-mock",
    model: modelId,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason,
    timestamp: Date.now(),
  }
}

let turn = 0

export default function registerMockProvider(pi: ExtensionAPI): void {
  pi.registerProvider("omo-mock", {
    name: "omo mock facts provider",
    baseUrl: "file://facts-mock-provider",
    apiKey: "mock",
    api: "openai-completions",
    models: [{
      id: "mock-1",
      name: "mock-1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 4096,
    }],
    streamSimple(streamModel: Model<Api>, _context: unknown, options?: SimpleStreamOptions) {
      const payloadPath = env.FACTS_PAYLOAD_PATH ?? ""
      if (payloadPath.length > 0 && readFileSync(payloadPath, "utf8").includes(FAIL_SENTINEL)) {
        ;(globalThis as { process?: { exit?: (code: number) => never } }).process?.exit?.(7)
      }
      const extractionPath = env.FACTS_EXTRACTION_PATH ?? ""
      const today = new Date().toISOString().slice(0, 10)
      // Turn 1 writes the extraction with the real `write` tool; turn 2 ends the print run.
      const step: AssistantContent[] = turn === 0
        ? [{
            type: "toolCall",
            id: `omo-mock-facts-${turn}`,
            name: "write",
            arguments: { path: extractionPath, content: extractionFor(payloadPath, today) },
          }]
        : [{ type: "text", text: "extraction written" }]
      const final = message(step, streamModel.id, turn === 0 ? "toolUse" : "stop")
      turn += 1
      return stream(final, options)
    },
  })
}

function stream(final: AssistantMessage, options?: SimpleStreamOptions) {
  const queue: unknown[] = []
  const waiters: Array<(value: IteratorResult<unknown>) => void> = []
  let done = false
  let settle: (value: AssistantMessage) => void = () => {}
  const result = new Promise<AssistantMessage>((resolve) => { settle = resolve })
  const push = (event: unknown): void => {
    const waiter = waiters.shift()
    if (waiter) waiter({ value: event, done: false })
    else queue.push(event)
  }
  queueMicrotask(() => {
    if (options?.signal?.aborted === true) {
      const aborted: AssistantMessage = { ...final, stopReason: "aborted" }
      push({ type: "error", reason: "aborted", error: aborted })
      done = true
      settle(aborted)
      return
    }
    push({ type: "start", partial: { ...final, content: [] } })
    const content = final.content[0]
    if (content !== undefined && content.type === "text") {
      push({ type: "text_start", contentIndex: 0, partial: final })
      push({ type: "text_delta", contentIndex: 0, delta: content.text, partial: final })
      push({ type: "text_end", contentIndex: 0, content: content.text, partial: final })
    } else if (content !== undefined) {
      push({ type: "toolcall_start", contentIndex: 0, partial: { ...final, content: [] } })
      push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(content.arguments), partial: final })
      push({ type: "toolcall_end", contentIndex: 0, toolCall: content, partial: final })
    }
    push({ type: "done", reason: final.stopReason, message: final })
    done = true
    settle(final)
    for (const waiter of waiters.splice(0)) waiter({ value: undefined, done: true })
  })
  return {
    result: () => result,
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false })
          if (done) return Promise.resolve({ value: undefined, done: true })
          return new Promise<IteratorResult<unknown>>((resolve) => waiters.push(resolve))
        },
      }
    },
  }
}
