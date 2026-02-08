import type { ToolContextWithMetadata } from "./types"
import type { ParentContext } from "./executor-types"
import { findNearestMessageWithFields, findFirstMessageWithAgent } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { getMessageDir } from "../../shared/session-utils"

export function resolveParentContext(ctx: ToolContextWithMetadata): ParentContext {
  const messageDir = getMessageDir(ctx.sessionID)
  const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
  const firstMessageAgent = messageDir ? findFirstMessageWithAgent(messageDir) : null
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
