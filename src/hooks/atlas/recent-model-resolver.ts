import type { PluginInput } from "@opencode-ai/plugin"
import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { getMessageDir } from "../../shared/session-utils"
import type { ModelInfo } from "./types"

export async function resolveRecentModelForSession(
  ctx: PluginInput,
  sessionID: string
): Promise<ModelInfo | undefined> {
  try {
    const messagesResp = await ctx.client.session.messages({ path: { id: sessionID } })
    const messages = (messagesResp.data ?? []) as Array<{
      info?: { model?: ModelInfo; modelID?: string; providerID?: string }
    }>

    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i].info
      const model = info?.model
      if (model?.providerID && model?.modelID) {
        return { providerID: model.providerID, modelID: model.modelID }
      }

      if (info?.providerID && info?.modelID) {
        return { providerID: info.providerID, modelID: info.modelID }
      }
    }
  } catch {
    // ignore - fallback to message storage
  }

  const messageDir = getMessageDir(sessionID)
  const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
  const model = currentMessage?.model
  if (!model?.providerID || !model?.modelID) {
    return undefined
  }
  return { providerID: model.providerID, modelID: model.modelID }
}
