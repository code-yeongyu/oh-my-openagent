type ChatParamsInput = {
  sessionID: string
  agent: { name?: string }
  model: { providerID: string; modelID: string }
  provider: { id: string }
  message: { variant?: string }
}

type ChatParamsOutput = {
  temperature?: number
  topP?: number
  topK?: number
  options: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function buildChatParamsInput(raw: unknown): ChatParamsInput | null {
  if (!isRecord(raw)) return null

  const sessionID = raw.sessionID
  const agent = raw.agent
  const model = raw.model
  const provider = raw.provider
  const message = raw.message

  if (typeof sessionID !== "string") return null
  if (typeof agent !== "string") return null
  if (!isRecord(model)) return null
  if (!isRecord(provider)) return null
  if (!isRecord(message)) return null

  const providerID = model.providerID
  const modelID = model.modelID
  const providerId = provider.id
  const variant = message.variant

  if (typeof providerID !== "string") return null
  if (typeof modelID !== "string") return null
  if (typeof providerId !== "string") return null

  return {
    sessionID,
    agent: { name: agent },
    model: { providerID, modelID },
    provider: { id: providerId },
    message: typeof variant === "string" ? { variant } : {},
  }
}

function isChatParamsOutput(raw: unknown): raw is ChatParamsOutput {
  if (!isRecord(raw)) return false
  if (!isRecord(raw.options)) {
    raw.options = {}
  }
  return isRecord(raw.options)
}

export function createChatParamsHandler(args: {
  anthropicEffort: { "chat.params"?: (input: ChatParamsInput, output: ChatParamsOutput) => Promise<void> } | null
}): (input: unknown, output: unknown) => Promise<void> {
  return async (input, output): Promise<void> => {
    const normalizedInput = buildChatParamsInput(input)
    if (!normalizedInput) return
    if (!isChatParamsOutput(output)) return

    await args.anthropicEffort?.["chat.params"]?.(normalizedInput, output)
  }
}
