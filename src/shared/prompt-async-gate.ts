import { log } from "./logger"
import { DEFAULT_SESSION_IDLE_SETTLE_MS } from "./session-idle-settle"
import {
  clearPromptQueueStateForTesting,
  enqueueInternalPrompt,
  getQueuedPromptBlocker,
  isPromptQueueDraining,
  nextPromptQueueID,
  releaseInFlightPromptMatchingDedupe,
  schedulePromptQueueDrain,
} from "./prompt-async-gate/queue"
import {
  clearRecentPromptDispatchesForTesting,
  deleteRecentPromptDispatch,
} from "./prompt-async-gate/recent-dispatches"
import {
  clearPromptReservationsForTesting,
  deletePromptReservation,
  getActiveReservation,
  getPromptReservation,
  reservationSourceMatches,
} from "./prompt-async-gate/reservations"
import { dispatchAfterSessionIdle } from "./prompt-async-gate/session-idle-dispatch"
import {
  coalesceRecentSemanticPromptDispatch,
  createSemanticPromptDedupeKey,
} from "./prompt-async-gate/semantic-dedupe"
import {
  DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS,
  DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS,
  DEFAULT_PROMPT_QUEUE_RETRY_MS,
  DEFAULT_PROMPT_SEMANTIC_DEDUPE_HOLD_MS,
  resetPromptGateTimingForTesting,
} from "./prompt-async-gate/timing"
import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
  PromptAsyncInput,
  PromptAsyncReservationReleaseOptions,
} from "./prompt-async-gate/types"

export {
  DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS,
  DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS,
  DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS,
  DEFAULT_PROMPT_QUEUE_RETRY_MS,
  DEFAULT_PROMPT_SEMANTIC_DEDUPE_HOLD_MS,
  _setPromptGateMessagesFetchTimeoutMsForTesting,
} from "./prompt-async-gate/timing"

export type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchMode,
  InternalPromptDispatchResult,
  InternalPromptQueueBehavior,
  PromptAsyncGateResult,
} from "./prompt-async-gate/types"

type ObjectPathPromptInput = {
  readonly path?: { readonly id?: string } | string
  readonly [key: string]: unknown
}

function hasObjectSessionPath(input: unknown): input is ObjectPathPromptInput & { readonly path: { readonly id: string } } {
  return typeof input === "object"
    && input !== null
    && "path" in input
    && typeof input.path === "object"
    && input.path !== null
    && "id" in input.path
    && typeof input.path.id === "string"
}

function isObjectPathTypeError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string" ? error : ""
  return message.includes('The "path" property must be of type string') && message.includes("got object")
}

async function dispatchWithPathCompatibility<TInput>(
  dispatch: (dispatchInput: TInput) => Promise<unknown>,
  input: TInput,
): Promise<unknown> {
  try {
    return await dispatch(input)
  } catch (error) {
    if (!isObjectPathTypeError(error) || !hasObjectSessionPath(input)) {
      throw error
    }

    const retryInput = {
      ...input,
      path: input.path.id,
    } as TInput
    return dispatch(retryInput)
  }
}

export async function dispatchInternalPrompt<TInput = PromptAsyncInput>(
  args: InternalPromptDispatchArgs<TInput>,
): Promise<InternalPromptDispatchResult> {
  const {
    client,
    sessionID,
    input,
    source,
    settleMs = DEFAULT_SESSION_IDLE_SETTLE_MS,
  } = args
  const dedupeKey = args.dedupeKey ?? createSemanticPromptDedupeKey(input)
  const queueRetryMs = args.queueRetryMs ?? DEFAULT_PROMPT_QUEUE_RETRY_MS
  const postDispatchHoldMs = args.postDispatchHoldMs ?? DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS
  const semanticDedupeHoldMs = args.semanticDedupeHoldMs
    ?? (postDispatchHoldMs > 0 ? DEFAULT_PROMPT_SEMANTIC_DEDUPE_HOLD_MS : 0)
  const dispatchTimeoutMs = args.dispatchTimeoutMs ?? DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS
  const sessionName = args.mode === "async" ? "promptAsync" : "prompt"
  const dispatch = (() => {
    if (args.mode === "async") {
      const session = args.client.session
      if (typeof session?.promptAsync !== "function") {
        return undefined
      }
      const dispatchPromptAsync = session.promptAsync.bind(session)
      return (dispatchInput: TInput) => dispatchPromptAsync(dispatchInput)
    }

    const session = args.client.session
    if (typeof session?.prompt !== "function") {
      return undefined
    }
    const dispatchPrompt = session.prompt.bind(session)
    return (dispatchInput: TInput) => dispatchPrompt(dispatchInput)
  })()

  if (!dispatch) {
    log(`[prompt-async-gate] ${sessionName} unavailable`, { sessionID, source })
    return { status: "unavailable" }
  }

  const queueBehavior = args.queueBehavior ?? (args.mode === "sync" ? "defer" : "enqueue")

  if (queueBehavior === "defer") {
    const activeReservation = getActiveReservation(sessionID)
    if (activeReservation) {
      return { status: "reserved", reservedBy: activeReservation.source }
    }

    const queuedBy = getQueuedPromptBlocker(sessionID)
    if (queuedBy !== undefined || isPromptQueueDraining(sessionID)) {
      return { status: "reserved", reservedBy: queuedBy ?? source }
    }

    const recentDispatchResult = coalesceRecentSemanticPromptDispatch({ sessionID, dedupeKey, source })
    if (recentDispatchResult) {
      return recentDispatchResult
    }

    return dispatchAfterSessionIdle({
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
      checkStatus: args.checkStatus !== false,
      checkToolState: args.checkToolState !== false,
      dispatch: (dispatchInput) => dispatchWithPathCompatibility(dispatch, dispatchInput),
    })
  }

  if (args.queue !== false) {
    const recentDispatchResult = coalesceRecentSemanticPromptDispatch({ sessionID, dedupeKey, source })
    if (recentDispatchResult) {
      return recentDispatchResult
    }

    return enqueueInternalPrompt({
      id: nextPromptQueueID(),
      sessionID,
      sessionName,
      client,
      input,
      source,
      dedupeKey,
      settleMs,
      postDispatchHoldMs,
      semanticDedupeHoldMs,
      dispatchTimeoutMs,
      queueRetryMs,
      checkStatus: args.checkStatus !== false,
      checkToolState: args.checkToolState !== false,
      dispatch: async (_dispatchInput: unknown) => dispatchWithPathCompatibility(dispatch, input),
    })
  }

  const recentDispatchResult = coalesceRecentSemanticPromptDispatch({ sessionID, dedupeKey, source })
  if (recentDispatchResult) {
    return recentDispatchResult
  }

  return dispatchAfterSessionIdle({
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
    checkStatus: args.checkStatus !== false,
    checkToolState: args.checkToolState !== false,
    dispatch: (dispatchInput) => dispatchWithPathCompatibility(dispatch, dispatchInput),
  })
}

export function releaseAllPromptAsyncReservationsForTesting(): void {
  clearPromptReservationsForTesting()
  clearPromptQueueStateForTesting()
  clearRecentPromptDispatchesForTesting()
  resetPromptGateTimingForTesting()
}

export function isInternalPromptDispatchAccepted(result: InternalPromptDispatchResult): boolean {
  return result.status === "dispatched" || result.status === "queued"
}

export function releasePromptAsyncReservation(
  sessionID: string,
  source: string,
  options?: PromptAsyncReservationReleaseOptions,
): boolean {
  const existing = getPromptReservation(sessionID)
  if (!existing) {
    return false
  }

  const expectedSource = options?.reservedBy ?? source
  if (!reservationSourceMatches(existing.source, expectedSource, options?.reservedByPrefix)) {
    log("[prompt-async-gate] promptAsync reservation release skipped for different source", {
      sessionID,
      source,
      reservedBy: existing.source,
    })
    return false
  }

  deletePromptReservation(sessionID)
  deleteRecentPromptDispatch(sessionID, existing.dedupeKey)
  releaseInFlightPromptMatchingDedupe(sessionID, existing.dedupeKey)
  schedulePromptQueueDrain(sessionID, 0)
  log("[prompt-async-gate] promptAsync reservation released", {
    sessionID,
    source,
    reservedBy: existing.source,
  })
  return true
}
