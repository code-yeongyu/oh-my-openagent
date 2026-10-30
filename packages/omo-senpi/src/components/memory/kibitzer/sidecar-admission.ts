// The machine-wide wake lease around one provider turn. A seed or followUp takes one lease before
// it starts and holds it until the turn settles; a steer joins the running turn under that same
// lease. Waiting is bounded and abortable (shutdown cuts it short); a lease is handed back exactly
// once on whichever exit comes first; a wait that yields no lease is turned into the offer result.

import type { KibitzerOfferResult } from "./sidecar-contract"
import { describe, type SidecarCore, type Turn } from "./sidecar-core"
import { startFailureEnd } from "./sidecar-outcome"
import type { SidecarRecovery } from "./sidecar-recovery"
import type { TurnLifecycle } from "./sidecar-turn"
import type { KibitzerWakeAdmission } from "./wake-slot"

export type Admission = KibitzerWakeAdmission | { readonly status: "error"; readonly error: unknown }

export interface SidecarAdmission {
  /** Waits (bounded) for a machine slot; shutdown aborts the wait through `core.admission`. */
  admit(): Promise<Admission>
  /** Idempotent: the first caller on any exit path hands the slot back, later ones find nothing to do. */
  releaseLease(turn: Turn): Promise<void>
  /** An admission that yielded no lease, turned into the offer result; an error is a start failure. */
  refused(admission: Exclude<Admission, { status: "acquired" }>, generation: number, maxItems: number, candidateCount: number): KibitzerOfferResult
}

export function createAdmission(core: SidecarCore, turns: TurnLifecycle, recovery: SidecarRecovery): SidecarAdmission {
  async function admit(): Promise<Admission> {
    if (core.closing) return { status: "aborted" }
    const controller = new AbortController()
    core.admission = controller
    try {
      return await core.options.wakeSlot.acquire(controller.signal)
    } catch (error) {
      return { status: "error", error }
    } finally {
      core.admission = undefined
    }
  }

  async function releaseLease(turn: Turn): Promise<void> {
    const lease = turn.lease
    if (lease === undefined) return
    turn.lease = undefined
    try {
      if (!(await lease.release())) core.warn("omo-senpi kibitzer sidecar wake lease was already gone", { wake: turn.wake, slot: lease.slot })
    } catch (error) {
      core.warn("omo-senpi kibitzer sidecar wake lease release failed", { wake: turn.wake, slot: lease.slot, error: describe(error) })
    }
  }

  function refused(admission: Exclude<Admission, { status: "acquired" }>, generation: number, maxItems: number, candidateCount: number): KibitzerOfferResult {
    switch (admission.status) {
      case "busy":
        return { action: "buffered", reason: "slot_busy" }
      case "aborted":
        return { action: "buffered", reason: "disposed" }
      case "error": {
        const turn = turns.newTurn(generation, maxItems, candidateCount)
        turns.report(turn, startFailureEnd(new Error(`wake admission failed: ${describe(admission.error)}`)), [], undefined)
        recovery.enterBackoff()
        return { action: "buffered", reason: "backoff" }
      }
      default:
        return admission satisfies never
    }
  }

  return { admit, releaseLease, refused }
}
