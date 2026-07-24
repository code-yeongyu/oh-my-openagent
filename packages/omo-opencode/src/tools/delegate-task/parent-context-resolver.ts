import type { ToolContextWithMetadata } from "./types"
import type { OpencodeClient } from "./types"
import type { ParentContext } from "./executor-types"
import { requireSpawnCallerIdentity } from "../../features/background-agent/subagent-spawn-limits"
import { resolveMessageContext } from "../../features/hook-message-injector"
import { log } from "../../shared/logger"
import { getMessageDir } from "../../shared/opencode-message-dir"

export async function resolveParentContext(
  ctx: ToolContextWithMetadata,
  client: OpencodeClient
): Promise<ParentContext> {
  const parentAgent = requireSpawnCallerIdentity(ctx.agent)
  const messageDir = getMessageDir(ctx.sessionID)
  const { prevMessage } = await resolveMessageContext(
    ctx.sessionID,
    client,
    messageDir
  )

  log("[task] trusted parent agent", {
    sessionID: ctx.sessionID,
    messageDir,
    ctxAgent: ctx.agent,
    parentAgent,
  })

  const parentModel = prevMessage?.model?.providerID && prevMessage?.model?.modelID
    ? {
        providerID: prevMessage.model.providerID,
        modelID: prevMessage.model.modelID,
        ...(prevMessage.model.variant ? { variant: prevMessage.model.variant } : {}),
      }
    : undefined

  return {
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    agent: parentAgent,
    model: parentModel,
  }
}
