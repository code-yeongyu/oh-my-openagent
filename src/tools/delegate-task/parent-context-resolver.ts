import type { ToolContextWithMetadata } from "./types"
import type { OpencodeClient } from "./types"
import type { ParentContext } from "./executor-types"
import {
  findFirstMessageWithAgent,
  findFirstMessageWithAgentFromSDK,
  findNearestMessageWithFields,
  findNearestMessageWithFieldsFromSDK,
} from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { getMessageDir } from "../../shared/opencode-message-dir"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"

export async function resolveParentContext(
  ctx: ToolContextWithMetadata,
  client: OpencodeClient
): Promise<ParentContext> {
  const messageDir = getMessageDir(ctx.sessionID)

  const [prevMessage, firstMessageAgent] = isSqliteBackend()
    ? await Promise.all([
        findNearestMessageWithFieldsFromSDK(client, ctx.sessionID),
        findFirstMessageWithAgentFromSDK(client, ctx.sessionID),
      ])
    : [
        messageDir ? findNearestMessageWithFields(messageDir) : null,
        messageDir ? findFirstMessageWithAgent(messageDir) : null,
      ]

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
