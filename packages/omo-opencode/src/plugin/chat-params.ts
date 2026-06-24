import { isRecord } from "@oh-my-opencode/utils"
import { getSessionPromptParams } from "../shared/session-prompt-params-state"
import { getModelCapabilities, log, resolveCompatibleModelSettings } from "../shared"

const SAFE_MAX_OUTPUT_TOKENS_FALLBACK = 4096

export type ChatParamsInput = {
  sessionID: string
  agent: { name?: string }
  model: { providerID: string; modelID: string }
  provider: { id: string }
  message: { variant?: string }
}

type ChatParamsHookInput = ChatParamsInput & {
  rawMessage?: Record<string, unknown>
  apiNpm?: string
}

export type ChatParamsOutput = {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  options: Record<string, unknown>
}

const NATIVE_OPENAI_NPM = "@ai-sdk/openai"

function isNativeOpenAIProvider(apiNpm: string | undefined): boolean {
  return apiNpm === NATIVE_OPENAI_NPM
}



function buildChatParamsInput(raw: unknown): ChatParamsHookInput | null {
  if (!isRecord(raw)) return null

  const sessionID = raw.sessionID
  const agent = raw.agent
  const model = raw.model
  const provider = raw.provider
  const message = raw.message

  if (typeof sessionID !== "string") return null
  if (!isRecord(model)) return null
  if (!isRecord(provider)) return null
  if (!isRecord(message)) return null

  let agentName: string | undefined
  if (typeof agent === "string") {
    agentName = agent
  } else if (isRecord(agent)) {
    const name = agent.name
    if (typeof name === "string") {
      agentName = name
    }
  }
  if (!agentName) return null

  const providerID = model.providerID
  const modelID = typeof model.modelID === "string"
    ? model.modelID
    : typeof model.id === "string"
      ? model.id
      : undefined
  const providerId = provider.id
  if (typeof providerID !== "string") return null
  if (typeof modelID !== "string") return null
  if (typeof providerId !== "string") return null

  const api = isRecord(model.api) ? model.api : undefined
  const apiNpm = api && typeof api.npm === "string" ? api.npm : undefined

  return {
    sessionID,
    agent: { name: agentName },
    model: { providerID, modelID },
    provider: { id: providerId },
    message,
    rawMessage: message,
    apiNpm,
  }
}

function isChatParamsOutput(raw: unknown): raw is ChatParamsOutput {
  if (!isRecord(raw)) return false
  if (!isRecord(raw.options)) {
    raw.options = {}
  }
  return isRecord(raw.options)
}

export function createChatParamsHandler(_args: {
  client?: unknown
} = {}): (input: unknown, output: unknown) => Promise<void> {
  return async (input, output): Promise<void> => {
    const normalizedInput = buildChatParamsInput(input)
    if (!normalizedInput) return
    if (!isChatParamsOutput(output)) return

    const storedPromptParams = getSessionPromptParams(normalizedInput.sessionID)
    if (storedPromptParams) {
      if (storedPromptParams.temperature !== undefined) {
        output.temperature = storedPromptParams.temperature
      }
      if (storedPromptParams.topP !== undefined) {
        output.topP = storedPromptParams.topP
      }
      if (
        typeof storedPromptParams.maxOutputTokens === "number" &&
        storedPromptParams.maxOutputTokens > 0
      ) {
        (output as Record<string, unknown>).maxOutputTokens = storedPromptParams.maxOutputTokens
      }
      if (storedPromptParams.options) {
        output.options = {
          ...output.options,
          ...storedPromptParams.options,
        }
      }
    }

    const capabilities = getModelCapabilities({
      providerID: normalizedInput.model.providerID,
      modelID: normalizedInput.model.modelID,
    })

    const compatibility = resolveCompatibleModelSettings({
      providerID: normalizedInput.model.providerID,
      modelID: normalizedInput.model.modelID,
      desired: {
        variant: typeof normalizedInput.message.variant === "string"
          ? normalizedInput.message.variant
          : undefined,
        reasoningEffort: typeof output.options.reasoningEffort === "string"
          ? output.options.reasoningEffort
          : undefined,
        temperature: typeof output.temperature === "number" ? output.temperature : undefined,
        topP: typeof output.topP === "number" ? output.topP : undefined,
        maxTokens: typeof output.maxOutputTokens === "number" ? output.maxOutputTokens : undefined,
        thinking: isRecord(output.options.thinking) ? output.options.thinking : undefined,
      },
      capabilities,
    })

    if (normalizedInput.rawMessage) {
      if (compatibility.variant !== undefined) {
        normalizedInput.rawMessage.variant = compatibility.variant
      } else {
        delete normalizedInput.rawMessage.variant
      }
    }
    normalizedInput.message = normalizedInput.rawMessage as { variant?: string }

    if (compatibility.reasoningEffort !== undefined) {
      if (normalizedInput.apiNpm !== undefined && !isNativeOpenAIProvider(normalizedInput.apiNpm)) {
        // OpenAI rejects requests that combine tools + reasoning_effort on
        // /v1/chat/completions (issue #5529). openai-compatible providers and
        // non-native OpenAI variants may use that endpoint, so drop the
        // reasoning_effort injection entirely.
        delete output.options.reasoningEffort
      } else {
        output.options.reasoningEffort = compatibility.reasoningEffort
      }
    } else if ("reasoningEffort" in output.options) {
      delete output.options.reasoningEffort
    }

    if ("temperature" in compatibility) {
      if (compatibility.temperature !== undefined) {
        output.temperature = compatibility.temperature
      } else {
        delete output.temperature
      }
    }

    if ("topP" in compatibility) {
      if (compatibility.topP !== undefined) {
        output.topP = compatibility.topP
      } else {
        delete output.topP
      }
    }

    if ("maxTokens" in compatibility) {
      if (compatibility.maxTokens !== undefined && compatibility.maxTokens > 0) {
        output.maxOutputTokens = compatibility.maxTokens
      } else {
        const originalMaxOutputTokens = typeof output.maxOutputTokens === "number"
          ? output.maxOutputTokens
          : compatibility.maxTokens
        output.maxOutputTokens = SAFE_MAX_OUTPUT_TOKENS_FALLBACK
        if (typeof originalMaxOutputTokens === "number" && originalMaxOutputTokens <= 0) {
          log(
            `[plugin] maxOutputTokens=${originalMaxOutputTokens} is non-positive; using safe fallback ${SAFE_MAX_OUTPUT_TOKENS_FALLBACK}`,
          )
        }
      }
    }

    if ("thinking" in compatibility) {
      if (compatibility.thinking !== undefined) {
        output.options.thinking = compatibility.thinking
      } else {
        delete output.options.thinking
      }
    }
  }
}
