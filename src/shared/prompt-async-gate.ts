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
  clearPromptReservationsForTesting,
  deletePromptReservation,
  getActiveReservation,
  getPromptReservation,
  reservationSourceMatches,
} from "./prompt-async-gate/reservations"
import { dispatchAfterSessionIdle } from "./prompt-async-gate/session-idle-dispatch"
import {
  DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS,
  DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS,
  DEFAULT_PROMPT_QUEUE_RETRY_MS,
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
  _setPromptGateMessagesFetchTimeoutMsForTesting,
} from "./prompt-async-gate/timing"

export type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchMode,
  InternalPromptDispatchResult,
  InternalPromptQueueBehavior,
  PromptAsyncGateResult,
} from "./prompt-async-gate/types"

function stringifyPromptInputForDedupe(input: unknown): string {
  try {
    const serialized = JSON.stringify(input, (key: string, value: unknown): unknown => {
      if (key === "signal") {
        return "[AbortSignal]"
      }
      if (typeof value === "function") {
        return `[Function:${value.name}]`
      }
      return value
    })
    return serialized ?? String(input)
  } catch {
    return String(input)
  }
}

function createDefaultDedupeKey(source: string, input: unknown): string {
  const fingerprint = stringifyPromptInputForDedupe(input)
  return `${source}:${fingerprint.length}:${fingerprint.slice(0, 8192)}`
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
  const dedupeKey = args.dedupeKey ?? createDefaultDedupeKey(source, input)
  const queueRetryMs = args.queueRetryMs ?? DEFAULT_PROMPT_QUEUE_RETRY_MS
  const postDispatchHoldMs = args.postDispatchHoldMs ?? DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS
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

    return dispatchAfterSessionIdle({
      sessionName,
      client,
      sessionID,
      input,
      source,
      dedupeKey,
      settleMs,
      postDispatchHoldMs,
      dispatchTimeoutMs,
      checkStatus: args.checkStatus !== false,
      checkToolState: args.checkToolState !== false,
      dispatch,
    })
  }

  if (args.queue !== false) {
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
      dispatchTimeoutMs,
      queueRetryMs,
      checkStatus: args.checkStatus !== false,
      checkToolState: args.checkToolState !== false,
      dispatch: async (_dispatchInput: unknown) => dispatch(input),
    })
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
    dispatchTimeoutMs,
    checkStatus: args.checkStatus !== false,
    checkToolState: args.checkToolState !== false,
    dispatch,
  })
}

export function releaseAllPromptAsyncReservationsForTesting(): void {
  clearPromptReservationsForTesting()
  clearPromptQueueStateForTesting()
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
  releaseInFlightPromptMatchingDedupe(sessionID, existing.dedupeKey)
  schedulePromptQueueDrain(sessionID, 0)
  log("[prompt-async-gate] promptAsync reservation released", {
    sessionID,
    source,
    reservedBy: existing.source,
  })
  return true
}
