import type { PluginInput } from "@opencode-ai/plugin"

import { subagentSessions } from "../../features/claude-code-session-state"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"

import {
  extractAssistantText,
  getLastAssistantMessage,
  isGptAssistantMessage,
  type SessionMessage,
} from "./assistant-message"
import {
  CONTINUATION_PROMPT,
  HOOK_NAME,
  MAX_CONSECUTIVE_AUTO_CONTINUES,
} from "./constants"
import { detectStallPattern, extractPermissionPhrase } from "./detector"
import { buildContextualContinuationPrompt } from "./prompt-builder"
import type { SessionStateStore } from "./session-state"

type SessionState = ReturnType<SessionStateStore["getState"]>

async function promptContinuation(
  ctx: PluginInput,
  sessionID: string,
  assistantText: string,
): Promise<void> {
  const prompt = buildContextualContinuationPrompt(assistantText)
  const payload = {
    path: { id: sessionID },
    body: {
      parts: [{ type: "text" as const, text: prompt }],
    },
    query: { directory: ctx.directory },
  }

  if (typeof ctx.client.session.promptAsync === "function") {
    await ctx.client.session.promptAsync(payload)
    return
  }

  await ctx.client.session.prompt(payload)
}

function getLastUserMessageBefore(
  messages: SessionMessage[],
  lastAssistantIndex: number,
): SessionMessage | null {
  for (let index = lastAssistantIndex - 1; index >= 0; index--) {
    if (messages[index].info?.role === "user") {
      return messages[index]
    }
  }

  return null
}

function isAutoContinuationUserMessage(message: SessionMessage): boolean {
  const text = extractAssistantText(message).trim().toLowerCase()
  return text === CONTINUATION_PROMPT || text.startsWith(`${CONTINUATION_PROMPT}\n`)
}

function resetAutoContinuationState(state: SessionState): void {
  state.consecutiveAutoContinueCount = 0
  state.awaitingAutoContinuationResponse = false
  state.lastAutoContinuePermissionPhrase = undefined
}

export function createGptPermissionContinuationHandler(args: {
  ctx: PluginInput
  sessionStateStore: SessionStateStore
  isContinuationStopped?: (sessionID: string) => boolean
}): (input: { event: { type: string; properties?: unknown } }) => Promise<void> {
  const { ctx, sessionStateStore, isContinuationStopped } = args

  return async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const properties = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionID = (properties?.info as { id?: string } | undefined)?.id
      if (sessionID) {
        sessionStateStore.cleanup(sessionID)
      }
      return
    }

    if (event.type !== "session.idle") return

    const sessionID = properties?.sessionID as string | undefined
    if (!sessionID) return

    if (subagentSessions.has(sessionID)) {
      log(`[${HOOK_NAME}] Skipped: session is a subagent`, { sessionID })
      return
    }
    if (isContinuationStopped?.(sessionID)) {
      log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
      return
    }

    const state = sessionStateStore.getState(sessionID)
    if (state.inFlight) {
      log(`[${HOOK_NAME}] Skipped: prompt already in flight`, { sessionID })
      return
    }

    try {
      const messagesResponse = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const messages = normalizeSDKResponse(messagesResponse, [] as SessionMessage[], {
        preferResponseOnMissingData: true,
      })
      const lastAssistantMessage = getLastAssistantMessage(messages)
      if (!lastAssistantMessage) return

      const lastAssistantIndex = messages.lastIndexOf(lastAssistantMessage)
      const previousUserMessage = getLastUserMessageBefore(messages, lastAssistantIndex)
      const previousUserMessageWasAutoContinuation =
        previousUserMessage !== null
        && state.awaitingAutoContinuationResponse
        && isAutoContinuationUserMessage(previousUserMessage)

      if (previousUserMessageWasAutoContinuation) {
        state.awaitingAutoContinuationResponse = false
      } else if (previousUserMessage) {
        resetAutoContinuationState(state)
      } else {
        state.awaitingAutoContinuationResponse = false
      }

      const messageID = lastAssistantMessage.info?.id
      if (messageID && state.lastHandledMessageID === messageID) {
        log(`[${HOOK_NAME}] Skipped: already handled assistant message`, { sessionID, messageID })
        return
      }

      if (lastAssistantMessage.info?.error) {
        log(`[${HOOK_NAME}] Skipped: last assistant message has error`, { sessionID, messageID })
        return
      }

      if (!isGptAssistantMessage(lastAssistantMessage)) {
        log(`[${HOOK_NAME}] Skipped: last assistant model is not GPT`, { sessionID, messageID })
        return
      }

      const assistantText = extractAssistantText(lastAssistantMessage)
      if (!detectStallPattern(assistantText)) {
        return
      }

      const permissionPhrase = extractPermissionPhrase(assistantText)
      if (!permissionPhrase) {
        return
      }

      if (state.consecutiveAutoContinueCount >= MAX_CONSECUTIVE_AUTO_CONTINUES) {
        state.lastHandledMessageID = messageID
        log(`[${HOOK_NAME}] Skipped: reached max consecutive auto-continues`, {
          sessionID,
          messageID,
          consecutiveAutoContinueCount: state.consecutiveAutoContinueCount,
        })
        return
      }

      if (
        state.consecutiveAutoContinueCount >= 1
        && state.lastAutoContinuePermissionPhrase === permissionPhrase
      ) {
        state.lastHandledMessageID = messageID
        log(`[${HOOK_NAME}] Skipped: repeated permission phrase after auto-continue`, {
          sessionID,
          messageID,
          permissionPhrase,
        })
        return
      }

      state.inFlight = true
      await promptContinuation(ctx, sessionID, assistantText)
      state.lastHandledMessageID = messageID
      state.consecutiveAutoContinueCount += 1
      state.awaitingAutoContinuationResponse = true
      state.lastAutoContinuePermissionPhrase = permissionPhrase
      state.lastInjectedAt = Date.now()
      log(`[${HOOK_NAME}] Injected continuation prompt`, { sessionID, messageID })
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to inject continuation prompt`, {
        sessionID,
        error: String(error),
      })
    } finally {
      state.inFlight = false
    }
  }
}
