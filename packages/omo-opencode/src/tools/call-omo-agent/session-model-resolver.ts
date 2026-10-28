import type { PluginInput } from "@opencode-ai/plugin"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
import { getSessionModel } from "../../shared/session-model-state"

type SessionMessage = {
  info?: {
    role?: string
    agent?: string
    providerID?: string
    modelID?: string
    model?: { providerID?: string; modelID?: string }
    variant?: string
    time?: { created?: number }
  }
}

function messageModel(message: SessionMessage): DelegatedModelConfig | undefined {
  const info = message.info
  if (!info || (info.role !== "user" && info.role !== "assistant") || info.agent?.trim().toLowerCase() === "compaction") return undefined
  const providerID = info.model?.providerID ?? info.providerID
  const modelID = info.model?.modelID ?? info.modelID
  if (typeof providerID !== "string" || !providerID || typeof modelID !== "string" || !modelID) return undefined
  return { providerID, modelID, ...(typeof info.variant === "string" ? { variant: info.variant } : {}) }
}

function sameModel(left: DelegatedModelConfig | undefined, right: DelegatedModelConfig | undefined): boolean {
  return !!left && !!right && left.providerID === right.providerID && left.modelID === right.modelID
}

export async function resolveContinuationModel(
  client: PluginInput["client"],
  sessionID: string,
  creationModel?: DelegatedModelConfig,
): Promise<DelegatedModelConfig | undefined> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = Array.isArray(response) ? response : response.error ? undefined : response.data
    if (Array.isArray(messages)) {
      const candidates = (messages as SessionMessage[])
        .map((message, index) => ({ model: messageModel(message), created: message.info?.time?.created ?? index, index }))
        .sort((left, right) => right.created - left.created || right.index - left.index)
      const latestModel = candidates.find((entry) => entry.model)?.model
      if (latestModel) {
        const variant = latestModel.variant
          ?? candidates.find((entry) => sameModel(entry.model, latestModel) && entry.model?.variant)?.model?.variant
          ?? (sameModel(creationModel, latestModel) ? creationModel?.variant : undefined)
        return { ...latestModel, ...(variant ? { variant } : {}) }
      }
    }
  } catch {
    // Older clients may not expose message history; use the recorded child model.
  }
  const cachedModel = getSessionModel(sessionID)
  if (cachedModel) {
    return { ...cachedModel, ...(sameModel(cachedModel, creationModel) && creationModel?.variant ? { variant: creationModel.variant } : {}) }
  }
  return creationModel
}
