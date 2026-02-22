import type { PluginInput } from "@opencode-ai/plugin"
import {
  findNearestMessageWithFields,
  findNearestMessageWithFieldsFromSDK,
} from "../../features/hook-message-injector"
import { getMessageDir, isSqliteBackend, normalizePromptTools, normalizeSDKResponse } from "../../shared"
import type { ModelInfo } from "./types"

type PromptContext = {
  model?: ModelInfo
  tools?: Record<string, boolean>
}

export async function resolveRecentPromptContextForSession(
  ctx: PluginInput,
  sessionID: string
): Promise<PromptContext> {
  try {
    const messagesResp = await ctx.client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(messagesResp, [] as Array<{
      info?: {
        model?: ModelInfo
        modelID?: string
        providerID?: string
        tools?: Record<string, boolean | "allow" | "deny" | "ask">
      }
    }>)

    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i].info
      const model = info?.model
      const tools = normalizePromptTools(info?.tools)
      if (model?.providerID && model?.modelID) {
        return { model: { providerID: model.providerID, modelID: model.modelID }, tools }
      }

      if (info?.providerID && info?.modelID) {
        return { model: { providerID: info.providerID, modelID: info.modelID }, tools }
      }
    }
  } catch {
    // ignore - fallback to message storage
  }

  let currentMessage = null
  if (isSqliteBackend()) {
    currentMessage = await findNearestMessageWithFieldsFromSDK(ctx.client, sessionID)
  } else {
    const messageDir = getMessageDir(sessionID)
    currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
  }
  const model = currentMessage?.model
  const tools = normalizePromptTools(currentMessage?.tools)
  if (!model?.providerID || !model?.modelID) {
    return { tools }
  }
  return { model: { providerID: model.providerID, modelID: model.modelID }, tools }
}

export async function resolveRecentModelForSession(
  ctx: PluginInput,
  sessionID: string
): Promise<ModelInfo | undefined> {
  const context = await resolveRecentPromptContextForSession(ctx, sessionID)
  return context.model
}
