// The resident Kibitzer: ONE in-process child per bound main session, created lazily on the first
// wake-eligible batch and disposed on session shutdown, never recreated after it.
//
// The whole lifecycle is a small state machine behind a per-session mutex:
//
//   idle ──wake──▶ turn_running ──settle──▶ idle
//                       │   ▲                  │  context budget reached
//                       │   └─ late steers replay through ONE followUp
//                       │                      ▼
//              child failed / no child      reseeding ──wake──▶ turn_running (replacement child)
//                       ▼
//                    backoff ──timer──▶ idle (recreated lazily by the next wake)
//   any ──shutdown──▶ disposed
//
// Hook events are captured synchronously into the bounded event stream and only ever BUFFER; a
// provider turn happens when `offer` brings a candidate path the child has not seen and the session
// has not surfaced. An idle child is revived with `followUp` (a fresh tracked turn); a running turn
// is `steer`ed (senpi's default steering mode drains every queued steer at the next boundary). The
// child's own event stream is the sidecar's instrument: it counts tool calls for the per-wake budget,
// confirms which steers reached the transcript, and reads provider usage for the context estimate.
// Aborting for budget, deadline or shutdown is never a failure; a failed child enters exponential
// backoff and keeps every buffered event for the child that follows.

import { validateNudges, type RecallCandidate, type RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildHandle, ChildSessionEvent, RunnerOutcome } from "@oh-my-opencode/senpi-task"

import type { ComponentLogger } from "../../../extension/types"
import {
  createKibitzerEventStream,
  type KibitzerEvent,
  type KibitzerEventBatch,
  type KibitzerEventCaps,
  type KibitzerEventDigest,
  type KibitzerEventStream,
} from "./events"
import {
  classifyWakeEnd,
  isDiagnosticWakeEnd,
  startFailureEnd,
  type KibitzerWakeAbort,
  type KibitzerWakeEnd,
  type KibitzerWakeOutcome,
} from "./sidecar-outcome"
import {
  renderKibitzerReseedPrompt,
  renderKibitzerSeedPrompt,
  renderKibitzerWakePrompt,
  type KibitzerReseedInput,
  type KibitzerSidecarEnvelopeInput,
  type KibitzerSidecarEvent,
} from "./sidecar-prompt"
import { createWakeToolBudget, type KibitzerSidecarTools, type KibitzerSidecarToolsInput, type WakeToolBudget } from "./tools"
import type { AnyKibitzerSidecarTool } from "./tools/result"
import { backoffDelayMs, createAcceptedNudgeCooldown, decideWake, type WakeSilenceReason } from "./wake-policy"

/** `memory.recall.tool_budget` default: child tool calls one wake may spend before it is cut off. */
export const KIBITZER_WAKE_TOOL_BUDGET = 8
/** A wake that has not settled in this long is aborted; whatever it accepted so far is kept. */
export const KIBITZER_WAKE_DEADLINE_MS = 90_000
/** `memory.recall.sidecar_max_tokens` default, used when the registry knows no context window. */
export const KIBITZER_SIDECAR_MAX_TOKENS = 48_000
/** The child is replaced once its context estimate reaches this share of the budget. */
export const KIBITZER_RESEED_FRACTION = 0.6
/** A path offered this many wakes ago without a nudge is carried into the reseed as rejected. */
export const KIBITZER_REJECTED_AFTER_WAKES = 3

export type KibitzerSidecarState = "idle" | "turn_running" | "reseeding" | "backoff" | "disposed"

/** Injectable timers: production uses the runtime's (unref'd); tests fire them by hand. */
export interface KibitzerSidecarTimers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

/** What the sidecar hands its child factory: the first user message and the tools it may call. */
export interface KibitzerSidecarChildInput {
  readonly sessionId: string
  /** 1 for the first child, +1 per recreation (backoff or reseed). */
  readonly generation: number
  /** The seed envelope, or the reseed envelope followed by the first wake envelope. */
  readonly prompt: string
  readonly tools: readonly AnyKibitzerSidecarTool[]
  /** `memory.recall.max_items` at creation; the nudge closure is bound to it for this child. */
  readonly maxItems: number
}

/** The sidecar-owned half of the tool input: live nudge sets and the current wake's budget. */
export type KibitzerSidecarToolBinding = Pick<KibitzerSidecarToolsInput, "nudge" | "budget">

export interface KibitzerSidecarOptions {
  readonly sessionId: string
  /** Starts the resident child with its first turn already running (senpi-task `ChildHandle`). */
  readonly startChild: (input: KibitzerSidecarChildInput) => Promise<ChildHandle>
  /** Builds the five closures over the host-owned workspace/session/memory plus this binding. */
  readonly createTools: (binding: KibitzerSidecarToolBinding) => KibitzerSidecarTools
  /**
   * Hands re-validated nudges to the unchanged delivery path (ledger mark, hold, steer at the next
   * tool_result / passive coordinator / prompt drain).
   */
  readonly deliver: (nudges: readonly RecallNudge[], outcome: Pick<KibitzerWakeOutcome, "wake" | "generation">) => Promise<void>
  /** Every settled wake, including failures and aborts; the observability lane persists these. */
  readonly onWake?: (outcome: KibitzerWakeOutcome) => void
  readonly toolBudget?: number
  readonly wakeDeadlineMs?: number
  /** Context estimate (tokens) at which the child is disposed for a reseed; defaults to 60% of 48k. */
  readonly reseedAtTokens?: number
  readonly eventCaps?: Partial<KibitzerEventCaps>
  readonly now?: () => number
  readonly random?: () => number
  readonly timers?: KibitzerSidecarTimers
  readonly logger?: ComponentLogger
}

export interface KibitzerOfferInput {
  /** Lexical recall candidates collected for the newest prompt / tool_call hook. */
  readonly candidates: readonly RecallCandidate[]
  /** The session's surfaced ledger as read for this batch; stays authoritative over the child. */
  readonly surfaced: ReadonlySet<string>
  /** `memory.recall.max_items` resolved for the bound agent. */
  readonly maxItems: number
  /** One line naming the task; the first prompt's head is used when absent. */
  readonly taskSummary?: string
}

export type KibitzerBufferedReason = WakeSilenceReason | "backoff" | "disposed"

export type KibitzerOfferResult =
  /** A new child was created (first wake, or after backoff / reseed). */
  | { readonly action: "seeded"; readonly wake: number }
  /** The idle resident child was revived. */
  | { readonly action: "followed_up"; readonly wake: number }
  /** The batch joined the running turn. */
  | { readonly action: "steered"; readonly wake: number }
  /** No model turn: the events stay buffered for the next real wake. */
  | { readonly action: "buffered"; readonly reason: KibitzerBufferedReason }

export interface KibitzerSidecar {
  readonly sessionId: string
  state(): KibitzerSidecarState
  /** Synchronous hook capture; buffers only, never wakes, never throws. Ignored once disposed. */
  readonly events: Pick<KibitzerEventStream, "onPrompt" | "onToolCall" | "onToolResult" | "size" | "lastCursor">
  /** The trigger: decides, serialized per session, whether this batch wakes the child and how. */
  offer(input: KibitzerOfferInput): Promise<KibitzerOfferResult>
  /** Session shutdown: aborts a running turn, disposes the child, never recreates. Idempotent. */
  shutdown(): Promise<void>
  /** Resolves once every queued transition has run and the running turn, if any, has settled. */
  whenIdle(): Promise<void>
}

/** Events and candidates that one envelope carried; kept until the child is known to have read them. */
interface Payload {
  readonly events: readonly KibitzerEvent[]
  readonly digest?: KibitzerEventDigest
  readonly candidates: readonly RecallCandidate[]
  readonly cursors?: { readonly first: number; readonly last: number }
}

interface Envelope {
  readonly text: string
  readonly payload: Payload
  readonly steered: boolean
  /** Confirmed through the child's own `message_end` for the user message carrying `text`. */
  consumed: boolean
}

interface Child {
  readonly handle: ChildHandle
  readonly generation: number
  readonly tools: KibitzerSidecarTools
  readonly unsubscribe: () => void
  /** `usage.input + usage.cacheRead` of the newest assistant message; undefined until usage is seen. */
  usageTokens: number | undefined
  /** Every character the sidecar sent, for the char/4 fallback. */
  charsSent: number
}

interface Turn {
  readonly wake: number
  readonly generation: number
  readonly maxItems: number
  readonly startedAt: number
  readonly accepted: RecallNudge[]
  readonly budget: WakeToolBudget
  readonly envelopes: Envelope[]
  candidateCount: number
  toolStarts: number
  toolEnds: number
  abort: KibitzerWakeAbort | undefined
  deadline: unknown
  model: string | undefined
  settled: Promise<void>
}

const TASK_SUMMARY_HEAD_CHARS = 200

export function createKibitzerSidecar(options: KibitzerSidecarOptions): KibitzerSidecar {
  const { sessionId } = options
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const timers = options.timers ?? RUNTIME_TIMERS
  const toolBudget = options.toolBudget ?? KIBITZER_WAKE_TOOL_BUDGET
  const wakeDeadlineMs = options.wakeDeadlineMs ?? KIBITZER_WAKE_DEADLINE_MS
  const reseedAtTokens = options.reseedAtTokens ?? Math.floor(KIBITZER_SIDECAR_MAX_TOKENS * KIBITZER_RESEED_FRACTION)
  const cooldown = createAcceptedNudgeCooldown({ now })
  const stream = createKibitzerEventStream({
    now,
    ...(options.eventCaps === undefined ? {} : { caps: options.eventCaps }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })

  let state: KibitzerSidecarState = "idle"
  let child: Child | undefined
  let activeTurn: Turn | undefined
  let wakeSeq = 0
  let generations = 0
  let consecutiveFailures = 0
  let backoffTimer: unknown
  let pendingReseed: Omit<KibitzerReseedInput, "maxItems" | "toolBudget"> | undefined
  let taskSummary: string | undefined
  /** Payloads no child has confirmed reading: replayed by the next envelope, oldest first. */
  let carry: Payload[] = []
  /** Live sets the nudge closure reads at call time; the same objects for every child. */
  const offered = new Set<string>()
  const surfaced = new Set<string>()
  const offeredAtWake = new Map<string, number>()
  const delivered = new Set<string>()
  /** The CURRENT wake's slots; the tools read them through the binding's getters. */
  let accepted: RecallNudge[] = []
  let budget: WakeToolBudget = createWakeToolBudget(toolBudget)

  // ---- the per-session mutex -------------------------------------------------------------------

  let chain: Promise<unknown> = Promise.resolve()
  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task)
    chain = run.catch(() => undefined)
    return run
  }

  async function whenIdle(): Promise<void> {
    for (;;) {
      await chain
      const turn = activeTurn
      if (turn === undefined) return
      await turn.settled
    }
  }

  function warn(message: string, details: Record<string, unknown> = {}): void {
    options.logger?.warn(message, { sessionId, ...details })
  }

  // ---- envelopes -------------------------------------------------------------------------------

  function payloadOf(batch: KibitzerEventBatch, candidates: readonly RecallCandidate[]): Payload {
    return {
      events: batch.events,
      ...(batch.digest === undefined ? {} : { digest: batch.digest }),
      candidates,
      ...(batch.cursors === undefined ? {} : { cursors: batch.cursors }),
    }
  }

  /** Oldest carried payloads first, then the fresh batch: events by seq, candidates by first sight. */
  function merge(parts: readonly Payload[]): Payload {
    const bySeq = new Map<number, KibitzerEvent>()
    const byPath = new Map<string, RecallCandidate>()
    let digest: KibitzerEventDigest | undefined
    let first: number | undefined
    let last: number | undefined
    for (const part of parts) {
      for (const event of part.events) bySeq.set(event.seq, event)
      for (const candidate of part.candidates) if (!byPath.has(candidate.path)) byPath.set(candidate.path, candidate)
      digest ??= part.digest
      if (part.cursors !== undefined) {
        first = first === undefined ? part.cursors.first : Math.min(first, part.cursors.first)
        last = last === undefined ? part.cursors.last : Math.max(last, part.cursors.last)
      }
    }
    return {
      events: [...bySeq.values()].sort((left, right) => left.seq - right.seq),
      ...(digest === undefined ? {} : { digest }),
      candidates: [...byPath.values()],
      ...(first === undefined || last === undefined ? {} : { cursors: { first, last } }),
    }
  }

  function envelopeInput(payload: Payload, maxItems: number, withTask: boolean): KibitzerSidecarEnvelopeInput {
    return {
      sessionId,
      maxItems,
      toolBudget,
      events: payload.events.map(sidecarEvent),
      candidates: payload.candidates,
      ...(payload.digest === undefined ? {} : {
        digest: {
          text: payload.digest.line,
          cursorFrom: payload.digest.firstCursor,
          cursorTo: payload.digest.lastCursor,
          folded: payload.digest.count,
        },
      }),
      ...(withTask && taskSummary !== undefined ? { taskSummary } : {}),
    }
  }

  // ---- the child's event stream: budget, consumption, usage ------------------------------------

  function observe(event: ChildSessionEvent): void {
    const turn = activeTurn
    if (turn === undefined) return
    switch (event.type) {
      case "tool_execution_start":
        turn.toolStarts += 1
        // A parallel batch can start the call past the budget before the eighth one ends.
        if (turn.toolStarts > toolBudget) void abortTurn(turn, "tool_budget")
        return
      case "tool_execution_end":
        turn.toolEnds += 1
        if (turn.toolEnds >= toolBudget) void abortTurn(turn, "tool_budget")
        return
      case "message_end":
        observeMessage(turn, event.message)
        return
      default:
        return
    }
  }

  function observeMessage(turn: Turn, message: unknown): void {
    if (!isRecord(message)) return
    if (message.role === "user") {
      const text = textOf(message.content)
      const envelope = turn.envelopes.find((candidate) => !candidate.consumed && candidate.text === text)
      if (envelope !== undefined) envelope.consumed = true
      return
    }
    if (message.role !== "assistant") return
    if (typeof message.provider === "string" && typeof message.model === "string") turn.model = `${message.provider}/${message.model}`
    if (child === undefined || !isRecord(message.usage)) return
    const input = typeof message.usage.input === "number" ? message.usage.input : undefined
    const cacheRead = typeof message.usage.cacheRead === "number" ? message.usage.cacheRead : undefined
    if (input === undefined && cacheRead === undefined) return
    child.usageTokens = (input ?? 0) + (cacheRead ?? 0)
  }

  function contextEstimate(current: Child): number {
    return current.usageTokens ?? Math.ceil(current.charsSent / 4)
  }

  // ---- timers ------------------------------------------------------------------------------------

  function armDeadline(turn: Turn): void {
    clearDeadline(turn)
    turn.deadline = timers.set(() => {
      void abortTurn(turn, "deadline")
    }, wakeDeadlineMs)
  }

  function clearDeadline(turn: Turn): void {
    if (turn.deadline === undefined) return
    timers.clear(turn.deadline)
    turn.deadline = undefined
  }

  /** The sidecar's own abort: recorded first so settlement reads the cause, not the engine's `cancelled`. */
  function abortTurn(turn: Turn, cause: KibitzerWakeAbort): Promise<void> {
    return serialized(async () => {
      if (activeTurn !== turn || turn.abort !== undefined || child === undefined) return
      turn.abort = cause
      clearDeadline(turn)
      await abortHandle(child.handle, cause)
    })
  }

  async function abortHandle(handle: ChildHandle, cause: string): Promise<void> {
    try {
      await handle.abort()
    } catch (error) {
      warn("omo-senpi kibitzer sidecar abort failed", { cause, error: describe(error) })
    }
  }

  // ---- transitions (every one of these runs under the mutex) -----------------------------------

  function beginTurn(current: Child, turn: Turn, envelope: Envelope): void {
    turn.envelopes.push(envelope)
    current.charsSent += envelope.text.length
    activeTurn = turn
    state = "turn_running"
    armDeadline(turn)
    turn.settled = current.handle.waitForIdle().then(
      (outcome) => serialized(() => settle(turn, outcome)),
      (error: unknown) => serialized(() => settle(turn, {
        status: "error",
        failure: { kind: "child-turn-failed", message: describe(error), cause: error },
      })),
    ).catch((error: unknown) => warn("omo-senpi kibitzer sidecar settlement failed", { wake: turn.wake, error: describe(error) }))
  }

  function newTurn(generation: number, maxItems: number, candidateCount: number): Turn {
    wakeSeq += 1
    accepted = []
    budget = createWakeToolBudget(toolBudget)
    return {
      wake: wakeSeq,
      generation,
      maxItems,
      startedAt: now(),
      accepted,
      budget,
      envelopes: [],
      candidateCount,
      toolStarts: 0,
      toolEnds: 0,
      abort: undefined,
      deadline: undefined,
      model: undefined,
      settled: Promise.resolve(),
    }
  }

  function offerPaths(candidates: readonly RecallCandidate[], wake: number): void {
    for (const candidate of candidates) {
      offered.add(candidate.path)
      offeredAtWake.set(candidate.path, wake)
    }
  }

  /** A fresh child: the carried and buffered events plus the fresh candidates become its first message. */
  async function seed(fresh: readonly RecallCandidate[], maxItems: number): Promise<KibitzerOfferResult> {
    const payload = merge([...carry, payloadOf(stream.peek(), fresh)])
    const wakeText = pendingReseed === undefined
      ? renderKibitzerSeedPrompt(envelopeInput(payload, maxItems, true))
      : renderKibitzerWakePrompt(envelopeInput(payload, maxItems, false))
    const prompt = pendingReseed === undefined
      ? wakeText
      : `${renderKibitzerReseedPrompt({ ...pendingReseed, maxItems, toolBudget })}${wakeText}`
    const generation = generations + 1
    const turn = newTurn(generation, maxItems, payload.candidates.length)
    const tools = options.createTools({
      nudge: { offered, surfaced, maxItems, accepted: () => accepted },
      budget: () => budget,
    })
    let handle: ChildHandle
    try {
      handle = await options.startChild({ sessionId, generation, prompt, tools: tools.tools, maxItems })
    } catch (error) {
      // Nothing was drained and nothing was offered: the events and the candidates wait for the retry.
      report(turn, startFailureEnd(error), [], undefined)
      enterBackoff()
      return { action: "buffered", reason: "backoff" }
    }
    generations = generation
    stream.drain()
    carry = []
    pendingReseed = undefined
    offerPaths(fresh, turn.wake)
    const created: Child = { handle, generation, tools, unsubscribe: handle.subscribe(observe), usageTokens: undefined, charsSent: 0 }
    child = created
    beginTurn(created, turn, { text: prompt, payload, steered: false, consumed: true })
    return { action: "seeded", wake: turn.wake }
  }

  /** The idle child revived: carried payloads (late steers) and the buffered batch in one followUp. */
  async function followUp(current: Child, fresh: readonly RecallCandidate[], maxItems: number): Promise<KibitzerOfferResult> {
    const payload = merge([...carry, payloadOf(stream.drain(), fresh)])
    carry = []
    const text = renderKibitzerWakePrompt(envelopeInput(payload, maxItems, false))
    const turn = newTurn(current.generation, maxItems, payload.candidates.length)
    offerPaths(fresh, turn.wake)
    try {
      await current.handle.followUp(text)
    } catch (error) {
      carry = [payload]
      report(turn, { status: "failed", cause: "child_failed", reason: describe(error) }, [], current)
      disposeChild()
      enterBackoff()
      return { action: "buffered", reason: "backoff" }
    }
    beginTurn(current, turn, { text, payload, steered: false, consumed: true })
    return { action: "followed_up", wake: turn.wake }
  }

  /** The running turn steered: the batch joins the turn, the deadline is re-armed for the new work. */
  async function steer(current: Child, turn: Turn, fresh: readonly RecallCandidate[], maxItems: number): Promise<KibitzerOfferResult> {
    const payload = payloadOf(stream.drain(), fresh)
    const text = renderKibitzerWakePrompt(envelopeInput(payload, maxItems, false))
    offerPaths(fresh, turn.wake)
    turn.candidateCount += fresh.length
    turn.envelopes.push({ text, payload, steered: true, consumed: false })
    current.charsSent += text.length
    armDeadline(turn)
    try {
      await current.handle.steer(text)
    } catch (error) {
      // Left unconsumed on purpose: settlement replays it through the followUp.
      warn("omo-senpi kibitzer sidecar steer failed", { wake: turn.wake, error: describe(error) })
    }
    return { action: "steered", wake: turn.wake }
  }

  async function settle(turn: Turn, outcome: RunnerOutcome): Promise<void> {
    if (activeTurn !== turn || child === undefined) return
    const current = child
    clearDeadline(turn)
    const end = classifyWakeEnd(outcome, turn.abort, turn.accepted)
    const nudges = end.status === "cancelled" ? [] : validated(turn, current)
    if (nudges.length > 0) {
      try {
        await options.deliver(nudges, { wake: turn.wake, generation: turn.generation })
      } catch (error) {
        warn("omo-senpi kibitzer sidecar delivery failed", { wake: turn.wake, error: describe(error) })
      }
      for (const nudge of nudges) {
        delivered.add(nudge.path)
        surfaced.add(nudge.path)
      }
      cooldown.charge()
    }
    // A dead child judged nothing it was sent; a live one may have missed steers that landed late.
    const unread = end.status === "failed" ? turn.envelopes : turn.envelopes.filter((envelope) => envelope.steered && !envelope.consumed)
    carry.push(...unread.map((envelope) => envelope.payload))
    if (end.status === "failed") {
      for (const path of turn.envelopes.flatMap((envelope) => envelope.payload.candidates.map((candidate) => candidate.path))) {
        if (delivered.has(path)) continue
        offered.delete(path)
        offeredAtWake.delete(path)
      }
    }
    activeTurn = undefined
    report(turn, end, nudges, current, outcome.status === "cancelled" ? undefined : outcome.model)
    switch (end.status) {
      case "cancelled":
        disposeChild()
        state = "disposed"
        return
      case "failed":
        disposeChild()
        enterBackoff()
        return
      case "completed":
      case "tool_budget_exceeded":
      case "deadline":
        consecutiveFailures = 0
        if (contextEstimate(current) >= reseedAtTokens) {
          prepareReseed(turn.wake)
          disposeChild()
          state = "reseeding"
          return
        }
        if (carry.length > 0) {
          await followUp(current, [], turn.maxItems)
          return
        }
        state = "idle"
        return
      default:
        end satisfies never
    }
  }

  /** Defence in depth over the closure's call-time checks: the lifetime allowed set minus the ledger. */
  function validated(turn: Turn, current: Child): RecallNudge[] {
    const allowed = new Set<string>([...offered, ...current.tools.searchedPaths])
    return validateNudges(turn.accepted, { candidates: allowed, surfaced, maxItems: turn.maxItems })
  }

  function report(turn: Turn, end: KibitzerWakeEnd, nudges: readonly RecallNudge[], current: Child | undefined, model?: string): void {
    const cursors = turn.envelopes.reduce<{ first: number; last: number } | undefined>((span, envelope) => {
      const range = envelope.payload.cursors
      if (range === undefined) return span
      return span === undefined ? { ...range } : { first: Math.min(span.first, range.first), last: Math.max(span.last, range.last) }
    }, undefined)
    const provenance = model ?? turn.model
    const outcome: KibitzerWakeOutcome = {
      sessionId,
      wake: turn.wake,
      generation: turn.generation,
      status: end.status,
      ...("cause" in end ? { cause: end.cause } : {}),
      ...("reason" in end && end.reason !== undefined ? { reason: end.reason } : {}),
      ...(provenance === undefined ? {} : { model: provenance }),
      nudges,
      candidateCount: turn.candidateCount,
      steered: turn.envelopes.filter((envelope) => envelope.steered).length,
      toolCalls: turn.toolStarts,
      durationMs: Math.max(0, now() - turn.startedAt),
      ...(cursors === undefined ? {} : { cursors }),
      ...(current === undefined ? {} : { contextTokens: contextEstimate(current) }),
      diagnostic: isDiagnosticWakeEnd(end),
    }
    try {
      options.onWake?.(outcome)
    } catch (error) {
      warn("omo-senpi kibitzer sidecar wake report failed", { wake: turn.wake, error: describe(error) })
    }
  }

  /**
   * The replacement child inherits only what a restart would otherwise lose: paths declined through
   * three wake opportunities, paths already delivered, the task line and the last cursor. Every
   * other offered path is forgotten so it may wake the new child again.
   */
  function prepareReseed(wake: number): void {
    const rejected = [...offeredAtWake]
      .filter(([path, at]) => !delivered.has(path) && wake - at + 1 >= KIBITZER_REJECTED_AFTER_WAKES)
      .map(([path]) => path)
    pendingReseed = {
      sessionId,
      lastCursor: stream.lastCursor() ?? 0,
      taskSummary: taskSummary ?? "",
      rejectedPaths: rejected,
      deliveredPaths: [...delivered],
    }
    offered.clear()
    for (const path of rejected) offered.add(path)
    for (const path of delivered) offered.add(path)
    for (const path of [...offeredAtWake.keys()]) if (!offered.has(path)) offeredAtWake.delete(path)
  }

  function enterBackoff(): void {
    const delay = backoffDelayMs(consecutiveFailures, random)
    consecutiveFailures += 1
    state = "backoff"
    clearBackoff()
    backoffTimer = timers.set(() => {
      backoffTimer = undefined
      if (state === "backoff") state = "idle"
    }, delay)
  }

  function clearBackoff(): void {
    if (backoffTimer === undefined) return
    timers.clear(backoffTimer)
    backoffTimer = undefined
  }

  function disposeChild(): void {
    const current = child
    if (current === undefined) return
    child = undefined
    current.unsubscribe()
    try {
      current.handle.dispose()
    } catch (error) {
      warn("omo-senpi kibitzer sidecar dispose failed", { generation: current.generation, error: describe(error) })
    }
  }

  // ---- the public surface ------------------------------------------------------------------------

  function offer(input: KibitzerOfferInput): Promise<KibitzerOfferResult> {
    return serialized(async () => {
      if (state === "disposed") return { action: "buffered", reason: "disposed" }
      for (const path of input.surfaced) surfaced.add(path)
      if (state === "backoff") return { action: "buffered", reason: "backoff" }
      const decision = decideWake({ candidates: input.candidates, offered, surfaced, maxItems: input.maxItems, cooldown })
      if (!decision.wake) return { action: "buffered", reason: decision.reason }
      if (input.taskSummary !== undefined) taskSummary = input.taskSummary
      const current = child
      switch (state) {
        case "turn_running": {
          const turn = activeTurn
          if (turn === undefined || current === undefined) throw new Error("kibitzer sidecar invariant broken: turn_running without a live turn")
          return steer(current, turn, decision.candidates, input.maxItems)
        }
        case "idle":
          return current === undefined ? seed(decision.candidates, input.maxItems) : followUp(current, decision.candidates, input.maxItems)
        case "reseeding":
          return seed(decision.candidates, input.maxItems)
        default:
          return state satisfies never
      }
    })
  }

  async function shutdown(): Promise<void> {
    await serialized(async () => {
      if (state === "disposed") return
      clearBackoff()
      const turn = activeTurn
      const current = child
      if (turn !== undefined && current !== undefined) {
        turn.abort = "shutdown"
        clearDeadline(turn)
        await abortHandle(current.handle, "shutdown")
        // Settle inline: shutdown must not depend on the aborted turn ever reporting back.
        await settle(turn, { status: "cancelled" })
      }
      disposeChild()
      activeTurn = undefined
      pendingReseed = undefined
      carry = []
      state = "disposed"
    })
  }

  function rememberTask(payload: unknown): void {
    if (taskSummary !== undefined) return
    const text = typeof payload === "string" ? payload : isRecord(payload) && typeof payload.prompt === "string" ? payload.prompt : undefined
    const line = text?.replace(/\s+/g, " ").trim()
    if (line === undefined || line.length === 0) return
    taskSummary = line.length > TASK_SUMMARY_HEAD_CHARS ? line.slice(0, TASK_SUMMARY_HEAD_CHARS) : line
  }

  return {
    sessionId,
    state: () => state,
    events: {
      onPrompt(payload, branch): boolean {
        if (state === "disposed") return false
        rememberTask(payload)
        return stream.onPrompt(payload, branch)
      },
      onToolCall: (payload, branch) => state !== "disposed" && stream.onToolCall(payload, branch),
      onToolResult: (payload, branch) => state !== "disposed" && stream.onToolResult(payload, branch),
      size: () => stream.size(),
      lastCursor: () => stream.lastCursor(),
    },
    offer,
    shutdown,
    whenIdle,
  }
}

const RUNTIME_TIMERS: KibitzerSidecarTimers = {
  set(callback, ms) {
    const handle = setTimeout(callback, ms)
    handle.unref?.()
    return handle
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

function sidecarEvent(event: KibitzerEvent): KibitzerSidecarEvent {
  switch (event.kind) {
    case "prompt":
    case "assistant":
      return { cursor: event.cursor, kind: event.kind, text: event.body }
    case "tool_call":
      return { cursor: event.cursor, kind: event.kind, ...(event.tool === undefined ? {} : { tool: event.tool }), args: event.body }
    case "tool_result":
      return { cursor: event.cursor, kind: event.kind, ...(event.tool === undefined ? {} : { tool: event.tool }), resultHead: event.body }
    default:
      return event.kind satisfies never
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
