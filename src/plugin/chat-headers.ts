import { OMO_INTERNAL_INITIATOR_MARKER } from "../shared"

type ChatHeadersInput = {
  provider: { id: string }
  message: {
    info?: { role?: string }
    parts?: Array<{ type?: string; text?: string; synthetic?: boolean }>
  }
}

type ChatHeadersOutput = {
  headers: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function buildChatHeadersInput(raw: unknown): ChatHeadersInput | null {
  if (!isRecord(raw)) return null

  const provider = raw.provider
  const message = raw.message

  if (!isRecord(provider) || typeof provider.id !== "string") return null
  if (!isRecord(message)) return null

  const info = isRecord(message.info) ? message.info : undefined
  const rawParts = Array.isArray(message.parts) ? message.parts : undefined

  const parts = rawParts
    ?.filter(isRecord)
    .map((part) => ({
      type: typeof part.type === "string" ? part.type : undefined,
      text: typeof part.text === "string" ? part.text : undefined,
      synthetic: part.synthetic === true,
    }))

  return {
    provider: { id: provider.id },
    message: {
      info: info ? { role: typeof info.role === "string" ? info.role : undefined } : undefined,
      parts,
    },
  }
}

function isChatHeadersOutput(raw: unknown): raw is ChatHeadersOutput {
  if (!isRecord(raw)) return false
  if (!isRecord(raw.headers)) {
    raw.headers = {}
  }
  return isRecord(raw.headers)
}

function isCopilotProvider(providerID: string): boolean {
  return providerID === "github-copilot" || providerID === "github-copilot-enterprise"
}

function isOmoInternalMessage(input: ChatHeadersInput): boolean {
  if (input.message.info?.role !== "user") {
    return false
  }

  return input.message.parts?.some((part) => {
    if (part.type !== "text" || !part.text || part.synthetic !== true) {
      return false
    }

    return part.text.includes(OMO_INTERNAL_INITIATOR_MARKER)
  }) ?? false
}

export function createChatHeadersHandler(): (input: unknown, output: unknown) => Promise<void> {
  return async (input, output): Promise<void> => {
    const normalizedInput = buildChatHeadersInput(input)
    if (!normalizedInput) return
    if (!isChatHeadersOutput(output)) return

    if (!isCopilotProvider(normalizedInput.provider.id)) return
    if (!isOmoInternalMessage(normalizedInput)) return

    output.headers["x-initiator"] = "agent"
  }
}
