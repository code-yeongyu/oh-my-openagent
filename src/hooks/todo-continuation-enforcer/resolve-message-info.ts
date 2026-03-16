import type { PluginInput } from "@opencode-ai/plugin"

import { normalizeSDKResponse } from "../../shared"

import type { MessageInfo, ResolvedMessageInfo } from "./types"

export async function resolveLatestMessageInfo(
  ctx: PluginInput,
  sessionID: string
): Promise<ResolvedMessageInfo | undefined> {
  const messagesResp = await ctx.client.session.messages({
    path: { id: sessionID },
  })
  const messages = normalizeSDKResponse(messagesResp, [] as Array<{ info?: MessageInfo }>)

  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i].info
    if (info?.agent === "compaction") {
      continue
    }
    if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
      return {
        agent: info.agent,
        model: info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined),
        tools: info.tools,
      }
    }
  }

  return undefined
}
