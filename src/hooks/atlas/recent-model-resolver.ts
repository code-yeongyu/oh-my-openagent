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
      id?: string
      info?: {
        model?: ModelInfo
        modelID?: string
        providerID?: string
        tools?: Record<string, boolean | "allow" | "deny" | "ask">
        time?: { created?: number }
      }
    }>).sort((left, right) => {
      const leftTime = left.info?.time?.created ?? Number.NEGATIVE_INFINITY
      const rightTime = right.info?.time?.created ?? Number.NEGATIVE_INFINITY
      if (leftTime !== rightTime) return rightTime - leftTime
      const leftId = typeof left.id === "string" ? left.id : ""
      const rightId = typeof right.id === "string" ? right.id : ""
      return rightId.localeCompare(leftId)
    })

    for (const message of messages) {
      const info = message.info
      const model = info?.model
      const tools = normalizePromptTools(info?.tools)
      if (model?.providerID && model?.modelID) {
        return {
          model: {
            providerID: model.providerID,
            modelID: model.modelID,
            ...(model.variant ? { variant: model.variant } : {}),
          },
          tools,
        }
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
  return {
    model: {
      providerID: model.providerID,
      modelID: model.modelID,
      ...(model.variant ? { variant: model.variant } : {}),
    },
    tools,
  }
}

export async function resolveRecentModelForSession(
  ctx: PluginInput,
  sessionID: string
): Promise<ModelInfo | undefined> {
  const context = await resolveRecentPromptContextForSession(ctx, sessionID)
  return context.model
}
