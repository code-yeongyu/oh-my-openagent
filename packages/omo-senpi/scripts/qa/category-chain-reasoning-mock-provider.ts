#!/usr/bin/env node
// Lane-private mock provider for category-chain-reasoning-e2e.mjs: wraps the task lane's provider
// (scripted parent/child steps stay intact), makes every model advertise graded thinking, and fails
// the child's FIRST request on the head model the way a real 400 on a thinking request with tools does.
// The chain retries the SAME model id at another level, so only the thinking level distinguishes the
// failing request from its retry - by model alone they are indistinguishable.
import { createLocalAssistantMessageEventStream } from "./mock-provider/index.ts"
import registerTaskE2eMockProvider, {
  loadMockScript,
  messagesContainChild,
  stepToAssistantMessage,
} from "./task-e2e-mock-provider.ts"

declare const process: {
  cwd(): string
  getBuiltinModule<T>(id: string): T
}

interface FsModule {
  appendFileSync(path: string, data: string): void
}

interface PathModule {
  join(...paths: string[]): string
}

const { appendFileSync } = process.getBuiltinModule<FsModule>("fs")
const { join } = process.getBuiltinModule<PathModule>("path")

export const REQUEST_LOG = "chain-requests.jsonl"
export const HEAD_MODEL_ID = "mock-1"
export const RETRY_ERROR_MESSAGE = "400 Thinking mode does not support this tool_choice (mock)"

const THINKING_LEVELS = {
  off: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
} as const

type TaskE2EExtensionAPI = Parameters<typeof registerTaskE2eMockProvider>[0]
type MockProvider = Parameters<TaskE2EExtensionAPI["registerProvider"]>[1]
type StreamSimple = MockProvider["streamSimple"]

function readThinking(source: unknown): string | null {
  if (typeof source !== "object" || source === null) return null
  for (const key of ["thinkingLevel", "thinking_level", "reasoning_effort", "reasoning"] as const) {
    const value = Reflect.get(source, key)
    if (typeof value === "string") return value
    if (typeof value === "object" && value !== null) {
      const nested = Reflect.get(value, "effort") ?? Reflect.get(value, "level")
      if (typeof nested === "string") return nested
    }
  }
  return null
}

function appendRequest(record: Record<string, unknown>): void {
  appendFileSync(join(process.cwd(), REQUEST_LOG), `${JSON.stringify(record)}\n`)
}

function failureMessage(modelId: string) {
  return {
    ...stepToAssistantMessage({ type: "text", text: "" }, 1, modelId),
    stopReason: "error" as const,
    errorMessage: RETRY_ERROR_MESSAGE,
  }
}

function wrapStreamSimple(original: StreamSimple): StreamSimple {
  let headRequests = 0
  return (model, context, options) => {
    const isChild = messagesContainChild(context)
    const id = typeof model === "object" && model !== null ? String(Reflect.get(model, "id") ?? "") : ""
    const thinking = readThinking(options) ?? readThinking(context) ?? null
    const armed = Reflect.get(loadMockScript(process.cwd()) as object, "failChildHeadRequests") === true
    const failing = armed && isChild && id === HEAD_MODEL_ID && headRequests === 0
    if (isChild && id === HEAD_MODEL_ID) headRequests += 1
    appendRequest({ model: id, thinking, isChild, failing })
    if (!failing) return original(model, context, options)

    const failure = failureMessage(id)
    const stream = createLocalAssistantMessageEventStream()
    queueMicrotask(() => {
      stream.push({ type: "start", partial: failure })
      stream.push({ type: "error", reason: "error", error: failure })
      stream.end(failure)
    })
    return stream
  }
}

export default function registerCategoryChainReasoningMockProvider(pi: TaskE2EExtensionAPI): void {
  const registerProvider = pi.registerProvider.bind(pi)
  pi.registerProvider = (id, provider) => {
    registerProvider(id, {
      ...provider,
      models: provider.models.map((model) => ({ ...model, reasoning: true, thinkingLevelMap: THINKING_LEVELS })),
      streamSimple: wrapStreamSimple(provider.streamSimple.bind(provider)),
    })
  }
  registerTaskE2eMockProvider(pi)
}

