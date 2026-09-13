// One wake as a tracked turn: its record, the child's own event stream read as the sidecar's
// instrument (tool calls against the budget, which steers reached the transcript, provider usage
// for the context estimate), the deadline timer, the sidecar's own abort, and the outcome report.
// Starting and settling a turn is `sidecar-wake`'s business; this module never changes `state`.

import { validateNudges, type RecallCandidate, type RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildHandle, ChildSessionEvent } from "@oh-my-opencode/senpi-task"

import { describe, isRecord, numberOf, textOf, type Child, type SidecarCore, type Turn } from "./sidecar-core"
import { isDiagnosticWakeEnd, type KibitzerWakeAbort, type KibitzerWakeEnd, type KibitzerWakeOutcome } from "./sidecar-outcome"
import { createWakeToolBudget } from "./tools"

export interface TurnLifecycle {
  /** The next wake number with fresh accepted/budget slots; not yet the active turn. */
  newTurn(generation: number, maxItems: number, candidateCount: number): Turn
  /** Marks the candidates as offered to this sidecar lifetime, at the given wake. */
  offerPaths(candidates: readonly RecallCandidate[], wake: number): void
  /** The child's subscription: budget, consumption, usage. */
  observe(event: ChildSessionEvent): void
  /** `usage.input + usage.cacheRead` of the newest assistant message, char/4 fallback. */
  contextEstimate(current: Child): number
  armDeadline(turn: Turn): void
  clearDeadline(turn: Turn): void
  /** The sidecar's own abort: recorded first so settlement reads the cause, not the engine's `cancelled`. */
  abortTurn(turn: Turn, cause: KibitzerWakeAbort): Promise<void>
  abortHandle(handle: ChildHandle, cause: string): Promise<void>
  /** Defence in depth over the closure's call-time checks: the lifetime allowed set minus the ledger. */
  validated(turn: Turn, current: Child): RecallNudge[]
  /** The closed `KibitzerWakeOutcome` for a settled wake, handed to `onWake`. */
  report(turn: Turn, end: KibitzerWakeEnd, nudges: readonly RecallNudge[], current: Child | undefined, model?: string): void
}

export function createTurnLifecycle(core: SidecarCore): TurnLifecycle {
  function newTurn(generation: number, maxItems: number, candidateCount: number): Turn {
    core.wakeSeq += 1
    core.accepted = []
    core.budget = createWakeToolBudget(core.toolBudget)
    return {
      wake: core.wakeSeq,
      generation,
      maxItems,
      startedAt: core.now(),
      accepted: core.accepted,
      budget: core.budget,
      envelopes: [],
      lease: undefined,
      slotWaitMs: 0,
      candidateCount,
      toolStarts: 0,
      toolEnds: 0,
      abort: undefined,
      deadline: undefined,
      model: undefined,
      usage: undefined,
      settled: Promise.resolve(),
    }
  }

  function offerPaths(candidates: readonly RecallCandidate[], wake: number): void {
    for (const candidate of candidates) {
      core.offered.add(candidate.path)
      core.offeredAtWake.set(candidate.path, wake)
    }
  }

  // ---- the child's event stream: budget, consumption, usage ------------------------------------

  function observe(event: ChildSessionEvent): void {
    const turn = core.activeTurn
    if (turn === undefined) return
    switch (event.type) {
      case "tool_execution_start":
        turn.toolStarts += 1
        // A parallel batch can start the call past the budget before the eighth one ends.
        if (turn.toolStarts > core.toolBudget) void abortTurn(turn, "tool_budget")
        return
      case "tool_execution_end":
        turn.toolEnds += 1
        if (turn.toolEnds >= core.toolBudget) void abortTurn(turn, "tool_budget")
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
    if (!isRecord(message.usage)) return
    const input = numberOf(message.usage.input)
    const output = numberOf(message.usage.output)
    const cacheRead = numberOf(message.usage.cacheRead)
    const cacheWrite = numberOf(message.usage.cacheWrite)
    if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) return
    const previous = turn.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    turn.usage = {
      input: previous.input + (input ?? 0),
      output: previous.output + (output ?? 0),
      cacheRead: previous.cacheRead + (cacheRead ?? 0),
      cacheWrite: previous.cacheWrite + (cacheWrite ?? 0),
    }
    if (core.child === undefined || (input === undefined && cacheRead === undefined)) return
    core.child.usageTokens = (input ?? 0) + (cacheRead ?? 0)
  }

  function contextEstimate(current: Child): number {
    return current.usageTokens ?? Math.ceil(current.charsSent / 4)
  }

  // ---- timers and the sidecar's own abort --------------------------------------------------------

  function armDeadline(turn: Turn): void {
    clearDeadline(turn)
    turn.deadline = core.timers.set(() => {
      void abortTurn(turn, "deadline")
    }, core.wakeDeadlineMs)
  }

  function clearDeadline(turn: Turn): void {
    if (turn.deadline === undefined) return
    core.timers.clear(turn.deadline)
    turn.deadline = undefined
  }

  function abortTurn(turn: Turn, cause: KibitzerWakeAbort): Promise<void> {
    return core.serialized(async () => {
      if (core.activeTurn !== turn || turn.abort !== undefined || core.child === undefined) return
      turn.abort = cause
      clearDeadline(turn)
      await abortHandle(core.child.handle, cause)
    })
  }

  async function abortHandle(handle: ChildHandle, cause: string): Promise<void> {
    try {
      await handle.abort()
    } catch (error) {
      core.warn("omo-senpi kibitzer sidecar abort failed", { cause, error: describe(error) })
    }
  }

  // ---- the outcome ---------------------------------------------------------------------------------

  function validated(turn: Turn, current: Child): RecallNudge[] {
    const allowed = new Set<string>([...core.offered, ...current.tools.searchedPaths])
    return validateNudges(turn.accepted, { candidates: allowed, surfaced: core.surfaced, maxItems: turn.maxItems })
  }

  function report(turn: Turn, end: KibitzerWakeEnd, nudges: readonly RecallNudge[], current: Child | undefined, model?: string): void {
    const cursors = turn.envelopes.reduce<{ first: number; last: number } | undefined>((span, envelope) => {
      const range = envelope.payload.cursors
      if (range === undefined) return span
      return span === undefined ? { ...range } : { first: Math.min(span.first, range.first), last: Math.max(span.last, range.last) }
    }, undefined)
    const provenance = model ?? turn.model
    const outcome: KibitzerWakeOutcome = {
      sessionId: core.sessionId,
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
      durationMs: Math.max(0, core.now() - turn.startedAt),
      slotWaitMs: turn.slotWaitMs,
      ...(cursors === undefined ? {} : { cursors }),
      ...(current === undefined ? {} : { contextTokens: contextEstimate(current) }),
      ...(turn.usage === undefined ? {} : { usage: turn.usage }),
      diagnostic: isDiagnosticWakeEnd(end),
    }
    try {
      core.options.onWake?.(outcome)
    } catch (error) {
      core.warn("omo-senpi kibitzer sidecar wake report failed", { wake: turn.wake, error: describe(error) })
    }
  }

  return { newTurn, offerPaths, observe, contextEstimate, armDeadline, clearDeadline, abortTurn, abortHandle, validated, report }
}
