import type { PluginInput } from "@opencode-ai/plugin"

import { normalizeSDKResponse } from "../../shared"

import type { MessageInfo, ResolveLatestMessageInfoResult } from "./types"

export async function resolveLatestMessageInfo(
  ctx: PluginInput,
  sessionID: string
): Promise<ResolveLatestMessageInfoResult> {
  const messagesResp = await ctx.client.session.messages({
    path: { id: sessionID },
  })
  const messages = normalizeSDKResponse(messagesResp, [] as Array<{ info?: MessageInfo }>)
  let encounteredCompaction = false

  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i].info
    if (info?.agent === "compaction") {
      encounteredCompaction = true
      continue
    }
    if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
      return {
        resolvedInfo: {
          agent: info.agent,
          model: info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined),
          tools: info.tools,
        },
        encounteredCompaction,
      }
    }
  }

  return { resolvedInfo: undefined, encounteredCompaction }
}
