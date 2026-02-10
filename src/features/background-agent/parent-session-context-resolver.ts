import type { OpencodeClient } from "./constants"
import type { BackgroundTask } from "./types"
import { findNearestMessageWithFields } from "../hook-message-injector"
import { getMessageDir } from "./message-storage-locator"

type AgentModel = { providerID: string; modelID: string }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function extractAgentAndModelFromMessage(message: unknown): {
  agent?: string
  model?: AgentModel
} {
  if (!isObject(message)) return {}
  const info = message["info"]
  if (!isObject(info)) return {}

  const agent = typeof info["agent"] === "string" ? info["agent"] : undefined
  const modelObj = info["model"]
  if (isObject(modelObj)) {
    const providerID = modelObj["providerID"]
    const modelID = modelObj["modelID"]
    if (typeof providerID === "string" && typeof modelID === "string") {
      return { agent, model: { providerID, modelID } }
    }
  }

  const providerID = info["providerID"]
  const modelID = info["modelID"]
  if (typeof providerID === "string" && typeof modelID === "string") {
    return { agent, model: { providerID, modelID } }
  }

  return { agent }
}

export async function resolveParentSessionAgentAndModel(input: {
  client: OpencodeClient
  task: BackgroundTask
}): Promise<{ agent?: string; model?: AgentModel }> {
  const { client, task } = input

  let agent: string | undefined = task.parentAgent
  let model: AgentModel | undefined

  try {
    const messagesResp = await client.session.messages({
      path: { id: task.parentSessionID },
    })

    const messagesRaw = "data" in messagesResp ? messagesResp.data : []
    const messages = Array.isArray(messagesRaw) ? messagesRaw : []

    for (let i = messages.length - 1; i >= 0; i--) {
      const extracted = extractAgentAndModelFromMessage(messages[i])
      if (extracted.agent || extracted.model) {
        agent = extracted.agent ?? task.parentAgent
        model = extracted.model
        break
      }
    }
  } catch {
    const messageDir = getMessageDir(task.parentSessionID)
    const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
    agent = currentMessage?.agent ?? task.parentAgent
    model =
      currentMessage?.model?.providerID && currentMessage?.model?.modelID
        ? { providerID: currentMessage.model.providerID, modelID: currentMessage.model.modelID }
        : undefined
  }

  return { agent, model }
}
