// The transitions of one wake, every one of them run under the per-session mutex: `seed` starts a
// fresh child on the carried and buffered events, `followUp` revives the idle child, `steer` joins
// the running turn, and `settle` closes the turn - re-validating and delivering nudges, carrying
// unread envelopes forward, and choosing what the sidecar becomes next (idle, reseeding, backoff,
// or disposed after a shutdown).

import type { RecallCandidate, RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildHandle, RunnerOutcome } from "@oh-my-opencode/senpi-task"

import type { SidecarAdmission } from "./sidecar-admission"
import type { KibitzerOfferResult } from "./sidecar-contract"
import { describe, type Child, type Envelope, type SidecarCore, type Turn } from "./sidecar-core"
import { envelopeInput, merge, payloadOf } from "./sidecar-envelope"
import { classifyWakeEnd, startFailureEnd } from "./sidecar-outcome"
import { renderKibitzerReseedPrompt, renderKibitzerSeedPrompt, renderKibitzerWakePrompt } from "./sidecar-prompt"
import type { SidecarRecovery } from "./sidecar-recovery"
import type { TurnLifecycle } from "./sidecar-turn"

export interface WakeTransitions {
  /** A fresh child: the carried and buffered events plus the fresh candidates become its first message. */
  seed(fresh: readonly RecallCandidate[], maxItems: number): Promise<KibitzerOfferResult>
  /** The idle child revived: carried payloads (late steers) and the buffered batch in one followUp. */
  followUp(current: Child, fresh: readonly RecallCandidate[], maxItems: number): Promise<KibitzerOfferResult>
  /** The running turn steered: the batch joins the turn, the deadline is re-armed for the new work. */
  steer(current: Child, turn: Turn, fresh: readonly RecallCandidate[], maxItems: number): Promise<KibitzerOfferResult>
  /** The turn is over: lease back, nudges validated and delivered, unread envelopes carried, next state chosen. */
  settle(turn: Turn, outcome: RunnerOutcome): Promise<void>
}

export function createWakeTransitions(core: SidecarCore, turns: TurnLifecycle, admission: SidecarAdmission, recovery: SidecarRecovery): WakeTransitions {
  function beginTurn(current: Child, turn: Turn, envelope: Envelope): void {
    turn.envelopes.push(envelope)
    current.charsSent += envelope.text.length
    core.activeTurn = turn
    core.state = "turn_running"
    turns.armDeadline(turn)
    turn.settled = current.handle.waitForIdle().then(
      (outcome) => core.serialized(() => settle(turn, outcome)),
      (error: unknown) => core.serialized(() => settle(turn, {
        status: "error",
        failure: { kind: "child-turn-failed", message: describe(error), cause: error },
      })),
    ).catch((error: unknown) => core.warn("omo-senpi kibitzer sidecar settlement failed", { wake: turn.wake, error: describe(error) }))
  }

  async function seed(fresh: readonly RecallCandidate[], maxItems: number): Promise<KibitzerOfferResult> {
    const admitted = await admission.admit()
    if (admitted.status !== "acquired") return admission.refused(admitted, core.generations + 1, maxItems, fresh.length)
    // Cut the payload here, as followUp does: a hook captured while the child is starting opens the
    // next batch instead of being drained unread once the child exists.
    const payload = merge([...core.carry, payloadOf(core.stream.drain(), fresh)])
    core.carry = []
    const wakeText = core.pendingReseed === undefined
      ? renderKibitzerSeedPrompt(envelopeInput(core, payload, maxItems, true))
      : renderKibitzerWakePrompt(envelopeInput(core, payload, maxItems, false))
    const prompt = core.pendingReseed === undefined
      ? wakeText
      : `${renderKibitzerReseedPrompt({ ...core.pendingReseed, maxItems, toolBudget: core.toolBudget })}${wakeText}`
    const generation = core.generations + 1
    const turn = turns.newTurn(generation, maxItems, payload.candidates.length)
    turn.lease = admitted.lease
    turn.slotWaitMs = admitted.waitedMs
    const tools = core.options.createTools({
      nudge: { offered: core.offered, surfaced: core.surfaced, maxItems, accepted: () => core.accepted },
      budget: () => core.budget,
    })
    let handle: ChildHandle
    try {
      handle = await core.options.startChild({ sessionId: core.sessionId, generation, prompt, tools: tools.tools, maxItems })
    } catch (error) {
      // No child read the envelope and nothing was offered: its events and candidates ride the retry.
      core.carry = [payload]
      await admission.releaseLease(turn)
      turns.report(turn, startFailureEnd(error), [], undefined)
      recovery.enterBackoff()
      return { action: "buffered", reason: "backoff" }
    }
    core.generations = generation
    core.pendingReseed = undefined
    turns.offerPaths(fresh, turn.wake)
    const created: Child = { handle, generation, tools, unsubscribe: handle.subscribe(turns.observe), usageTokens: undefined, charsSent: 0 }
    core.child = created
    beginTurn(created, turn, { text: prompt, payload, steered: false, consumed: true })
    return { action: "seeded", wake: turn.wake }
  }

  async function followUp(current: Child, fresh: readonly RecallCandidate[], maxItems: number): Promise<KibitzerOfferResult> {
    const admitted = await admission.admit()
    if (admitted.status !== "acquired") return admission.refused(admitted, current.generation, maxItems, fresh.length)
    const payload = merge([...core.carry, payloadOf(core.stream.drain(), fresh)])
    core.carry = []
    const text = renderKibitzerWakePrompt(envelopeInput(core, payload, maxItems, false))
    const turn = turns.newTurn(current.generation, maxItems, payload.candidates.length)
    turn.lease = admitted.lease
    turn.slotWaitMs = admitted.waitedMs
    turns.offerPaths(fresh, turn.wake)
    try {
      await current.handle.followUp(text)
    } catch (error) {
      core.carry = [payload]
      await admission.releaseLease(turn)
      turns.report(turn, { status: "failed", cause: "child_failed", reason: describe(error) }, [], current)
      recovery.disposeChild()
      recovery.enterBackoff()
      return { action: "buffered", reason: "backoff" }
    }
    beginTurn(current, turn, { text, payload, steered: false, consumed: true })
    return { action: "followed_up", wake: turn.wake }
  }

  async function steer(current: Child, turn: Turn, fresh: readonly RecallCandidate[], maxItems: number): Promise<KibitzerOfferResult> {
    const payload = payloadOf(core.stream.drain(), fresh)
    const text = renderKibitzerWakePrompt(envelopeInput(core, payload, maxItems, false))
    turns.offerPaths(fresh, turn.wake)
    turn.candidateCount += fresh.length
    turn.envelopes.push({ text, payload, steered: true, consumed: false })
    current.charsSent += text.length
    turns.armDeadline(turn)
    try {
      await current.handle.steer(text)
    } catch (error) {
      // Left unconsumed on purpose: settlement replays it through the followUp.
      core.warn("omo-senpi kibitzer sidecar steer failed", { wake: turn.wake, error: describe(error) })
    }
    return { action: "steered", wake: turn.wake }
  }

  async function settle(turn: Turn, outcome: RunnerOutcome): Promise<void> {
    // The provider turn is over whatever happens next: the machine slot goes back first.
    await admission.releaseLease(turn)
    if (core.activeTurn !== turn || core.child === undefined) return
    const current = core.child
    turns.clearDeadline(turn)
    const end = classifyWakeEnd(outcome, turn.abort, turn.accepted)
    const nudges: RecallNudge[] = end.status === "cancelled" ? [] : turns.validated(turn, current)
    if (nudges.length > 0) {
      try {
        await core.options.deliver(nudges, { wake: turn.wake, generation: turn.generation })
      } catch (error) {
        core.warn("omo-senpi kibitzer sidecar delivery failed", { wake: turn.wake, error: describe(error) })
      }
      for (const nudge of nudges) {
        core.delivered.add(nudge.path)
        core.surfaced.add(nudge.path)
      }
      core.cooldown.charge()
    }
    // A dead child judged nothing it was sent; a live one may have missed steers that landed late.
    const unread = end.status === "failed" ? turn.envelopes : turn.envelopes.filter((envelope) => envelope.steered && !envelope.consumed)
    core.carry.push(...unread.map((envelope) => envelope.payload))
    if (end.status === "failed") {
      for (const path of turn.envelopes.flatMap((envelope) => envelope.payload.candidates.map((candidate) => candidate.path))) {
        if (core.delivered.has(path)) continue
        core.offered.delete(path)
        core.offeredAtWake.delete(path)
      }
    }
    core.activeTurn = undefined
    turns.report(turn, end, nudges, current, outcome.status === "cancelled" ? undefined : outcome.model)
    switch (end.status) {
      case "cancelled":
        recovery.disposeChild()
        core.state = "disposed"
        return
      case "failed":
        recovery.disposeChild()
        recovery.enterBackoff()
        return
      case "completed":
      case "tool_budget_exceeded":
      case "deadline":
        core.consecutiveFailures = 0
        if (turns.contextEstimate(current) >= core.reseedAtTokens) {
          recovery.prepareReseed(turn.wake)
          recovery.disposeChild()
          core.state = "reseeding"
          return
        }
        if (core.carry.length > 0) {
          await followUp(current, [], turn.maxItems)
          return
        }
        core.state = "idle"
        return
      default:
        end satisfies never
    }
  }

  return { seed, followUp, steer, settle }
}
