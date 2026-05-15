import { log } from "./logger"
import {
  DEFAULT_SESSION_IDLE_SETTLE_MS,
  isSessionActive,
  settleAfterSessionIdle,
} from "./session-idle-settle"

export const DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS = 250
export const DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS = 30_000

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

declare function setTimeout(callback: () => void, delay?: number): ReturnType<typeof globalThis.setTimeout>
declare function clearTimeout(timeout: ReturnType<typeof globalThis.setTimeout>): void

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

  const prefixes = typeof expectedPrefix === "string" ? [expectedPrefix] : expectedPrefix
  return prefixes
    .filter((prefix) => prefix.length > 0 && prefix.endsWith(":"))
    .some((prefix) => reservationSource.startsWith(prefix))
}

async function withDispatchTimeout<T>(
  operation: Promise<T>,
  dispatchTimeoutMs: number,
  operationName: string,
): Promise<T> {
  if (dispatchTimeoutMs <= 0) {
    return operation
  }

  let timeoutID: ReturnType<typeof globalThis.setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${dispatchTimeoutMs}ms`))
    }, dispatchTimeoutMs)
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID)
    }
  }
}

async function dispatchAfterSessionIdle<TInput>(args: {
  sessionName: "promptAsync" | "prompt"
  client: { session?: { status?: () => Promise<unknown> } }
  sessionID: string
  input: TInput
  source: string
  settleMs: number
  postDispatchHoldMs: number
  dispatchTimeoutMs: number
  checkStatus: boolean
  dispatch: (input: TInput) => Promise<unknown>
}): Promise<PromptAsyncGateResult> {
  const {
    sessionName,
    client,
    sessionID,
    input,
    source,
    settleMs,
    postDispatchHoldMs,
    dispatchTimeoutMs,
    checkStatus,
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
    reservedAt: Date.now(),
    token: Symbol(source),
  }
  promptAsyncReservations.set(sessionID, reservation)
  let dispatchAttempted = false

  try {
    const canReadStatus = checkStatus && typeof client.session?.status === "function"
    if (settleMs > 0) {
      await settleAfterSessionIdle(settleMs)
    }

    if (canReadStatus && await isSessionActive(client, sessionID)) {
      log(`[prompt-async-gate] ${sessionName} skipped because session is active`, { sessionID, source })
      return { status: "active" }
    }

    log(`[prompt-async-gate] ${sessionName} dispatching`, { sessionID, source })
    dispatchAttempted = true
    const response = await withDispatchTimeout(
      dispatch(input),
      dispatchTimeoutMs,
      `[prompt-async-gate] ${sessionName} dispatch`,
    )
    log(`[prompt-async-gate] ${sessionName} dispatched`, { sessionID, source })
    return { status: "dispatched", response }
  } catch (error) {
    log(`[prompt-async-gate] ${sessionName} failed`, { sessionID, source, error: String(error) })
    return { status: "failed", error }
  } finally {
    const current = promptAsyncReservations.get(sessionID)
    if (current?.token === reservation.token) {
      if (dispatchAttempted && postDispatchHoldMs > 0) {
        reservation.expiresAt = Date.now() + postDispatchHoldMs
      } else {
        promptAsyncReservations.delete(sessionID)
      }
    }
  }
}

export async function promptAsyncAfterSessionIdle<TInput = PromptAsyncInput>(args: {
  client: PromptAsyncClient<TInput>
  sessionID: string
  input: TInput
  source: string
  settleMs?: number
  postDispatchHoldMs?: number
  dispatchTimeoutMs?: number
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
  const dispatchTimeoutMs = args.dispatchTimeoutMs ?? DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS
  const promptAsync = client.session?.promptAsync

  if (typeof promptAsync !== "function") {
    log("[prompt-async-gate] promptAsync unavailable", { sessionID, source })
    return { status: "unavailable" }
  }

  return dispatchAfterSessionIdle({
    sessionName: "promptAsync",
    client,
    sessionID,
    input,
    source,
    settleMs,
    postDispatchHoldMs,
    dispatchTimeoutMs,
    checkStatus: args.checkStatus !== false,
    dispatch: (dispatchInput) => promptAsync(dispatchInput),
  })
}

export async function promptAfterSessionIdle<TInput = PromptAsyncInput>(args: {
  client: PromptClient<TInput>
  sessionID: string
  input: TInput
  source: string
  settleMs?: number
  postDispatchHoldMs?: number
  dispatchTimeoutMs?: number
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
  const dispatchTimeoutMs = args.dispatchTimeoutMs ?? DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS
  const prompt = client.session?.prompt

  if (typeof prompt !== "function") {
    log("[prompt-async-gate] prompt unavailable", { sessionID, source })
    return { status: "unavailable" }
  }

  return dispatchAfterSessionIdle({
    sessionName: "prompt",
    client,
    sessionID,
    input,
    source,
    settleMs,
    postDispatchHoldMs,
    dispatchTimeoutMs,
    checkStatus: args.checkStatus !== false,
    dispatch: (dispatchInput) => prompt(dispatchInput),
  })
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
