import type { ToolContextWithMetadata, OpencodeClient } from "./types"
import type { SessionMessage } from "./executor-types"
import { getDefaultSyncPollTimeoutMs, getTimingConfig } from "./timing"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared"
import { extractErrorMessage } from "../../features/background-agent/error-classifier"

const NON_TERMINAL_FINISH_REASONS = new Set(["tool-calls", "unknown"])
const PENDING_TOOL_PART_TYPES = new Set(["tool", "tool_use", "tool-call"])
const ACTIVE_SESSION_STATUSES = new Set(["busy", "retry", "running"])

type SessionMessageRecord = SessionMessage & Record<string, unknown>

type MessageIdentity = {
  id?: string
  role?: string
  finish?: string
  error?: unknown
  created?: number
  completed?: number
}

function getMessageIdentity(message: SessionMessage): MessageIdentity {
  const record = message as SessionMessageRecord
  const info = (record.info ?? {}) as Record<string, unknown>
  const time = (record.time ?? info.time ?? {}) as Record<string, unknown>

  const id = typeof info.id === "string" ? info.id : typeof record.id === "string" ? record.id : undefined
  const role = typeof info.role === "string" ? info.role : typeof record.role === "string" ? record.role : undefined
  const finish = typeof info.finish === "string" ? info.finish : typeof record.finish === "string" ? record.finish : undefined
  const error = info.error ?? record.error
  const created = typeof time.created === "number" ? time.created : undefined
  const completed = typeof time.completed === "number" ? time.completed : undefined

  return { id, role, finish, error, created, completed }
}

function hasMeaningfulAssistantPayload(message: SessionMessage): boolean {
  if (getMessageText(message).length > 0) {
    return true
  }

  if ((message.parts?.length ?? 0) > 0) {
    return true
  }

  const record = message as SessionMessageRecord
  const tokens = (record.tokens ?? {}) as Record<string, unknown>
  const outputTokens = typeof tokens.output === "number" ? tokens.output : 0
  const reasoningTokens = typeof tokens.reasoning === "number" ? tokens.reasoning : 0
  const cost = typeof record.cost === "number" ? record.cost : 0

  return outputTokens > 0 || reasoningTokens > 0 || cost > 0
}

function isTerminalAssistantMessage(message: SessionMessage | undefined): boolean {
  if (!message) return false
  const identity = getMessageIdentity(message)
  if (identity.finish) {
    if (NON_TERMINAL_FINISH_REASONS.has(identity.finish)) return false
    if (message.parts?.some((part) => part.type && PENDING_TOOL_PART_TYPES.has(part.type))) return false
    return true
  }

  return identity.completed !== undefined && hasMeaningfulAssistantPayload(message)
}

function compareMessageOrder(a: SessionMessage | undefined, b: SessionMessage | undefined): boolean {
  if (!a || !b) return false
  const aIdentity = getMessageIdentity(a)
  const bIdentity = getMessageIdentity(b)

  if (aIdentity.id && bIdentity.id) {
    return aIdentity.id < bIdentity.id
  }

  if (aIdentity.created !== undefined && bIdentity.created !== undefined) {
    return aIdentity.created < bIdentity.created
  }

  return false
}

function getMessageText(message: SessionMessage): string {
  const parts = message.parts ?? []
  return parts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => (part.text ?? "").trim())
    .filter(Boolean)
    .join("\n")
}

function isAssistantMessage(message: SessionMessage): boolean {
  return getMessageIdentity(message).role === "assistant"
}

function isUserMessage(message: SessionMessage): boolean {
  return getMessageIdentity(message).role === "user"
}

function getLastMessageByRole(messages: SessionMessage[], role: "assistant" | "user"): SessionMessage | undefined {
  return [...messages].reverse().find((message) => getMessageIdentity(message).role === role)
}

function hasAnyAssistantText(messages: SessionMessage[]): boolean {
  return messages.some((message) => isAssistantMessage(message) && getMessageText(message).length > 0)
}

function wait(milliseconds: number): Promise<void> {
  const sharedBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const typedArray = new Int32Array(sharedBuffer)
  const result = Atomics.waitAsync(typedArray, 0, 0, milliseconds)
  return result.async ? result.value.then(() => undefined) : Promise.resolve()
}

function abortSyncSession(client: OpencodeClient, sessionID: string, reason: string): void {
  log("[task] Aborting sync session", { sessionID, reason })
  void client.session.abort({
    path: { id: sessionID },
  }).catch((error: unknown) => {
    log("[task] Failed to abort sync session", { sessionID, reason, error: String(error) })
  })
}

function isActiveSessionStatus(status: { type: string } | undefined): boolean {
  return status !== undefined && ACTIVE_SESSION_STATUSES.has(status.type)
}

async function fetchSessionMessages(
  client: OpencodeClient,
  sessionID: string
): Promise<SessionMessage[]> {
  const messagesResult = await client.session.messages({ path: { id: sessionID } })
  const rawData = (messagesResult as { data?: unknown })?.data ?? messagesResult
  return Array.isArray(rawData) ? (rawData as SessionMessage[]) : []
}

function getTerminalSessionError(messages: SessionMessage[]): string | null {
  const lastAssistant = getLastMessageByRole(messages, "assistant")
  const lastUser = getLastMessageByRole(messages, "user")
  if (compareMessageOrder(lastAssistant, lastUser)) {
    return null
  }

  const { error } = lastAssistant ? getMessageIdentity(lastAssistant) : {}
  if (error === undefined) {
    return null
  }

  const errorMessage = extractErrorMessage(error)
  return errorMessage && errorMessage.length > 0 ? errorMessage : "Session error"
}

export function isSessionComplete(messages: SessionMessage[]): boolean {
  const lastUser = getLastMessageByRole(messages, "user")
  const lastAssistant = getLastMessageByRole(messages, "assistant")

  if (!isTerminalAssistantMessage(lastAssistant)) return false
  return compareMessageOrder(lastUser, lastAssistant)
}

const DEFAULT_MAX_ASSISTANT_TURNS = 300

export async function pollSyncSession(
  ctx: ToolContextWithMetadata,
  client: OpencodeClient,
  input: {
    sessionID: string
    agentToUse: string
    toastManager: { removeTask: (id: string) => void } | null | undefined
    taskId: string | undefined
    anchorMessageCount?: number
    maxAssistantTurns?: number
  },
  timeoutMs?: number
): Promise<string | null> {
  const syncTiming = getTimingConfig()
  const maxPollTimeMs = Math.max(timeoutMs ?? getDefaultSyncPollTimeoutMs(), 50)
  const maxTurns = input.maxAssistantTurns ?? DEFAULT_MAX_ASSISTANT_TURNS
  const pollStart = Date.now()
  let inactiveStart = pollStart
  let pollCount = 0
  let timedOut = false
  let assistantTurnCount = 0
  let lastSeenAssistantId: string | undefined

  log("[task] Starting poll loop", { sessionID: input.sessionID, agentToUse: input.agentToUse, maxTurns })

  while (true) {
    const inactiveElapsedMs = Date.now() - inactiveStart
    if (inactiveElapsedMs >= maxPollTimeMs) {
      timedOut = true
      break
    }

    if (ctx.abort?.aborted) {
      let finalMessages: SessionMessage[] | null = null
      const abortFetchAttempts = 3
      for (let attempt = 1; attempt <= abortFetchAttempts; attempt++) {
        try {
          finalMessages = await fetchSessionMessages(client, input.sessionID)
          break
        } catch (error) {
          log("[task] Final messages fetch failed after abort, retrying", {
            sessionID: input.sessionID,
            attempt,
            maxAttempts: abortFetchAttempts,
            error: String(error),
          })
          if (attempt < abortFetchAttempts) {
            await wait(syncTiming.POLL_INTERVAL_MS)
          }
        }
      }

      if (finalMessages) {
        const hasNewMessages =
          input.anchorMessageCount === undefined || finalMessages.length > input.anchorMessageCount
        if (hasNewMessages && isSessionComplete(finalMessages)) {
          log("[task] Abort detected after session already completed", { sessionID: input.sessionID })
          return null
        }
      }

      log("[task] Aborted by user", { sessionID: input.sessionID })
      abortSyncSession(client, input.sessionID, "parent_abort")
      if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
      return `Task aborted.\n\nSession ID: ${input.sessionID}`
    }

    await wait(syncTiming.POLL_INTERVAL_MS)
    pollCount++

    let statusResult: { data?: Record<string, { type: string }> }
    try {
      statusResult = await client.session.status()
    } catch (error) {
      log("[task] Poll status fetch failed, retrying", { sessionID: input.sessionID, error: String(error) })
      continue
    }
    const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
    const sessionStatus = allStatuses[input.sessionID]

    if (pollCount % 10 === 0) {
      log("[task] Poll status", {
        sessionID: input.sessionID,
        pollCount,
        elapsed: Math.floor((Date.now() - pollStart) / 1000) + "s",
        inactiveElapsed: Math.floor(inactiveElapsedMs / 1000) + "s",
        sessionStatus: sessionStatus?.type ?? "not_in_status",
      })
    }

    if (isActiveSessionStatus(sessionStatus)) {
      inactiveStart = Date.now()
      continue
    }

    let messages: SessionMessage[]
    try {
      messages = await fetchSessionMessages(client, input.sessionID)
    } catch (error) {
      log("[task] Poll messages fetch failed, retrying", { sessionID: input.sessionID, error: String(error) })
      continue
    }

    if (input.anchorMessageCount !== undefined && messages.length <= input.anchorMessageCount) {
      continue
    }

    const sessionError = getTerminalSessionError(messages)
    if (sessionError) {
      log("[task] Poll detected terminal session error", { sessionID: input.sessionID, sessionError })
      return sessionError
    }

    if (isSessionComplete(messages)) {
      log("[task] Poll complete - terminal finish detected", { sessionID: input.sessionID, pollCount })
      break
    }

    // Count new assistant turns to circuit-break infinite loops
    const lastAssistant = getLastMessageByRole(messages, "assistant")
    const lastAssistantIdentity = lastAssistant ? getMessageIdentity(lastAssistant) : undefined
    const lastAssistantMarker = lastAssistantIdentity?.id ?? `created:${lastAssistantIdentity?.created ?? "none"}`
    if (lastAssistantIdentity?.role === "assistant" && lastAssistantMarker !== lastSeenAssistantId) {
      lastSeenAssistantId = lastAssistantMarker
      assistantTurnCount++
      if (assistantTurnCount >= maxTurns) {
        log("[task] Max assistant turns reached, aborting to prevent infinite loop", {
          sessionID: input.sessionID,
          assistantTurnCount,
          maxTurns,
        })
        abortSyncSession(client, input.sessionID, "max_turns_exceeded")
        if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
        return `Task aborted: subagent exceeded ${maxTurns} assistant turns without completing. This usually indicates an infinite tool-call loop. Session ID: ${input.sessionID}`
      }
    }

    const hasAssistantText = hasAnyAssistantText(messages)

    if (lastAssistant && !lastAssistantIdentity?.finish && lastAssistantIdentity?.completed === undefined && hasAssistantText) {
      log("[task] Poll complete - assistant text detected (fallback)", {
        sessionID: input.sessionID,
        pollCount,
      })
      break
    }
  }

  if (timedOut) {
    log("[task] Poll inactivity timeout reached", { sessionID: input.sessionID, pollCount })
    abortSyncSession(client, input.sessionID, "poll_timeout")
  }

  return timedOut
    ? `Poll inactivity timeout reached after ${maxPollTimeMs}ms without active OpenCode status for session ${input.sessionID}`
    : null
}
