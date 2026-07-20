import type { ToolContextWithMetadata, OpencodeClient } from "./types"
import type { SessionMessage } from "./executor-types"
import { getDefaultSyncPollTimeoutMs, getTimingConfig } from "./timing"
import { getTerminalSessionError, isSessionComplete } from "./sync-session-turns"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared"

export { isSessionComplete } from "./sync-session-turns"

const ACTIVE_SESSION_STATUSES = new Set(["busy", "retry", "running"])
const CHILD_WAKE_GRACE_MS = 5_000

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

// Cheap fingerprint of "has anything actually moved" -- message count, the
// identity of the last message, how many parts it has, how long its last
// text/reasoning part is, and the last tool part's state. Deliberately
// excludes full text content (avoids hashing/comparing potentially large
// strings on every recheck).
function computeProgressSignature(messages: SessionMessage[]): string {
  const last = messages[messages.length - 1]
  const lastParts = last?.parts ?? []
  const lastPart = lastParts[lastParts.length - 1] as
    | { type?: string; text?: string; state?: { status?: string } }
    | undefined
  const textLen =
    lastPart?.type === "text" || lastPart?.type === "reasoning" ? (lastPart.text ?? "").length : 0
  const toolState = lastPart?.type === "tool" ? lastPart.state?.status ?? "" : ""
  return `${messages.length}:${last?.info?.id ?? ""}:${lastParts.length}:${textLen}:${toolState}`
}

async function fetchSessionMessages(
  client: OpencodeClient,
  sessionID: string
): Promise<SessionMessage[]> {
  const messagesResult = await client.session.messages({ path: { id: sessionID } })
  const rawData = (messagesResult as { data?: unknown })?.data ?? messagesResult
  return Array.isArray(rawData) ? (rawData as SessionMessage[]) : []
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
    hasActiveChildBackgroundTasks?: (sessionID: string) => boolean
    hasPendingParentWake?: (sessionID: string) => boolean
    childWakeGraceMs?: number
  },
  timeoutMs?: number
): Promise<string | null> {
  const syncTiming = getTimingConfig()
  const maxPollTimeMs = Math.max(timeoutMs ?? getDefaultSyncPollTimeoutMs(), 50)
  const maxTurns = input.maxAssistantTurns ?? DEFAULT_MAX_ASSISTANT_TURNS
  const pollStart = Date.now()
  let inactiveStart = pollStart
  let lastProgressSignature: string | null = null
  let lastProgressCheckAt = pollStart
  let pollCount = 0
  let timedOut = false
  let assistantTurnCount = 0
  let lastSeenAssistantId: string | undefined
  const childSettleMs = input.childWakeGraceMs ?? CHILD_WAKE_GRACE_MS
  let childWaitAssistantId: string | undefined
  let childSettleStartedAt = 0
  // A sync subagent can end its turn and then be re-woken by a parent-wake
  // notification once its background children finish. The task is only truly done
  // when no direct child work remains AND no wake is queued/in-flight for this
  // session. (Direct children only: a grandchild's completion wake is addressed to
  // its immediate parent, never to this session, so gating on grandchildren would
  // block on continuations this session can never receive.)
  // hasPendingParentWake bridges the notification dispatch window (debounce + queue +
  // promptAsync gate), which routinely exceeds a fixed grace; the settle window then
  // covers only the sub-second gap between a child reaching terminal status and the
  // wake being enqueued. Once a new turn appears the assistant id changes and we stop
  // waiting to evaluate it. The outer inactivity timeout remains the safety bound.
  const isAwaitingChildContinuation = (currentAssistantId: string | undefined): boolean => {
    const continuationOwed =
      (input.hasActiveChildBackgroundTasks?.(input.sessionID) ?? false) ||
      (input.hasPendingParentWake?.(input.sessionID) ?? false)
    if (continuationOwed) {
      childWaitAssistantId = currentAssistantId
      childSettleStartedAt = 0
      return true
    }
    if (childWaitAssistantId === undefined || currentAssistantId !== childWaitAssistantId) {
      return false
    }
    childSettleStartedAt ||= Date.now()
    return Date.now() - childSettleStartedAt < childSettleMs
  }

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
          const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          log("[task] Final messages fetch failed after abort, retrying", {
            sessionID: input.sessionID,
            attempt,
            maxAttempts: abortFetchAttempts,
            error: errorMessage,
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

    let sessionStatus: { type: string } | undefined
    try {
      const statusResult = await client.session.status()
      const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
      sessionStatus = allStatuses[input.sessionID]
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("[task] Poll status fetch failed, checking messages", { sessionID: input.sessionID, error: errorMessage })
    }

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
      // Do not trust "busy"/"retry"/"running" at face value forever: a
      // provider call can get stuck in-flight (no error, no output, status
      // never flips) and this status alone would then reset inactiveStart
      // on every poll tick, permanently defeating the timeout below.
      // Periodically verify the message stream actually moved; only reset
      // the clock when it did. Throttled (not every tick) to avoid spamming
      // session.messages() while a session is legitimately streaming.
      const now = Date.now()
      if (now - lastProgressCheckAt < syncTiming.BUSY_PROGRESS_RECHECK_MS) {
        continue
      }
      lastProgressCheckAt = now
      try {
        const progressMessages = await fetchSessionMessages(client, input.sessionID)
        const signature = computeProgressSignature(progressMessages)
        if (lastProgressSignature === null || signature !== lastProgressSignature) {
          lastProgressSignature = signature
          inactiveStart = now
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log("[task] Busy-progress recheck failed, keeping prior inactivity clock", {
          sessionID: input.sessionID,
          error: errorMessage,
        })
      }
      continue
    }

    let messages: SessionMessage[]
    try {
      messages = await fetchSessionMessages(client, input.sessionID)
    } catch (error) {
      const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      log("[task] Poll messages fetch failed, retrying", { sessionID: input.sessionID, error: errorMessage })
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
      const currentAssistantId = [...messages].reverse().find((m) => m.info?.role === "assistant")?.info?.id
      if (isAwaitingChildContinuation(currentAssistantId)) {
        continue
      }
      log("[task] Poll complete - terminal finish detected", { sessionID: input.sessionID, pollCount })
      break
    }

    // Count new assistant turns to circuit-break infinite loops
    const lastAssistant = [...messages].reverse().find((m) => m.info?.role === "assistant")
    if (lastAssistant?.info?.id && lastAssistant.info.id !== lastSeenAssistantId) {
      lastSeenAssistantId = lastAssistant.info.id
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

    const hasAssistantText = messages.some((m) => {
      if (m.info?.role !== "assistant") return false
      const parts = m.parts ?? []
      return parts.some((p) => {
        if (p.type !== "text" && p.type !== "reasoning") return false
        const text = (p.text ?? "").trim()
        return text.length > 0
      })
    })

    if (!lastAssistant?.info?.finish && hasAssistantText) {
      if (isAwaitingChildContinuation(lastAssistant?.info?.id)) {
        continue
      }
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
