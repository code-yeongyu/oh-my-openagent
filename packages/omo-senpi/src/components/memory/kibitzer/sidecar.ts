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
// has not surfaced. Before that turn starts, the sidecar takes one machine-wide wake lease (the
// memory-core `recall-wake` domain: FIFO, `max_concurrent_wakes` slots, bounded wait) and holds it
// until the turn settles; a wake that finds every slot busy buffers as `slot_busy` and the next hook
// tries again - nothing polls in between. An idle child is revived with `followUp` (a fresh tracked
// turn); a running turn is `steer`ed (senpi's default steering mode drains every queued steer at
// the next boundary) and needs no second lease. The child's own event stream is the sidecar's
// instrument: it counts tool calls for the per-wake budget, confirms which steers reached the
// transcript, and reads provider usage for the context estimate. Aborting for budget, deadline or
// shutdown is never a failure; a failed child enters exponential backoff and keeps every buffered
// event for the child that follows. The lease is released on every one of those exits.
//
// This module is the public surface and the composition root; the machinery is split by
// responsibility: `sidecar-contract` (defaults and types), `sidecar-core` (the shared state and
// the mutex), `sidecar-envelope` (payloads to envelope input), `sidecar-turn` (one tracked turn:
// budget, consumption, usage, deadline, abort, report), `sidecar-admission` (the machine-wide
// lease), `sidecar-recovery` (reseed state, backoff, disposal) and `sidecar-wake` (seed / followUp /
// steer / settle).

import { createAdmission } from "./sidecar-admission"
import type { KibitzerOfferInput, KibitzerOfferResult, KibitzerSidecar, KibitzerSidecarOptions } from "./sidecar-contract"
import { createSidecarCore, isRecord } from "./sidecar-core"
import { createRecovery } from "./sidecar-recovery"
import { createTurnLifecycle } from "./sidecar-turn"
import { createWakeTransitions } from "./sidecar-wake"
import { decideWake } from "./wake-policy"

export {
  KIBITZER_REJECTED_AFTER_WAKES,
  KIBITZER_RESEED_FRACTION,
  KIBITZER_SIDECAR_MAX_TOKENS,
  KIBITZER_WAKE_DEADLINE_MS,
  KIBITZER_WAKE_TOOL_BUDGET,
} from "./sidecar-contract"
export type {
  KibitzerBufferedReason,
  KibitzerOfferInput,
  KibitzerOfferResult,
  KibitzerSidecar,
  KibitzerSidecarChildInput,
  KibitzerSidecarOptions,
  KibitzerSidecarState,
  KibitzerSidecarTimers,
  KibitzerSidecarToolBinding,
} from "./sidecar-contract"

const TASK_SUMMARY_HEAD_CHARS = 200

export function createKibitzerSidecar(options: KibitzerSidecarOptions): KibitzerSidecar {
  const core = createSidecarCore(options)
  const turns = createTurnLifecycle(core)
  const recovery = createRecovery(core)
  const admission = createAdmission(core, turns, recovery)
  const wake = createWakeTransitions(core, turns, admission, recovery)

  function offer(input: KibitzerOfferInput): Promise<KibitzerOfferResult> {
    return core.serialized(async () => {
      if (core.closing || core.state === "disposed") return { action: "buffered", reason: "disposed" }
      for (const path of input.surfaced) core.surfaced.add(path)
      if (core.state === "backoff") return { action: "buffered", reason: "backoff" }
      const decision = decideWake({ candidates: input.candidates, offered: core.offered, surfaced: core.surfaced, maxItems: input.maxItems, cooldown: core.cooldown })
      if (!decision.wake) return { action: "buffered", reason: decision.reason }
      if (input.taskSummary !== undefined) core.taskSummary = input.taskSummary
      const current = core.child
      switch (core.state) {
        case "turn_running": {
          const turn = core.activeTurn
          if (turn === undefined || current === undefined) throw new Error("kibitzer sidecar invariant broken: turn_running without a live turn")
          return wake.steer(current, turn, decision.candidates, input.maxItems)
        }
        case "idle":
          return current === undefined ? wake.seed(decision.candidates, input.maxItems) : wake.followUp(current, decision.candidates, input.maxItems)
        case "reseeding":
          return wake.seed(decision.candidates, input.maxItems)
        default:
          return core.state satisfies never
      }
    })
  }

  async function shutdown(): Promise<void> {
    // Before the mutex: an offer parked on the wake lease must let go now, not after its bounded wait.
    core.closing = true
    core.admission?.abort()
    await core.serialized(async () => {
      if (core.state === "disposed") return
      recovery.clearBackoff()
      const turn = core.activeTurn
      const current = core.child
      if (turn !== undefined && current !== undefined) {
        turn.abort = "shutdown"
        turns.clearDeadline(turn)
        await turns.abortHandle(current.handle, "shutdown")
        // Settle inline: shutdown must not depend on the aborted turn ever reporting back.
        await wake.settle(turn, { status: "cancelled" })
      }
      recovery.disposeChild()
      core.activeTurn = undefined
      core.pendingReseed = undefined
      core.carry = []
      core.state = "disposed"
    })
  }

  function rememberTask(payload: unknown): void {
    if (core.taskSummary !== undefined) return
    const text = typeof payload === "string" ? payload : isRecord(payload) && typeof payload.prompt === "string" ? payload.prompt : undefined
    const line = text?.replace(/\s+/g, " ").trim()
    if (line === undefined || line.length === 0) return
    core.taskSummary = line.length > TASK_SUMMARY_HEAD_CHARS ? line.slice(0, TASK_SUMMARY_HEAD_CHARS) : line
  }

  return {
    sessionId: core.sessionId,
    state: () => core.state,
    events: {
      onPrompt(payload, branch): boolean {
        if (core.state === "disposed") return false
        rememberTask(payload)
        return core.stream.onPrompt(payload, branch)
      },
      onToolCall: (payload, branch) => core.state !== "disposed" && core.stream.onToolCall(payload, branch),
      onToolResult: (payload, branch) => core.state !== "disposed" && core.stream.onToolResult(payload, branch),
      size: () => core.stream.size(),
      lastCursor: () => core.stream.lastCursor(),
    },
    offer,
    shutdown,
    whenIdle: core.whenIdle,
  }
}
