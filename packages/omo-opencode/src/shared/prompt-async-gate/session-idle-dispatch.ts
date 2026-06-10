import { log } from "../logger"
import { isSessionActive, settleAfterSessionIdle } from "../session-idle-settle"
import { sessionLatestAssistantBlocksInternalPrompt } from "./pending-tool-turn"
import { rememberRecentPromptDispatch } from "./recent-dispatches"
import {
  finishPromptReservation,
  getActiveReservation,
  setPromptReservation,
} from "./reservations"
import { getPromptGateMessagesFetchTimeoutMs, withDispatchTimeout } from "./timing"
import type { InternalPromptDispatchResult, PromptAsyncReservation, PromptDispatchClient, PromptSessionName } from "./types"

export async function dispatchAfterSessionIdle<TInput>(args: {
  readonly sessionName: PromptSessionName
  readonly client: PromptDispatchClient
  readonly sessionID: string
  readonly input: TInput
  readonly source: string
  readonly dedupeKey: string
  readonly settleMs: number
  readonly postDispatchHoldMs: number
  readonly semanticDedupeHoldMs: number
  readonly dispatchTimeoutMs: number
  readonly checkStatus: boolean
  readonly checkToolState: boolean
  readonly dispatch: (input: TInput) => Promise<unknown>
}): Promise<InternalPromptDispatchResult> {
  const {
    sessionName,
    client,
    sessionID,
    input,
    source,
    dedupeKey,
    settleMs,
    postDispatchHoldMs,
    semanticDedupeHoldMs,
    dispatchTimeoutMs,
    checkStatus,
    checkToolState,
    dispatch,
  } = args

  const existing = getActiveReservation(sessionID)
  if (existing) {
    log(`[prompt-async-gate] ${sessionName} skipped because session is reserved`, {
      sessionID,
      source,
      reservedBy: existing.source,
      reservedAgeMs: Date.now() - existing.reservedAt,
    })
    return { status: "reserved", reservedBy: existing.source }
  }

  const reservation: PromptAsyncReservation = {
    source,
    dedupeKey,
    reservedAt: Date.now(),
    token: Symbol(source),
  }
  setPromptReservation(sessionID, reservation)
  let dispatchAttempted = false

  try {
    const canReadStatus = checkStatus && typeof client.session?.status === "function"
    if (settleMs > 0) {
      await settleAfterSessionIdle(settleMs)
    }

    let sessionActive = false
    if (canReadStatus) {
      try {
        sessionActive = await withDispatchTimeout(
          isSessionActive(client, sessionID),
          Math.min(dispatchTimeoutMs, 5000),
          `[prompt-async-gate] ${sessionName} isSessionActive`,
        )
      } catch (error) {
        if (error instanceof Error) {
          sessionActive = false
        }

        sessionActive = false
      }
    }
    if (sessionActive) {
      log(`[prompt-async-gate] ${sessionName} skipped because session is active`, { sessionID, source })
      return { status: "active" }
    }

    if (
      checkToolState
      && typeof client.session?.messages === "function"
      && await sessionLatestAssistantBlocksInternalPrompt({
        client,
        sessionID,
        input,
        sessionName,
        source,
        timeoutMs: Math.min(dispatchTimeoutMs, getPromptGateMessagesFetchTimeoutMs()),
      })
    ) {
      log(`[prompt-async-gate] ${sessionName} skipped because latest assistant is still active`, {
        sessionID,
        source,
      })
      return { status: "active" }
    }

    log(`[prompt-async-gate] ${sessionName} dispatching`, { sessionID, source })
    dispatchAttempted = true
    const response = await withDispatchTimeout(
      dispatch(input),
      dispatchTimeoutMs,
      `[prompt-async-gate] ${sessionName} dispatch`,
    )
    rememberRecentPromptDispatch({
      sessionID,
      dedupeKey,
      source,
      holdMs: semanticDedupeHoldMs,
    })
    log(`[prompt-async-gate] ${sessionName} dispatched`, { sessionID, source })
    return { status: "dispatched", response }
  } catch (error) {
    if (dispatchAttempted) {
      rememberRecentPromptDispatch({
        sessionID,
        dedupeKey,
        source,
        holdMs: semanticDedupeHoldMs,
      })
    }
    const errorText = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    log(`[prompt-async-gate] ${sessionName} failed`, { sessionID, source, error: errorText })
    return { status: "failed", error, dispatchAttempted }
  } finally {
    finishPromptReservation(sessionID, reservation, dispatchAttempted, postDispatchHoldMs)
  }
}
