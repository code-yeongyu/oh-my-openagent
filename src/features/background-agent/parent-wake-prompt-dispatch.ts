import {
  createInternalAgentTextPart,
  isAmbiguousPostDispatchPromptFailure,
  log,
} from "../../shared"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../hooks/shared/prompt-async-gate"
import type { PromptDispatchClient } from "../../shared/prompt-async-gate/types"
import { getErrorText } from "./error-classifier"
import { createEmptyAssistantTurnRetryDedupeKey } from "./parent-wake-history-state"
import { cloneParentWake, isRedundantParentWake, type PendingParentWake } from "./parent-wake-dedupe"
import type { ToolWaitDeferralDecision } from "./parent-wake-session-history"

type ParentWakePromptDispatchInput = {
  readonly client: PromptDispatchClient
  readonly directory: string
  readonly sessionID: string
  readonly latestWake: PendingParentWake
  readonly forceNoReply?: boolean
  readonly emptyAssistantTurnRetry: boolean
  readonly toolWaitDecision: ToolWaitDeferralDecision
  readonly getDispatchedWake: () => PendingParentWake | undefined
  readonly hasRecordedPromptAfterDispatch: (wake: PendingParentWake) => Promise<boolean>
  readonly trackDispatchedWake: (wake: PendingParentWake, dispatchedAt: number) => void
  readonly requeueWake: (wake: PendingParentWake) => void
  readonly scheduleFlush: (delayMs?: number) => void
}

export async function sendParentWakePrompt(input: ParentWakePromptDispatchInput): Promise<void> {
  const notificationContent = input.latestWake.notifications.join("\n\n")
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
      checkStatus: input.forceNoReply !== true,
      checkToolState: input.forceNoReply !== true && !input.toolWaitDecision.skipPromptGateToolStateCheck,
      input: {
        path: { id: input.sessionID },
        body: {
          noReply: input.forceNoReply === true || !input.latestWake.shouldReply,
          ...input.latestWake.promptContext,
          parts: [createInternalAgentTextPart(notificationContent)],
        },
        query: { directory: input.directory },
      },
    })
    if (promptResult.status === "failed") {
      if (isAmbiguousPostDispatchPromptFailure(promptResult)) {
        const dispatchedWake = cloneParentWake(input.latestWake)
        dispatchedWake.dispatchedAt = dispatchStartedAt
        if (await input.hasRecordedPromptAfterDispatch(dispatchedWake)) {
          input.trackDispatchedWake(input.latestWake, dispatchStartedAt)
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
    input.trackDispatchedWake(input.latestWake, dispatchStartedAt)
  } catch (error) {
    const errorText = error instanceof Error ? `${error.name}: ${error.message}` : getErrorText(error) || String(error)
    input.requeueWake(input.latestWake)
    input.scheduleFlush()
    log("[background-agent] Failed to send deferred parent wake:", { sessionID: input.sessionID, error: errorText })
  }
}
