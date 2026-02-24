import type { ToolContextWithMetadata } from "./types"
import type { OpencodeClient } from "./types"
import type { ParentContext } from "./executor-types"
import { resolveMessageContext } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { getMessageDir } from "../../shared/opencode-message-dir"
import { safeCompress, type ToonCompressionConfig } from "../../shared/toon-compression"


export async function resolveParentContext(
  ctx: ToolContextWithMetadata,
  client: OpencodeClient
): Promise<ParentContext> {
  const messageDir = getMessageDir(ctx.sessionID)
  const { prevMessage, firstMessageAgent } = await resolveMessageContext(
    ctx.sessionID,
    client,
    messageDir
  )

  const sessionAgent = getSessionAgent(ctx.sessionID)
  const parentAgent = ctx.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent

  log("[task] parentAgent resolution", {
    sessionID: ctx.sessionID,
    messageDir,
    ctxAgent: ctx.agent,
    sessionAgent,
    firstMessageAgent,
    prevMessageAgent: prevMessage?.agent,
    resolvedParentAgent: parentAgent,
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

/**
 * Serialize a ParentContext for transfer, applying TOON compression if enabled.
 * Use this when passing context to external systems or when serialization is required.
 */
export function compressParentContext(
  context: ParentContext,
  config: ToonCompressionConfig
): string {
  return safeCompress(context, config)
}
