import { log } from "../logger"
import type { PromptAsyncReservation, PromptAsyncReservationReleaseOptions } from "./types"

const promptAsyncReservations = new Map<string, PromptAsyncReservation>()
let expiredReservationHandler: ((sessionID: string) => void) | undefined

export function setExpiredReservationHandler(handler: (sessionID: string) => void): void {
  expiredReservationHandler = handler
}

function notifyExpiredReservation(sessionID: string): void {
  expiredReservationHandler?.(sessionID)
}

function pruneExpiredReservations(now = Date.now()): void {
  const expiredSessionIDs: string[] = []
  for (const [sessionID, reservation] of promptAsyncReservations) {
    if (typeof reservation.expiresAt === "number" && reservation.expiresAt <= now) {
      promptAsyncReservations.delete(sessionID)
      expiredSessionIDs.push(sessionID)
      log("[prompt-async-gate] expired reservation released", {
        sessionID,
        source: reservation.source,
      })
    }
  }
  for (const sessionID of expiredSessionIDs) {
    notifyExpiredReservation(sessionID)
  }
}

export function getActiveReservation(sessionID: string): PromptAsyncReservation | undefined {
  pruneExpiredReservations()
  return promptAsyncReservations.get(sessionID)
}

export function getPromptReservation(sessionID: string): PromptAsyncReservation | undefined {
  return promptAsyncReservations.get(sessionID)
}

export function setPromptReservation(sessionID: string, reservation: PromptAsyncReservation): void {
  promptAsyncReservations.set(sessionID, reservation)
}

export function finishPromptReservation(
  sessionID: string,
  reservation: PromptAsyncReservation,
  dispatchAttempted: boolean,
  postDispatchHoldMs: number,
): void {
  const current = promptAsyncReservations.get(sessionID)
  if (current?.token !== reservation.token) {
    return
  }

  if (dispatchAttempted && postDispatchHoldMs > 0) {
    promptAsyncReservations.set(sessionID, {
      ...reservation,
      expiresAt: Date.now() + postDispatchHoldMs,
    })
    return
  }
  promptAsyncReservations.delete(sessionID)
}

export function deletePromptReservation(sessionID: string): void {
  promptAsyncReservations.delete(sessionID)
}

export function clearPromptReservationsForTesting(): void {
  promptAsyncReservations.clear()
}

export function reservationSourceMatches(
  reservationSource: string,
  expectedSource: string | readonly string[],
  expectedPrefix?: PromptAsyncReservationReleaseOptions["reservedByPrefix"],
): boolean {
  if (typeof expectedSource === "string") {
    if (reservationSource === expectedSource) {
      return true
    }
  } else if (expectedSource.includes(reservationSource)) {
    return true
  }

  if (expectedPrefix === undefined) {
    return false
  }

  const prefixes = typeof expectedPrefix === "string" ? [expectedPrefix] : expectedPrefix
  return prefixes
    .filter((prefix) => prefix.length > 0 && prefix.endsWith(":"))
    .some((prefix) => reservationSource.startsWith(prefix))
}
