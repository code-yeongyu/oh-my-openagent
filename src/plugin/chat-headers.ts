import { OMO_INTERNAL_INITIATOR_MARKER } from "../shared"
import type { PluginContext } from "./types"

type ChatHeadersInput = {
  sessionID: string
  provider: { id: string }
  message: {
    id?: string
    role?: string
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

  const sessionID = raw.sessionID
  const provider = raw.provider
  const message = raw.message

  if (typeof sessionID !== "string") return null
  if (!isRecord(provider) || typeof provider.id !== "string") return null
  if (!isRecord(message)) return null

  return {
    sessionID,
    provider: { id: provider.id },
    message: {
      id: typeof message.id === "string" ? message.id : undefined,
      role: typeof message.role === "string" ? message.role : undefined,
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

async function hasInternalMarker(
  client: PluginContext["client"],
  sessionID: string,
  messageID: string,
): Promise<boolean> {
  try {
    const response = await client.session.message({
      path: { id: sessionID, messageID },
    })

    const data = response.data
    if (!isRecord(data) || !Array.isArray(data.parts)) return false

    return data.parts.some((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
        return false
      }

      return part.text.includes(OMO_INTERNAL_INITIATOR_MARKER)
    })
  } catch {
    return false
  }
}

async function isOmoInternalMessage(input: ChatHeadersInput, client: PluginContext["client"]): Promise<boolean> {
  if (input.message.role !== "user") {
    return false
  }

  if (!input.message.id) {
    return false
  }

  return hasInternalMarker(client, input.sessionID, input.message.id)
}

export function createChatHeadersHandler(args: { ctx: PluginContext }): (input: unknown, output: unknown) => Promise<void> {
  const { ctx } = args

  return async (input, output): Promise<void> => {
    const normalizedInput = buildChatHeadersInput(input)
    if (!normalizedInput) return
    if (!isChatHeadersOutput(output)) return

    if (!isCopilotProvider(normalizedInput.provider.id)) return
    if (!(await isOmoInternalMessage(normalizedInput, ctx.client))) return

    output.headers["x-initiator"] = "agent"
  }
}
