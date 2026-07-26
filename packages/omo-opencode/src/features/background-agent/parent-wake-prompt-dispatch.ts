import {
  createInternalAgentTextPart,
  isAmbiguousPostDispatchPromptFailure,
  log,
  withInternalNoReplyMarker,
} from "../../shared"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../hooks/shared/prompt-async-gate"
import type { PromptDispatchClient } from "../../shared/prompt-async-gate/types"
import { getErrorText } from "./error-classifier"
import { createEmptyAssistantTurnRetryDedupeKey } from "./parent-wake-history-state"
import {
  cloneParentWake,
  isManagedBashCheckpointNotification,
  isRedundantParentWake,
  type PendingParentWake,
} from "./parent-wake-dedupe"
import type { ToolWaitDeferralDecision } from "./parent-wake-session-history"

const MAX_CHECKPOINT_PARENT_PROMPT_BYTES = 1_024

type ParentWakePromptDispatchInput = {
  readonly client: PromptDispatchClient
  readonly directory: string
  readonly sessionID: string
  readonly latestWake: PendingParentWake
  readonly forceNoReply?: boolean
  readonly retainPendingWake?: boolean
  readonly skipPromptGateStatusCheck?: boolean
  readonly emptyAssistantTurnRetry: boolean
  readonly toolWaitDecision: ToolWaitDeferralDecision
  readonly getDispatchedWake: () => PendingParentWake | undefined
  readonly hasRecordedPromptAfterDispatch: (wake: PendingParentWake) => Promise<boolean>
  readonly trackDispatchedWake: (wake: PendingParentWake, dispatchedAt: number) => void
  readonly requeueWake: (wake: PendingParentWake) => void
  readonly scheduleFlush: (delayMs?: number) => void
}

export async function sendParentWakePrompt(input: ParentWakePromptDispatchInput): Promise<void> {
  const noReply = input.forceNoReply === true || !input.latestWake.shouldReply
  const dispatchWake = createBoundedCheckpointDispatchWake(input.latestWake, noReply)
  const promptPart = createParentWakePromptPart(dispatchWake.notifications, noReply)
  let dispatchStartedAt = Date.now()
  try {
    dispatchStartedAt = Date.now()
    const promptResult = await dispatchInternalPrompt({
      mode: "async",
      client: input.client,
      sessionID: input.sessionID,
      source: "background-agent-parent-wake",
      ...(input.emptyAssistantTurnRetry
        ? { dedupeKey: createEmptyAssistantTurnRetryDedupeKey(input.latestWake) }
        : {}),
      settleMs: 0,
      queueBehavior: "defer",
      checkStatus: input.forceNoReply !== true && input.skipPromptGateStatusCheck !== true,
      checkToolState: input.forceNoReply !== true && !input.toolWaitDecision.skipPromptGateToolStateCheck,
      input: {
        path: { id: input.sessionID },
        body: {
          noReply,
          ...input.latestWake.promptContext,
          parts: [promptPart],
        },
        query: { directory: input.directory },
      },
    })
    if (promptResult.status === "failed") {
      if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
        const dispatchedWake = cloneParentWake(dispatchWake)
        dispatchedWake.dispatchedAt = dispatchStartedAt
        if (await input.hasRecordedPromptAfterDispatch(dispatchedWake)) {
          markRetainedNoReplyAdmission(input, dispatchStartedAt)
          trackAcceptedWake(input, dispatchWake, dispatchStartedAt)
          log("[background-agent] Treated failed parent wake prompt as accepted after observing session history:", {
            sessionID: input.sessionID,
            error: promptResult.error,
          })
          return
        }
      }
      throw promptResult.error
    }
    if (promptResult.status === "reserved" && promptResult.reservedBy === "background-agent-parent-wake") {
      const dispatchedWake = input.getDispatchedWake()
      if (dispatchedWake && isRedundantParentWake(input.latestWake, dispatchedWake)) {
        log("[background-agent] Suppressed duplicate parent wake during promptAsync gate hold:", {
          sessionID: input.sessionID,
        })
        return
      }
      input.requeueWake(input.latestWake)
      input.scheduleFlush(2_000)
      log("[background-agent] Requeued parent wake flush reserved by promptAsync gate hold:", {
        sessionID: input.sessionID,
      })
      return
    }
    if (!isInternalPromptDispatchAccepted(promptResult)) {
      input.requeueWake(input.latestWake)
      input.scheduleFlush()
      log("[background-agent] Deferred parent wake skipped by promptAsync gate:", {
        sessionID: input.sessionID,
        status: promptResult.status,
      })
      return
    }
    log("[background-agent] Sent deferred parent wake:", { sessionID: input.sessionID })
    delete input.latestWake.allowEmptyAssistantTurnRetry
    markRetainedNoReplyAdmission(input, dispatchStartedAt)
    trackAcceptedWake(input, dispatchWake, dispatchStartedAt)
  } catch (error) {
    const errorText = error instanceof Error ? `${error.name}: ${error.message}` : getErrorText(error) || String(error)
    input.requeueWake(input.latestWake)
    input.scheduleFlush()
    log("[background-agent] Failed to send deferred parent wake:", { sessionID: input.sessionID, error: errorText })
  }
}

function createParentWakePromptPart(notifications: readonly string[], noReply: boolean) {
  const part = createInternalAgentTextPart(notifications.join("\n\n"))
  return noReply ? withInternalNoReplyMarker(part) : part
}

function createBoundedCheckpointDispatchWake(wake: PendingParentWake, noReply: boolean): PendingParentWake {
  const notifications = [...wake.notifications]
  let promptPart = createParentWakePromptPart(notifications, noReply)
  while (Buffer.byteLength(promptPart.text, "utf8") > MAX_CHECKPOINT_PARENT_PROMPT_BYTES) {
    const checkpointIndex = notifications.findIndex(isManagedBashCheckpointNotification)
    if (checkpointIndex === -1) break
    notifications.splice(checkpointIndex, 1)
    promptPart = createParentWakePromptPart(notifications, noReply)
  }
  if (notifications.length === wake.notifications.length) return wake

  const boundedWake = cloneParentWake(wake)
  boundedWake.notifications = notifications
  if (boundedWake.latestOnlyNotifications) {
    const retained = new Set(notifications)
    for (const [key, notification] of boundedWake.latestOnlyNotifications) {
      if (!retained.has(notification)) boundedWake.latestOnlyNotifications.delete(key)
    }
    if (boundedWake.latestOnlyNotifications.size === 0) delete boundedWake.latestOnlyNotifications
  }
  return boundedWake
}

function trackAcceptedWake(
  input: ParentWakePromptDispatchInput,
  wake: PendingParentWake,
  dispatchedAt: number,
): void {
  if (!input.latestWake.shouldReply && wake.notifications.every(isManagedBashCheckpointNotification)) return
  input.trackDispatchedWake(createTrackedDispatchedWake(wake, input.forceNoReply), dispatchedAt)
}

function markRetainedNoReplyAdmission(input: ParentWakePromptDispatchInput, dispatchStartedAt: number): void {
  if (input.retainPendingWake !== true || input.forceNoReply !== true || !input.latestWake.shouldReply) {
    return
  }
  input.latestWake.noReplyAdmittedAt = dispatchStartedAt
  input.scheduleFlush()
}

function createTrackedDispatchedWake(wake: PendingParentWake, forceNoReply: boolean | undefined): PendingParentWake {
  if (forceNoReply !== true || !wake.shouldReply) {
    return wake
  }

  return {
    ...cloneParentWake(wake),
    shouldReply: false,
  }
}
