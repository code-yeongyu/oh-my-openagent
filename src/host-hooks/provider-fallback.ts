import { AGENT_MODEL_REQUIREMENTS } from "../shared/model-requirements"

type TargetModel = {
  id: string
  provider: string
}

type TargetProviderContext = {
  model?: TargetModel
  modelRegistry?: {
    find(provider: string, modelID: string): TargetModel | undefined
  }
}

type TargetProviderResponse = {
  status: number
}

type TargetMessageEnd = {
  message?: unknown
}

export type TargetProviderApi = {
  on(
    event: "before_provider_request" | "after_provider_response" | "message_end" | "turn_end" | "agent_end",
    handler: (payload: unknown, context: unknown) => unknown | Promise<unknown>,
  ): void
  setModel?(model: TargetModel): Promise<boolean>
}

export type TargetProviderState = {
  requestMutations: number
  responseErrors: number
  fallbackAttempts: number
  fallbackApplied: number
  replayAttempts: number
  replayApplied: number
  lastErrorStatus?: number
  lastPrompt?: string
  lastReplayPrompt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function mutateTargetProviderPayload(payload: unknown): unknown {
  if (!isRecord(payload) || !isRecord(payload.headers)) return payload
  return {
    ...payload,
    headers: {
      ...payload.headers,
      "x-oh-my-openagent": "target-adapter",
    },
  }
}

function unwrapProviderPayload(eventOrPayload: unknown): unknown {
  return isRecord(eventOrPayload) && "payload" in eventOrPayload ? eventOrPayload.payload : eventOrPayload
}

function assistantHasError(payload: unknown): boolean {
  if (!isRecord(payload)) return false
  const event = payload as TargetMessageEnd
  const messages = Array.isArray(payload.messages) ? payload.messages : [event.message]
  return messages.some((message) =>
    isRecord(message)
    && message.role === "assistant"
    && typeof message.errorMessage === "string"
    && message.errorMessage.length > 0
  )
}

function extractTextContent(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return undefined
  const parts = value.flatMap((part) => {
    if (typeof part === "string") return [part]
    if (!isRecord(part)) return []
    if (part.type === "text" && typeof part.text === "string") return [part.text]
    if (typeof part.content === "string") return [part.content]
    return []
  })
  const text = parts.join("\n").trim()
  return text.length > 0 ? text : undefined
}

function extractPromptFromMessages(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (const message of [...messages].reverse()) {
    if (!isRecord(message) || message.role !== "user") continue
    const text = extractTextContent(message.content)
    if (text) return text
  }
  return undefined
}

function extractReplayPrompt(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  for (const key of ["prompt", "message", "input", "text"]) {
    const candidate = value[key]
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim()
  }
  const payload = isRecord(value.payload) ? value.payload : value
  const body = isRecord(payload.body) ? payload.body : payload
  return extractPromptFromMessages(body.messages ?? payload.messages)
}

async function applyNextFallback(
  api: TargetProviderApi,
  context: TargetProviderContext,
  state: TargetProviderState,
): Promise<boolean> {
  if (!api.setModel || !context.model || !context.modelRegistry) return false
  state.fallbackAttempts += 1
  const chain = AGENT_MODEL_REQUIREMENTS.sisyphus?.fallbackChain ?? []
  for (const entry of chain) {
    for (const provider of entry.providers) {
      if (provider === context.model.provider && entry.model === context.model.id) continue
      const model = context.modelRegistry.find(provider, entry.model)
      if (!model) continue
      if (await api.setModel(model)) {
        state.fallbackApplied += 1
        return true
      }
    }
  }
  return false
}

async function applyFallback(
  api: TargetProviderApi,
  context: TargetProviderContext,
  state: TargetProviderState,
): Promise<void> {
  await applyNextFallback(api, context, state)
}

export function registerTargetProviderFallback(
  api: TargetProviderApi,
  state: TargetProviderState = {
    requestMutations: 0,
    responseErrors: 0,
    fallbackAttempts: 0,
    fallbackApplied: 0,
    replayAttempts: 0,
    replayApplied: 0,
  },
): TargetProviderState {
  let fallbackPending = false

  api.on("before_provider_request", (eventOrPayload) => {
    fallbackPending = false
    const payload = isRecord(eventOrPayload) && "payload" in eventOrPayload ? eventOrPayload.payload : eventOrPayload
    const prompt = extractReplayPrompt(payload)
    if (prompt) state.lastPrompt = prompt
    const mutated = mutateTargetProviderPayload(payload)
    if (mutated !== payload) state.requestMutations += 1
    return mutated
  })

  api.on("after_provider_response", async (eventOrPayload, context) => {
    const payload = unwrapProviderPayload(eventOrPayload)
    const contextPrompt = extractReplayPrompt(context)
    if (contextPrompt) state.lastPrompt = contextPrompt
    if (!isRecord(payload) || typeof payload.status !== "number" || payload.status < 400) return undefined
    const response = payload as TargetProviderResponse
    state.responseErrors += 1
    state.lastErrorStatus = response.status
    return undefined
  })

  const handleFailedTurn = async (payload: unknown, context: unknown) => {
    if (fallbackPending || !assistantHasError(payload)) return undefined
    state.responseErrors += 1
    const contextPrompt = extractReplayPrompt(context)
    if (contextPrompt) state.lastPrompt = contextPrompt
    await applyFallback(api, isRecord(context) ? context : {}, state)
    fallbackPending = true
    return undefined
  }
  api.on("turn_end", handleFailedTurn)
  api.on("agent_end", handleFailedTurn)

  return state
}
