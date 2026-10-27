import type { ToolContextWithMetadata, OpencodeClient } from "./types"
import type { SessionMessage } from "./executor-types"
import { getDefaultSyncPollTimeoutMs, getTimingConfig } from "./timing"
import { getTerminalSessionError, isSessionComplete } from "./sync-session-turns"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared"

export { isSessionComplete } from "./sync-session-turns"

// allow: SIZE_OK - one polling state machine; splitting its timers and turn state would obscure ordering invariants.

const ACTIVE_SESSION_STATUSES = new Set(["busy", "retry", "running"])
const CHILD_WAKE_GRACE_MS = 5_000
const MAX_NON_ACTIVE_STATUS_STALENESS_POLLS = 10
const STALL_TIMEOUT_MS = 30_000

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

function isKnownInactiveSessionStatus(status: { type: string } | undefined): boolean {
  return status?.type === "idle"
}

function getStallProgressSignature(messages: SessionMessage[]): string {
  return JSON.stringify([
    messages.length,
    ...messages.map((message) => [
      message.info?.role === "assistant" ? message.info.id ?? null : null,
      message.info?.role === "assistant" ? message.info.finish ?? null : null,
      ...(message.parts ?? []).map((part) => [part.type ?? null, part.text ?? null]),
    ]),
  ])
}

function getCurrentTurnMessages(messages: SessionMessage[]): SessionMessage[] {
  const latestUserIndex = messages.findLastIndex((message) => message.info?.role === "user")
  return latestUserIndex < 0 ? [] : messages.slice(latestUserIndex + 1)
}

function hasMessagesAfterAnchor(
  messages: SessionMessage[],
  anchorMessageID: string | undefined,
  anchorMessageCount: number | undefined,
): boolean {
  if (anchorMessageID !== undefined) {
    const anchorIndex = messages.findIndex((message) => message.info?.id === anchorMessageID)
    return anchorIndex === -1 || anchorIndex < messages.length - 1
  }
  return anchorMessageCount === undefined || messages.length > anchorMessageCount
}

async function fetchSessionMessages(
  client: OpencodeClient,
  sessionID: string
): Promise<SessionMessage[]> {
  const messagesResult = await client.session.messages({ path: { id: sessionID }, query: { limit: 100 } })
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
    anchorMessageID?: string
    maxAssistantTurns?: number
    hasActiveChildBackgroundTasks?: (sessionID: string) => boolean
    hasPendingParentWake?: (sessionID: string) => boolean
    childWakeGraceMs?: number
    stallTimeoutMs?: number
    now?: () => number
    wait?: (milliseconds: number) => Promise<void>
  },
  timeoutMs?: number
): Promise<string | null> {
  const syncTiming = getTimingConfig()
  const maxPollTimeMs = Math.max(timeoutMs ?? getDefaultSyncPollTimeoutMs(), 50)
  const maxTurns = input.maxAssistantTurns ?? DEFAULT_MAX_ASSISTANT_TURNS
  const now = input.now ?? Date.now
  const waitForPoll = input.wait ?? wait
  const pollStart = now()
  let inactiveStart = pollStart
  let pollCount = 0
  let nonActivePollsSinceMessageFetch = 0
  let lastStatusRevision: string | undefined
  let hasFetchedNonActiveMessages = false
  let timedOut = false
  let assistantTurnCount = 0
  let lastSeenAssistantId: string | undefined
  let stallProgressSignature: string | undefined
  let stallSince = 0
  const stallTimeoutMs = input.stallTimeoutMs ?? STALL_TIMEOUT_MS
  let lastObservedAssistantId: string | undefined
  let lastObservedMessageCount: number | undefined
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
    childSettleStartedAt ||= now()
    return now() - childSettleStartedAt < childSettleMs
  }

  log("[task] Starting poll loop", { sessionID: input.sessionID, agentToUse: input.agentToUse, maxTurns })

  while (true) {
    const inactiveElapsedMs = now() - inactiveStart
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
            await waitForPoll(syncTiming.POLL_INTERVAL_MS)
          }
        }
      }

      if (finalMessages) {
        const hasNewMessages = hasMessagesAfterAnchor(
          finalMessages,
          input.anchorMessageID,
          input.anchorMessageCount,
        )
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

    await waitForPoll(syncTiming.POLL_INTERVAL_MS)
    pollCount++

    let sessionStatus: ({ type: string; updatedAt?: string | number; revision?: string | number; messageCount?: number } & Record<string, unknown>) | undefined
    let statusObservationFailed = false
    try {
      const statusResult = await client.session.status()
      const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
      sessionStatus = allStatuses[input.sessionID] as typeof sessionStatus

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("[task] Poll status fetch failed, checking messages", { sessionID: input.sessionID, error: errorMessage })
      statusObservationFailed = true
    }

    if (pollCount % 10 === 0) {
      log("[task] Poll status", {
        sessionID: input.sessionID,
        pollCount,
        elapsed: Math.floor((now() - pollStart) / 1000) + "s",
        inactiveElapsed: Math.floor(inactiveElapsedMs / 1000) + "s",
        sessionStatus: sessionStatus?.type ?? "not_in_status",
      })
    }

    const isActive = isActiveSessionStatus(sessionStatus)

    // Stall-state maintenance. An ACTIVE observation always resets the stall
    // window, and so must a FAILED observation: an unavailable observation is
    // not evidence of an idle stall. But a SUCCESSFUL status response that
    // omits the session IS known-inactive evidence: real OpenCode drops idle
    // sessions from the status map entirely (verified end-to-end on 1.18.15 —
    // an interrupted-stream child settles idle, emits session.idle, and
    // disappears from the map), so "absent from a successful response" is the
    // real-world signal of a quiescent session, alongside an explicit "idle".
    // This runs BEFORE the staleness dedup below so that guard's `continue`
    // cannot preserve a pre-outage stall window through polls that produced
    // no valid observation at all.
    const hasKnownInactiveStatus = !statusObservationFailed && (sessionStatus === undefined || isKnownInactiveSessionStatus(sessionStatus))
    if (isActive || !hasKnownInactiveStatus) stallSince = 0

    const statusRevision = sessionStatus && (sessionStatus.updatedAt ?? sessionStatus.revision ?? sessionStatus.messageCount ?? sessionStatus.type)
    const statusChanged = statusRevision !== undefined && String(statusRevision) !== lastStatusRevision
    if (statusChanged) inactiveStart = now()

    // An active status (busy/retry/running) is not progress by itself: a child that hit a
    // terminal provider error can sit in "busy" forever with an unchanged message set.
    // Keep inspecting messages on the same staleness cadence so the error surfaces and the
    // inactivity timer only resets on observable change.
    nonActivePollsSinceMessageFetch++
    if (hasFetchedNonActiveMessages && !statusChanged && nonActivePollsSinceMessageFetch < MAX_NON_ACTIVE_STATUS_STALENESS_POLLS) {
      continue
    }
    lastStatusRevision = statusRevision === undefined ? lastStatusRevision : String(statusRevision)
    nonActivePollsSinceMessageFetch = 0
    hasFetchedNonActiveMessages = true

    let messages: SessionMessage[]
    try {
      messages = await fetchSessionMessages(client, input.sessionID)
    } catch (error) {
      const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      log("[task] Poll messages fetch failed, retrying", { sessionID: input.sessionID, error: errorMessage })
      continue
    }

    if (!hasMessagesAfterAnchor(messages, input.anchorMessageID, input.anchorMessageCount)) continue

    const currentAssistantId = [...messages].reverse().find((m) => m.info?.role === "assistant")?.info?.id
    const messageStateChanged =
      lastObservedMessageCount !== undefined &&
      (messages.length !== lastObservedMessageCount || currentAssistantId !== lastObservedAssistantId)
    lastObservedMessageCount = messages.length
    lastObservedAssistantId = currentAssistantId
    if (messageStateChanged) inactiveStart = now()

    const sessionError = getTerminalSessionError(messages)
    if (sessionError) {
      log("[task] Poll detected terminal session error", { sessionID: input.sessionID, sessionError })
      return sessionError
    }

    // Completion is only judged once the session has left its active status; a busy child
    // whose last assistant turn merely looks finished is still working.
    if (!isActive && isSessionComplete(messages)) {
      if (isAwaitingChildContinuation(currentAssistantId)) {
        continue
      }
      log("[task] Poll complete - terminal finish detected", { sessionID: input.sessionID, pollCount })
      break
    }

    // Stall detection: a session that is inactive, whose last assistant message
    // carries the abnormal "unknown" finish (produced by opencode when a model
    // stream is interrupted mid-turn), and that has not produced any new
    // messages is effectively dead. Fail fast instead of waiting out the full
    // inactivity timeout (30 minutes by default). If the stalled session still
    // contains a substantive assistant text/reasoning deliverable, treat it as
    // complete so the parent does not lose the result.
    //
    // Note: a missing finish (undefined) is deliberately NOT stall-detected -
    // it can transiently appear while a subagent is mid-generation, and
    // aborting such a session would kill a healthy task.
    //
    // Sessions waiting on their own background children (or a pending parent
    // wake) are also NOT stall-detected: like the isSessionComplete branch
    // above, they are legitimately quiescent while child work is in flight.
    const relevantMessages =
      input.anchorMessageCount !== undefined ? messages.slice(input.anchorMessageCount) : messages
    const progressSignature = getStallProgressSignature(relevantMessages)
    const currentTurnMessages = getCurrentTurnMessages(relevantMessages)
    const lastAssistantForStall = currentTurnMessages.findLast((m) => m.info?.role === "assistant")
    const lastFinishForStall = lastAssistantForStall?.info?.finish
    if (
      hasKnownInactiveStatus &&
      lastFinishForStall === "unknown" &&
      progressSignature === stallProgressSignature &&
      !isAwaitingChildContinuation(lastAssistantForStall?.info?.id)
    ) {
      const stallNow = now()
      stallSince ||= stallNow
      if (stallNow - stallSince >= stallTimeoutMs) {
        const hasDeliverable = currentTurnMessages.some((message) => {
          if (message.info?.role !== "assistant") return false
          return (message.parts ?? []).some((p) => {
            if (p.type !== "text" && p.type !== "reasoning") return false
            return (p.text ?? "").trim().length > 0
          })
        })
        if (hasDeliverable) {
          log("[task] Poll complete - stalled session with deliverable treated as complete", {
            sessionID: input.sessionID,
            pollCount,
          })
          break
        }
        log("[task] Poll stalled - no deliverable, failing fast", {
          sessionID: input.sessionID,
          pollCount,
          stallMs: now() - stallSince,
        })
        abortSyncSession(client, input.sessionID, "stall_timeout")
        if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
        return `Subagent stalled: session was inactive with finish="${lastFinishForStall}" and produced no new messages for ${stallTimeoutMs}ms. The model stream was likely interrupted. Session ID: ${input.sessionID}`
      }
    } else {
      stallSince = 0
    }
    stallProgressSignature = progressSignature

    // Count new assistant turns to circuit-break infinite loops. This runs while the status
    // is still active too: a child looping through tool calls never leaves "busy", and every
    // new turn resets the inactivity timer above, so the turn budget is its only bound.
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

    if (isActive) continue

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
