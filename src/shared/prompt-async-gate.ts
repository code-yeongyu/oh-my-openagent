import { log } from "./logger"
import {
  DEFAULT_SESSION_IDLE_SETTLE_MS,
  isSessionActive,
  settleAfterSessionIdle,
} from "./session-idle-settle"

export const DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS = 250

type PromptAsyncInput = {
  path?: { id?: string }
  body?: unknown
  query?: unknown
  signal?: unknown
  [key: string]: unknown
}

type PromptAsyncClient<TInput> = {
  session?: {
    status?: () => Promise<unknown>
    promptAsync?: (input: TInput) => Promise<unknown>
  }
}

type PromptClient<TInput> = {
  session?: {
    status?: () => Promise<unknown>
    prompt?: (input: TInput) => Promise<unknown>
  }
}

type PromptAsyncReservation = {
  source: string
  reservedAt: number
  token: symbol
  expiresAt?: number
}

export type PromptAsyncGateResult =
  | { status: "dispatched"; response: unknown }
  | { status: "active" }
  | { status: "reserved"; reservedBy: string }
  | { status: "unavailable" }
  | { status: "failed"; error: unknown }

type PromptAsyncReservationReleaseOptions = {
  reservedBy?: string | readonly string[]
  reservedByPrefix?: string | readonly string[]
}

const promptAsyncReservations = new Map<string, PromptAsyncReservation>()

function pruneExpiredReservations(now = Date.now()): void {
  for (const [sessionID, reservation] of promptAsyncReservations) {
    if (typeof reservation.expiresAt === "number" && reservation.expiresAt <= now) {
      promptAsyncReservations.delete(sessionID)
      log("[prompt-async-gate] expired reservation released", {
        sessionID,
        source: reservation.source,
      })
    }
  }
}

function getActiveReservation(sessionID: string): PromptAsyncReservation | undefined {
  pruneExpiredReservations()
  return promptAsyncReservations.get(sessionID)
}

function reservationSourceMatches(
  reservationSource: string,
  expectedSource: string | readonly string[],
  expectedPrefix?: string | readonly string[],
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

  if (typeof expectedPrefix === "string") {
    return reservationSource.startsWith(expectedPrefix)
  }

  return expectedPrefix.some((prefix) => reservationSource.startsWith(prefix))
}

export async function promptAsyncAfterSessionIdle<TInput = PromptAsyncInput>(args: {
  client: PromptAsyncClient<TInput>
  sessionID: string
  input: TInput
  source: string
  settleMs?: number
  postDispatchHoldMs?: number
  checkStatus?: boolean
}): Promise<PromptAsyncGateResult> {
  const {
    client,
    sessionID,
    input,
    source,
    settleMs = DEFAULT_SESSION_IDLE_SETTLE_MS,
  } = args
  const postDispatchHoldMs = args.postDispatchHoldMs ?? DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS

  if (typeof client.session?.promptAsync !== "function") {
    log("[prompt-async-gate] promptAsync unavailable", { sessionID, source })
    return { status: "unavailable" }
  }

  const existing = getActiveReservation(sessionID)
  if (existing) {
    log("[prompt-async-gate] promptAsync skipped because session is reserved", {
      sessionID,
      source,
      reservedBy: existing.source,
      reservedAgeMs: Date.now() - existing.reservedAt,
    })
    return { status: "reserved", reservedBy: existing.source }
  }

  const reservation: PromptAsyncReservation = {
    source,
    reservedAt: Date.now(),
    token: Symbol(source),
  }
  promptAsyncReservations.set(sessionID, reservation)
  let holdReservationAfterDispatch = false

  try {
    const canReadStatus = args.checkStatus !== false && typeof client.session?.status === "function"
    if (settleMs > 0) {
      await settleAfterSessionIdle(settleMs)
    }

    if (canReadStatus && await isSessionActive(client, sessionID)) {
      log("[prompt-async-gate] promptAsync skipped because session is active", { sessionID, source })
      return { status: "active" }
    }

    log("[prompt-async-gate] promptAsync dispatching", { sessionID, source })
    const response = await client.session.promptAsync(input)
    if (postDispatchHoldMs > 0) {
      holdReservationAfterDispatch = true
    }
    log("[prompt-async-gate] promptAsync dispatched", { sessionID, source })
    return { status: "dispatched", response }
  } catch (error) {
    log("[prompt-async-gate] promptAsync failed", { sessionID, source, error: String(error) })
    return { status: "failed", error }
  } finally {
    const current = promptAsyncReservations.get(sessionID)
    if (current?.token === reservation.token) {
      if (holdReservationAfterDispatch && postDispatchHoldMs > 0) {
        reservation.expiresAt = Date.now() + postDispatchHoldMs
      } else {
        promptAsyncReservations.delete(sessionID)
      }
    }
  }
}

export async function promptAfterSessionIdle<TInput = PromptAsyncInput>(args: {
  client: PromptClient<TInput>
  sessionID: string
  input: TInput
  source: string
  settleMs?: number
  postDispatchHoldMs?: number
  checkStatus?: boolean
}): Promise<PromptAsyncGateResult> {
  const {
    client,
    sessionID,
    input,
    source,
    settleMs = DEFAULT_SESSION_IDLE_SETTLE_MS,
  } = args
  const postDispatchHoldMs = args.postDispatchHoldMs ?? DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS

  if (typeof client.session?.prompt !== "function") {
    log("[prompt-async-gate] prompt unavailable", { sessionID, source })
    return { status: "unavailable" }
  }

  const existing = getActiveReservation(sessionID)
  if (existing) {
    log("[prompt-async-gate] prompt skipped because session is reserved", {
      sessionID,
      source,
      reservedBy: existing.source,
      reservedAgeMs: Date.now() - existing.reservedAt,
    })
    return { status: "reserved", reservedBy: existing.source }
  }

  const reservation: PromptAsyncReservation = {
    source,
    reservedAt: Date.now(),
    token: Symbol(source),
  }
  promptAsyncReservations.set(sessionID, reservation)
  let holdReservationAfterDispatch = false

  try {
    const canReadStatus = args.checkStatus !== false && typeof client.session?.status === "function"
    if (settleMs > 0) {
      await settleAfterSessionIdle(settleMs)
    }

    if (canReadStatus && await isSessionActive(client, sessionID)) {
      log("[prompt-async-gate] prompt skipped because session is active", { sessionID, source })
      return { status: "active" }
    }

    log("[prompt-async-gate] prompt dispatching", { sessionID, source })
    const response = await client.session.prompt(input)
    if (postDispatchHoldMs > 0) {
      holdReservationAfterDispatch = true
    }
    log("[prompt-async-gate] prompt dispatched", { sessionID, source })
    return { status: "dispatched", response }
  } catch (error) {
    log("[prompt-async-gate] prompt failed", { sessionID, source, error: String(error) })
    return { status: "failed", error }
  } finally {
    const current = promptAsyncReservations.get(sessionID)
    if (current?.token === reservation.token) {
      if (holdReservationAfterDispatch && postDispatchHoldMs > 0) {
        reservation.expiresAt = Date.now() + postDispatchHoldMs
      } else {
        promptAsyncReservations.delete(sessionID)
      }
    }
  }
}

export function releaseAllPromptAsyncReservationsForTesting(): void {
  promptAsyncReservations.clear()
}

export function releasePromptAsyncReservation(
  sessionID: string,
  source: string,
  options?: PromptAsyncReservationReleaseOptions,
): boolean {
  const existing = promptAsyncReservations.get(sessionID)
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

  promptAsyncReservations.delete(sessionID)
  log("[prompt-async-gate] promptAsync reservation released", {
    sessionID,
    source,
    reservedBy: existing.source,
  })
  return true
}
