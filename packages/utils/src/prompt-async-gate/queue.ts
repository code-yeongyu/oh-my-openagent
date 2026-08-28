import { log } from "../logger"
import { dispatchAfterSessionIdle } from "./session-idle-dispatch"
import {
  getActiveReservation,
  setExpiredReservationHandler,
} from "./reservations"
import type { InternalPromptDispatchResult, QueuedInternalPrompt } from "./types"

declare function setTimeout(callback: () => void, delay?: number): unknown
declare function clearTimeout(timeout: unknown): void

const promptQueues = new Map<string, QueuedInternalPrompt[]>()
const promptQueueDraining = new Set<string>()
const promptQueueInFlight = new Map<string, QueuedInternalPrompt>()
const promptQueueTimers = new Map<string, unknown>()
const promptQueueRetryStates = new Map<number, {
  readonly failureCount: number
  readonly retryAfter?: number
}>()
const MAX_QUEUED_RETRYABLE_FAILURES = 3
const MAX_DURABLE_RETRY_BACKOFF_MS = 30_000
let promptQueueSequence = 0

setExpiredReservationHandler((sessionID) => {
  schedulePromptQueueDrain(sessionID, 0)
})

function getPromptQueue(sessionID: string): QueuedInternalPrompt[] {
  const existing = promptQueues.get(sessionID)
  if (existing) {
    return existing
  }

  const queue: QueuedInternalPrompt[] = []
  promptQueues.set(sessionID, queue)
  return queue
}

function setPromptQueue(sessionID: string, queue: QueuedInternalPrompt[]): void {
  if (queue.length === 0) {
    promptQueues.delete(sessionID)
    return
  }
  promptQueues.set(sessionID, queue)
}

function queuedResult(entry: QueuedInternalPrompt, position: number, queuedBy = entry.source): InternalPromptDispatchResult {
  return {
    status: "queued",
    queuedBy,
    position,
  }
}

function clearPromptQueueTimer(sessionID: string): void {
  const timer = promptQueueTimers.get(sessionID)
  if (timer !== undefined) {
    clearTimeout(timer)
    promptQueueTimers.delete(sessionID)
  }
}

export function schedulePromptQueueDrain(sessionID: string, delayMs: number): void {
  const queue = promptQueues.get(sessionID)
  if (!queue || queue.length === 0) {
    clearPromptQueueTimer(sessionID)
    return
  }

  clearPromptQueueTimer(sessionID)
  const timer = setTimeout(() => {
    promptQueueTimers.delete(sessionID)
    void drainPromptQueue(sessionID).catch((error: unknown) => {
      log("[prompt-async-gate] queued prompt drain failed", {
        sessionID,
        error: String(error),
      })
    })
  }, Math.max(0, delayMs))
  promptQueueTimers.set(sessionID, timer)
}

function removePromptQueueEntry(sessionID: string, entry: QueuedInternalPrompt): void {
  promptQueueRetryStates.delete(entry.id)
  const queue = promptQueues.get(sessionID)
  if (!queue) {
    return
  }
  const nextQueue = queue.filter((queued) => queued.id !== entry.id)
  setPromptQueue(sessionID, nextQueue)
}

export function getQueuedPromptBlocker(sessionID: string): string | undefined {
  const inFlight = promptQueueInFlight.get(sessionID)
  if (inFlight) {
    return inFlight.source
  }

  const queue = promptQueues.get(sessionID)
  return queue?.[0]?.source
}

export function isPromptQueueDraining(sessionID: string): boolean {
  return promptQueueDraining.has(sessionID)
}

export function nextPromptQueueID(): number {
  promptQueueSequence += 1
  return promptQueueSequence
}

export function releaseInFlightPromptMatchingDedupe(sessionID: string, dedupeKey: string): void {
  const inFlight = promptQueueInFlight.get(sessionID)
  if (inFlight?.dedupeKey === dedupeKey) {
    removePromptQueueEntry(sessionID, inFlight)
    promptQueueInFlight.delete(sessionID)
    promptQueueDraining.delete(sessionID)
  }
}

export function clearPromptQueueStateForTesting(): void {
  promptQueues.clear()
  promptQueueDraining.clear()
  promptQueueInFlight.clear()
  promptQueueRetryStates.clear()
  for (const timer of promptQueueTimers.values()) {
    clearTimeout(timer)
  }
  promptQueueTimers.clear()
}

async function drainPromptQueue(sessionID: string, awaitedEntry?: QueuedInternalPrompt): Promise<InternalPromptDispatchResult | undefined> {
  if (promptQueueDraining.has(sessionID)) {
    return awaitedEntry ? queuedResult(awaitedEntry, 1) : undefined
  }

  promptQueueDraining.add(sessionID)
  clearPromptQueueTimer(sessionID)

  let awaitedResult: InternalPromptDispatchResult | undefined
  const deferredRetryIds = new Set<number>()
  try {
    while (true) {
      const queue = promptQueues.get(sessionID)
      const entry = queue?.[0]
      if (!entry) {
        break
      }

      const retryState = promptQueueRetryStates.get(entry.id)
      if (entry.durableRetry && retryState?.retryAfter !== undefined && retryState.retryAfter > Date.now()) {
        if (deferredRetryIds.has(entry.id)) {
          const nextRetryAt = Math.min(...queue.flatMap((queued) => {
            const retryAfter = promptQueueRetryStates.get(queued.id)?.retryAfter
            return retryAfter === undefined ? [] : [retryAfter]
          }))
          schedulePromptQueueDrain(sessionID, nextRetryAt - Date.now())
          break
        }
        deferredRetryIds.add(entry.id)
        setPromptQueue(sessionID, [...queue.slice(1), entry])
        continue
      }

      promptQueueInFlight.set(sessionID, entry)
      const result = await dispatchAfterSessionIdle({
        sessionName: entry.sessionName,
        client: entry.client,
        sessionID: entry.sessionID,
        input: entry.input,
        source: entry.source,
        dedupeKey: entry.dedupeKey,
        settleMs: entry.settleMs,
        postDispatchHoldMs: entry.postDispatchHoldMs,
        semanticDedupeHoldMs: entry.semanticDedupeHoldMs,
        dispatchTimeoutMs: entry.dispatchTimeoutMs,
        checkStatus: entry.checkStatus,
        checkToolState: entry.checkToolState,
        shouldDispatch: entry.shouldDispatch,
        retryDispatchFailure: entry.retryDispatchFailure,
        dispatch: entry.dispatch,
      })
      if (promptQueueInFlight.get(sessionID)?.id === entry.id) {
        promptQueueInFlight.delete(sessionID)
      }

      const retryableQueuedFailure = result.status === "failed"
        && (!result.dispatchAttempted || result.queueRetryable === true)
      if (retryableQueuedFailure) {
        const failureCount = (promptQueueRetryStates.get(entry.id)?.failureCount ?? 0) + 1
        if (entry.durableRetry) {
          const exponentialBackoffMs = entry.queueRetryMs * (2 ** Math.min(failureCount, 7))
          const retryDelayMs = Math.max(
            entry.postDispatchHoldMs,
            Math.min(exponentialBackoffMs, MAX_DURABLE_RETRY_BACKOFF_MS),
          )
          promptQueueRetryStates.set(entry.id, {
            failureCount,
            retryAfter: Date.now() + retryDelayMs,
          })
          const currentQueue = promptQueues.get(sessionID)
          if (currentQueue && currentQueue.length > 1) {
            setPromptQueue(sessionID, [...currentQueue.slice(1), entry])
            continue
          }
          schedulePromptQueueDrain(sessionID, retryDelayMs)
          break
        }
        if (failureCount >= MAX_QUEUED_RETRYABLE_FAILURES) {
          log("[prompt-async-gate] dropping queued prompt after repeated retryable failures", {
            sessionID,
            source: entry.source,
            failureCount,
          })
          removePromptQueueEntry(sessionID, entry)
          if (awaitedEntry?.id === entry.id) {
            awaitedResult = result
          }
          continue
        }
        promptQueueRetryStates.set(entry.id, { failureCount })
      }

      if (
        result.status === "active"
        || result.status === "reserved"
        || retryableQueuedFailure
      ) {
        const queued = queuedResult(
          entry,
          1,
          result.status === "reserved" ? result.reservedBy : entry.source,
        )
        if (awaitedEntry?.id === entry.id) {
          awaitedResult = queued
        }
        schedulePromptQueueDrain(sessionID, entry.queueRetryMs)
        break
      }

      removePromptQueueEntry(sessionID, entry)
      if (awaitedEntry?.id === entry.id) {
        awaitedResult = result
      }

      const remainingQueue = promptQueues.get(sessionID)
      if (!remainingQueue || remainingQueue.length === 0) {
        break
      }

      schedulePromptQueueDrain(sessionID, entry.postDispatchHoldMs)
      break
    }
  } finally {
    promptQueueDraining.delete(sessionID)
  }

  return awaitedResult
}

export async function enqueueInternalPrompt(entry: QueuedInternalPrompt): Promise<InternalPromptDispatchResult> {
  const activeReservation = getActiveReservation(entry.sessionID)
  if (activeReservation?.dedupeKey === entry.dedupeKey) {
    log("[prompt-async-gate] queued prompt coalesced with recent dispatch", {
      sessionID: entry.sessionID,
      source: entry.source,
      queuedBy: activeReservation.source,
    })
    return queuedResult(entry, 0, activeReservation.source)
  }

  const queue = getPromptQueue(entry.sessionID)
  const existingIndex = queue.findIndex((queued) => queued.dedupeKey === entry.dedupeKey)
  if (existingIndex >= 0) {
    const existing = queue[existingIndex]
    if (existing) {
      log("[prompt-async-gate] queued prompt coalesced with pending dispatch", {
        sessionID: entry.sessionID,
        source: entry.source,
        queuedBy: existing.source,
        position: existingIndex + 1,
      })
      return queuedResult(existing, existingIndex + 1)
    }
  }

  queue.push(entry)
  log("[prompt-async-gate] queued prompt accepted", {
    sessionID: entry.sessionID,
    source: entry.source,
    position: queue.length,
  })

  if (queue.length > 1 || promptQueueDraining.has(entry.sessionID)) {
    schedulePromptQueueDrain(entry.sessionID, 0)
    return queuedResult(entry, queue.length)
  }

  const result = await drainPromptQueue(entry.sessionID, entry)
  return result ?? queuedResult(entry, 1)
}
