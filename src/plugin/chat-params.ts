import { normalizeSDKResponse } from "../shared/normalize-sdk-response"
import { getSessionPromptParams } from "../shared/session-prompt-params-state"
import { resolveCompatibleModelSettings } from "../shared"

export type ChatParamsInput = {
  sessionID: string
  agent: { name?: string }
  model: { providerID: string; modelID: string }
  provider: { id: string }
  message: { variant?: string }
}

type ChatParamsHookInput = ChatParamsInput & {
  rawMessage?: Record<string, unknown>
}

export type ChatParamsOutput = {
  temperature?: number
  topP?: number
  topK?: number
  options: Record<string, unknown>
}

type ProviderListClient = {
  provider?: {
    list?: () => Promise<unknown>
  }
}

type ProviderModelMetadata = {
  variants?: Record<string, unknown>
}

type ProviderListEntry = {
  id?: string
  models?: Record<string, ProviderModelMetadata>
}

type ProviderListData = {
  all?: ProviderListEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
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
  const variant = message.variant

  if (typeof providerID !== "string") return null
  if (typeof modelID !== "string") return null
  if (typeof providerId !== "string") return null

  return {
    sessionID,
    agent: { name: agentName },
    model: { providerID, modelID },
    provider: { id: providerId },
    message,
    rawMessage: message,
    ...(typeof variant === "string" ? {} : {}),
  }
}

function isChatParamsOutput(raw: unknown): raw is ChatParamsOutput {
  if (!isRecord(raw)) return false
  if (!isRecord(raw.options)) {
    raw.options = {}
  }
  return isRecord(raw.options)
}

async function getVariantCapabilities(
  client: ProviderListClient | undefined,
  model: { providerID: string; modelID: string },
): Promise<string[] | undefined> {
  const providerList = client?.provider?.list
  if (typeof providerList !== "function") {
    return undefined
  }

  try {
    const response = await providerList()
    const data = normalizeSDKResponse<ProviderListData>(response, {})
    const providerEntry = data.all?.find((entry) => entry.id === model.providerID)
    const variants = providerEntry?.models?.[model.modelID]?.variants
    if (!variants) {
      return undefined
    }

    return Object.keys(variants)
  } catch {
    return undefined
  }
}

export function createChatParamsHandler(args: {
  anthropicEffort: { "chat.params"?: (input: ChatParamsHookInput, output: ChatParamsOutput) => Promise<void> } | null
  client?: ProviderListClient
}): (input: unknown, output: unknown) => Promise<void> {
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
      if (storedPromptParams.options) {
        output.options = {
          ...output.options,
          ...storedPromptParams.options,
        }
      }
    }

    const variantCapabilities = await getVariantCapabilities(args.client, normalizedInput.model)

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
      },
      capabilities: {
        variants: variantCapabilities,
      },
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
      output.options.reasoningEffort = compatibility.reasoningEffort
    } else if ("reasoningEffort" in output.options) {
      delete output.options.reasoningEffort
    }

    await args.anthropicEffort?.["chat.params"]?.(normalizedInput, output)
  }
}
