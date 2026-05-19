import { log } from "./logger"
import {
  isSyntheticOrInternalUserMessage,
  type InternalInitiatorMessageLike,
  type InternalInitiatorTextPartLike,
} from "./internal-initiator-marker"
import {
  DEFAULT_SESSION_IDLE_SETTLE_MS,
  isSessionActive,
  settleAfterSessionIdle,
} from "./session-idle-settle"

export const DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS = 250
export const DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS = 30_000
export const DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS = 5_000
export const DEFAULT_PROMPT_QUEUE_RETRY_MS = 250

type PromptAsyncInput = {
  path?: { id?: string }
  body?: unknown
  query?: unknown
  signal?: unknown
  [key: string]: unknown
}

type PromptMessagesQuery = {
  directory: string
  limit?: number
}

type PromptAsyncClient<TInput> = {
  session?: {
    status?: () => Promise<unknown>
    messages?: (input: { path: { id: string }; query: PromptMessagesQuery }) => Promise<unknown>
    promptAsync?: (input: TInput) => Promise<unknown>
  }
}

type PromptClient<TInput> = {
  session?: {
    status?: () => Promise<unknown>
    messages?: (input: { path: { id: string }; query: PromptMessagesQuery }) => Promise<unknown>
    prompt?: (input: TInput) => Promise<unknown>
  }
}

export type InternalPromptDispatchMode = "async" | "sync"
export type InternalPromptQueueBehavior = "enqueue" | "defer"

type InternalPromptDispatchCommonArgs<TInput> = {
  sessionID: string
  input: TInput
  source: string
  dedupeKey?: string
  queueBehavior?: InternalPromptQueueBehavior
  queue?: boolean
  queueRetryMs?: number
  settleMs?: number
  postDispatchHoldMs?: number
  dispatchTimeoutMs?: number
  checkStatus?: boolean
  checkToolState?: boolean
}

export type InternalPromptDispatchArgs<TInput = PromptAsyncInput> = InternalPromptDispatchCommonArgs<TInput> & (
  | { mode: "async"; client: PromptAsyncClient<TInput> }
  | { mode: "sync"; client: PromptClient<TInput> }
)

type PromptAsyncReservation = {
  source: string
  dedupeKey: string
  reservedAt: number
  token: symbol
  expiresAt?: number
}

declare function setTimeout(callback: () => void, delay?: number): unknown
declare function clearTimeout(timeout: unknown): void

let promptGateMessagesFetchTimeoutMsForTesting: number | undefined

export type InternalPromptDispatchResult =
  | { status: "dispatched"; response: unknown }
  | { status: "queued"; queuedBy: string; position: number }
  | { status: "active" }
  | { status: "reserved"; reservedBy: string }
  | { status: "unavailable" }
  | { status: "failed"; error: unknown }

export type PromptAsyncGateResult = InternalPromptDispatchResult

type PromptAsyncReservationReleaseOptions = {
  reservedBy?: string | readonly string[]
  reservedByPrefix?: string | readonly string[]
}

const promptAsyncReservations = new Map<string, PromptAsyncReservation>()
const promptQueues = new Map<string, QueuedInternalPrompt[]>()
const promptQueueDraining = new Set<string>()
const promptQueueInFlight = new Map<string, QueuedInternalPrompt>()
const promptQueueTimers = new Map<string, unknown>()
let promptQueueSequence = 0

type PromptDispatchClient = {
  session?: {
    status?: () => Promise<unknown>
    messages?: (input: { path: { id: string }; query: PromptMessagesQuery }) => Promise<unknown>
  }
}

type QueuedInternalPrompt = {
  id: number
  sessionID: string
  sessionName: "promptAsync" | "prompt"
  client: PromptDispatchClient
  input: unknown
  source: string
  dedupeKey: string
  settleMs: number
  postDispatchHoldMs: number
  dispatchTimeoutMs: number
  queueRetryMs: number
  checkStatus: boolean
  checkToolState: boolean
  dispatch: (input: unknown) => Promise<unknown>
}

export function _setPromptGateMessagesFetchTimeoutMsForTesting(value: number | undefined): void {
  promptGateMessagesFetchTimeoutMsForTesting = value
}

function getPromptGateMessagesFetchTimeoutMs(): number {
  return promptGateMessagesFetchTimeoutMsForTesting ?? DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS
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
    schedulePromptQueueDrain(sessionID, 0)
  }
}

function getActiveReservation(sessionID: string): PromptAsyncReservation | undefined {
  pruneExpiredReservations()
  return promptAsyncReservations.get(sessionID)
}

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

function schedulePromptQueueDrain(sessionID: string, delayMs: number): void {
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
  const queue = promptQueues.get(sessionID)
  if (!queue) {
    return
  }
  const nextQueue = queue.filter((queued) => queued.id !== entry.id)
  setPromptQueue(sessionID, nextQueue)
}

function getQueuedPromptBlocker(sessionID: string): string | undefined {
  const inFlight = promptQueueInFlight.get(sessionID)
  if (inFlight) {
    return inFlight.source
  }

  const queue = promptQueues.get(sessionID)
  return queue?.[0]?.source
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

  let timeoutID: unknown
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getPromptQuery(input: unknown): PromptMessagesQuery {
  if (!isRecord(input)) {
    return { directory: "" }
  }
  const query = input.query
  if (!isRecord(query)) {
    return { directory: "" }
  }

  const promptQuery: PromptMessagesQuery = { directory: "" }
  if (typeof query.directory === "string") {
    promptQuery.directory = query.directory
  }
  if (typeof query.limit === "number") {
    promptQuery.limit = query.limit
  }
  return promptQuery
}

function getMessagesData(response: unknown): unknown[] {
  if (isRecord(response) && Array.isArray(response.data)) {
    return response.data
  }
  return Array.isArray(response) ? response : []
}

function messageRole(message: unknown): string | undefined {
  if (!isRecord(message)) {
    return undefined
  }
  const info = message.info
  if (isRecord(info) && typeof info.role === "string") {
    return info.role
  }
  return typeof message.role === "string" ? message.role : undefined
}

function messageFinish(message: unknown): string | undefined {
  if (!isRecord(message)) {
    return undefined
  }
  const info = message.info
  if (isRecord(info) && typeof info.finish === "string") {
    return info.finish
  }
  return typeof message.finish === "string" ? message.finish : undefined
}

function toInternalInitiatorTextPartLike(part: unknown): InternalInitiatorTextPartLike {
  const result: InternalInitiatorTextPartLike = {}
  if (!isRecord(part)) {
    return result
  }

  if (typeof part.type === "string") {
    result.type = part.type
  }
  if (typeof part.text === "string") {
    result.text = part.text
  }
  if (typeof part.synthetic === "boolean") {
    result.synthetic = part.synthetic
  }
  return result
}

function toInternalInitiatorMessageLike(message: unknown): InternalInitiatorMessageLike | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  const result: InternalInitiatorMessageLike = {}
  const info = message.info
  if (isRecord(info) && typeof info.role === "string") {
    result.info = { role: info.role }
  }
  if (typeof message.role === "string") {
    result.role = message.role
  }
  if (Array.isArray(message.parts)) {
    result.parts = message.parts.map(toInternalInitiatorTextPartLike)
  }
  return result
}

function messageIsSyntheticOrInternalUser(message: unknown): boolean {
  const initiatorMessage = toInternalInitiatorMessageLike(message)
  return initiatorMessage !== undefined && isSyntheticOrInternalUserMessage(initiatorMessage)
}

function partIsWaitingOnTool(part: unknown): boolean {
  if (!isRecord(part)) {
    return false
  }
  if (
    part.type !== "tool"
    && part.type !== "tool_use"
    && part.type !== "tool-call"
    && part.type !== "tool-invocation"
  ) {
    return false
  }

  const state = part.state
  if (!isRecord(state)) {
    return false
  }
  return state.status === "pending" || state.status === "running"
}

function latestAssistantTurnBlocksInternalPrompt(messages: unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const role = messageRole(message)
    if (role === "assistant") {
      const finish = messageFinish(message)
      if (finish === undefined) {
        return true
      }
      if (!isRecord(message) || !Array.isArray(message.parts)) {
        return finish === "tool-calls"
      }
      return finish === "tool-calls" || message.parts.some(partIsWaitingOnTool)
    }
    if (role === "user") {
      if (messageIsSyntheticOrInternalUser(message)) {
        continue
      }
      return false
    }
  }
  return false
}

async function sessionLatestAssistantBlocksInternalPrompt<TInput>(args: {
  client: { session?: { messages?: (input: { path: { id: string }; query: PromptMessagesQuery }) => Promise<unknown> } }
  sessionID: string
  input: TInput
  sessionName: "promptAsync" | "prompt"
  source: string
  timeoutMs: number
}): Promise<boolean> {
  const session = args.client.session
  if (typeof session?.messages !== "function") {
    return false
  }
  const messages = session.messages.bind(session)

  try {
    const response = await withDispatchTimeout(
      messages({
        path: { id: args.sessionID },
        query: getPromptQuery(args.input),
      }),
      args.timeoutMs,
      `[prompt-async-gate] ${args.sessionName} session.messages`,
    )
    return latestAssistantTurnBlocksInternalPrompt(getMessagesData(response))
  } catch (error) {
    log("[prompt-async-gate] latest assistant prompt-block check failed", {
      sessionID: args.sessionID,
      source: args.source,
      error: String(error),
    })
    return false
  }
}

async function dispatchAfterSessionIdle<TInput>(args: {
  sessionName: "promptAsync" | "prompt"
  client: {
    session?: {
      status?: () => Promise<unknown>
      messages?: (input: { path: { id: string }; query: PromptMessagesQuery }) => Promise<unknown>
    }
  }
  sessionID: string
  input: TInput
  source: string
  dedupeKey: string
  settleMs: number
  postDispatchHoldMs: number
  dispatchTimeoutMs: number
  checkStatus: boolean
  checkToolState: boolean
  dispatch: (input: TInput) => Promise<unknown>
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
  promptAsyncReservations.set(sessionID, reservation)
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
      } catch {
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

async function drainPromptQueue(sessionID: string, awaitedEntry?: QueuedInternalPrompt): Promise<InternalPromptDispatchResult | undefined> {
  if (promptQueueDraining.has(sessionID)) {
    return awaitedEntry ? queuedResult(awaitedEntry, 1) : undefined
  }

  promptQueueDraining.add(sessionID)
  clearPromptQueueTimer(sessionID)

  let awaitedResult: InternalPromptDispatchResult | undefined
  try {
    while (true) {
      const queue = promptQueues.get(sessionID)
      const entry = queue?.[0]
      if (!entry) {
        break
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
        dispatchTimeoutMs: entry.dispatchTimeoutMs,
        checkStatus: entry.checkStatus,
        checkToolState: entry.checkToolState,
        dispatch: entry.dispatch,
      })
      if (promptQueueInFlight.get(sessionID)?.id === entry.id) {
        promptQueueInFlight.delete(sessionID)
      }

      if (result.status === "active" || result.status === "reserved") {
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

async function enqueueInternalPrompt(entry: QueuedInternalPrompt): Promise<InternalPromptDispatchResult> {
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
    if (queuedBy !== undefined || promptQueueDraining.has(sessionID)) {
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
      id: promptQueueSequence += 1,
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
      dispatch: dispatch as (dispatchInput: unknown) => Promise<unknown>,
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
  promptAsyncReservations.clear()
  promptQueues.clear()
  promptQueueDraining.clear()
  promptQueueInFlight.clear()
  for (const timer of promptQueueTimers.values()) {
    clearTimeout(timer)
  }
  promptQueueTimers.clear()
  promptGateMessagesFetchTimeoutMsForTesting = undefined
}

export function isInternalPromptDispatchAccepted(result: InternalPromptDispatchResult): boolean {
  return result.status === "dispatched" || result.status === "queued"
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
  const inFlight = promptQueueInFlight.get(sessionID)
  if (inFlight?.dedupeKey === existing.dedupeKey) {
    removePromptQueueEntry(sessionID, inFlight)
    promptQueueInFlight.delete(sessionID)
    promptQueueDraining.delete(sessionID)
  }
  schedulePromptQueueDrain(sessionID, 0)
  log("[prompt-async-gate] promptAsync reservation released", {
    sessionID,
    source,
    reservedBy: existing.source,
  })
  return true
}
