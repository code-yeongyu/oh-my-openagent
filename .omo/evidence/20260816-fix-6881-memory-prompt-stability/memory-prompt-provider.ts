declare const process: {
  getBuiltinModule<T>(id: string): T
}

interface FsModule {
  appendFileSync(path: string, data: string): void
}

interface Context {
  cwd?: string
  systemPrompt?: string
  messages?: unknown[]
}

interface AssistantMessage {
  role: "assistant"
  content: Array<
    | { type: "text"; text: string }
    | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  >
  api: "openai-completions"
  provider: "omo-cache-qa"
  model: string
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    totalTokens: number
    cost: number
  }
  stopReason: "stop" | "toolUse"
  timestamp: number
}

interface LocalStream extends AsyncIterable<unknown> {
  result(): Promise<AssistantMessage>
}

interface ExtensionAPI {
  registerProvider(id: string, provider: Record<string, unknown>): void
}

const { appendFileSync } = process.getBuiltinModule<FsModule>("fs")
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}

let callCount = 0

export default function registerProvider(pi: ExtensionAPI): void {
  pi.registerProvider("omo-cache-qa", {
    name: "omo memory prompt cache QA",
    baseUrl: "file://omo-memory-prompt-cache-qa",
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
    streamSimple(model: { id: string }, context: Context): LocalStream {
      const dumpPath = env.QA_PROVIDER_DUMP
      if (typeof dumpPath === "string" && dumpPath.length > 0) {
        appendFileSync(dumpPath, `${JSON.stringify({
          model: model.id,
          cwd: context.cwd,
          systemPrompt: context.systemPrompt,
          messages: context.messages,
        })}\n`)
      }
      callCount += 1
      return response(model.id, env.QA_PROVIDER_MODE === "bootstrap" && callCount === 1)
    },
  })
}

function response(model: string, createMemory: boolean): LocalStream {
  const content = createMemory
    ? [{
        type: "toolCall" as const,
        id: "memory-prompt-qa-create",
        name: "memory",
        arguments: {
          command: "create",
          file_path: "system/facts.md",
          description: "QA memory prompt stability fact",
          file_text: "memory prompt QA initialized",
          reason: "initialize the real memory repository for prompt-cache QA",
        },
      }]
    : [{ type: "text" as const, text: "qa complete" }]
  const message: AssistantMessage = {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "omo-cache-qa",
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason: createMemory ? "toolUse" : "stop",
    timestamp: Date.now(),
  }
  const events = createMemory
    ? [
        { type: "start", partial: { ...message, content: [] } },
        { type: "toolcall_start", contentIndex: 0, partial: { ...message, content: [] } },
        { type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(content[0]?.arguments), partial: message },
        { type: "toolcall_end", contentIndex: 0, toolCall: content[0], partial: message },
        { type: "done", reason: "toolUse", message },
      ]
    : [
        { type: "start", partial: { ...message, content: [] } },
        { type: "text_start", contentIndex: 0, partial: { ...message, content: [{ type: "text", text: "" }] } },
        { type: "text_delta", contentIndex: 0, delta: "qa complete", partial: message },
        { type: "text_end", contentIndex: 0, content: "qa complete", partial: message },
        { type: "done", reason: "stop", message },
      ]
  return {
    result: async () => message,
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event
    },
  }
}
