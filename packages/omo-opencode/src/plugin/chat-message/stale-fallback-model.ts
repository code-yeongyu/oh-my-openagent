import { getMainSessionID, subagentSessions } from "../../features/claude-code-session-state"
import { isSyntheticOrInternalUserMessage, log, normalizeSDKResponse } from "../../shared"
import { setSessionModel, type SessionModel } from "../../shared/session-model-state"
import { isCompactionAgent } from "../../hooks/compaction-context-injector/session-id"
import type { PluginContext } from "../types"
import type { ChatMessageHandlerOutput, ChatMessageInput } from "./types"

type SessionInfo = { readonly title?: string }
type SessionMessage = {
  readonly info?: {
    readonly role?: string
    readonly agent?: string
    readonly model?: {
      readonly providerID?: string
      readonly modelID?: string
    }
    readonly providerID?: string
    readonly modelID?: string
  }
  readonly parts?: ReadonlyArray<{
    readonly type?: string
    readonly text?: string
    readonly synthetic?: boolean
  }>
}

const BOULDER_CONTINUATION_MARKER = "BOULDER CONTINUATION"

function parseFallbackMarker(title: string | undefined): SessionModel | undefined {
  const match = title?.match(/\s*\[fallback:\s*([^/\]\s]+)\/([^\]\s]+)(?:\s+[^\]]+)?\]$/i)
  if (!match?.[1] || !match[2]) return undefined
  return { providerID: match[1], modelID: match[2] }
}

function sameModel(a: SessionModel | undefined, b: SessionModel | undefined): boolean {
  return !!a && !!b && a.providerID === b.providerID && a.modelID === b.modelID
}

function messageModel(message: SessionMessage): SessionModel | undefined {
  const info = message.info
  if (isCompactionAgent(info?.agent)) return undefined
  const providerID = info?.model?.providerID ?? info?.providerID
  const modelID = info?.model?.modelID ?? info?.modelID
  return providerID && modelID ? { providerID, modelID } : undefined
}

function isInternalContinuationMessage(message: SessionMessage): boolean {
  if (isSyntheticOrInternalUserMessage(message)) return true
  return (message.parts ?? []).some((part) =>
    part.type === "text" &&
    typeof part.text === "string" &&
    part.text.includes(BOULDER_CONTINUATION_MARKER)
  )
}

async function findPreviousNonFallbackModel(
  ctx: PluginContext,
  sessionID: string,
  fallback: SessionModel,
): Promise<SessionModel | undefined> {
  const response = await ctx.client.session.messages({ path: { id: sessionID } })
  const messages = normalizeSDKResponse(response, [] as SessionMessage[], {
    preferResponseOnMissingData: true,
  })

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || isInternalContinuationMessage(message)) continue
    const model = messageModel(message)
    if (model && !sameModel(model, fallback)) return model
  }

  return undefined
}

export async function recoverStaleFallbackSessionModel(args: {
  readonly ctx: PluginContext
  readonly input: ChatMessageInput
  readonly output: ChatMessageHandlerOutput
  readonly modelFallback: { hasPendingModelFallback?: (sessionID: string) => boolean } | null | undefined
}): Promise<void> {
  const { ctx, input, output, modelFallback } = args
  if (!input.sessionID || !input.model) return
  if (subagentSessions.has(input.sessionID)) return
  if (getMainSessionID() !== input.sessionID) return
  if (modelFallback?.hasPendingModelFallback?.(input.sessionID)) return
  if (
    typeof ctx.client.session?.get !== "function" ||
    typeof ctx.client.session?.messages !== "function"
  ) {
    return
  }

  const sessionResp = await ctx.client.session.get({ path: { id: input.sessionID } }).catch(() => null)
  const sessionInfo = sessionResp
    ? normalizeSDKResponse<SessionInfo | null>(sessionResp, null, { preferResponseOnMissingData: true })
    : null
  const rawTitle = sessionInfo?.title
  const fallback = parseFallbackMarker(rawTitle)
  if (!fallback) return
  if (!sameModel(input.model, fallback)) return

  const restored = await findPreviousNonFallbackModel(ctx, input.sessionID, fallback).catch(() => undefined)
  if (!restored) return

  output.message.model = restored
  setSessionModel(input.sessionID, restored)

  const restoredTitle = typeof rawTitle === "string"
    ? rawTitle.replace(/\s*\[fallback:[^\]]+\]$/i, "").trim()
    : undefined
  if (restoredTitle && typeof ctx.client.session.update === "function") {
    await ctx.client.session.update({
      path: { id: input.sessionID },
      body: { title: restoredTitle },
      query: { directory: ctx.directory },
    }).catch(() => {})
  }

  log("[chat-message] Recovered stale fallback session model", {
    sessionID: input.sessionID,
    fallback,
    restored,
  })
}
