import type { AgentSessionEvent } from "@code-yeongyu/senpi"

import type { PendingWorkEvidence } from "../pending-async-work"
import { createTurnAsyncWork } from "./turn-async-work"
import { createTurnSettlement, type TurnSettlement, type TurnSettlementInput } from "./turn-settlement"
import { createTurnWakeSources } from "./turn-wake-sources"

export type TurnTrackingInput = Omit<TurnSettlementInput, "wakeSourcesLive" | "pendingAsyncWork">

export type TurnTracking = {
  readonly settlement: TurnSettlement
  readonly observe: (event: AgentSessionEvent) => void
  readonly observeState: (state: unknown) => void
  readonly resetTurn: () => void
  // What the engine has said about the child's own async work, for a turn that ends for good (omo#10487).
  readonly evidence: () => PendingWorkEvidence
}

/**
 * The turn-end bookkeeping both RPC runners share: the settlement, the session-scoped wake sources
 * that hold a terminal error (senpi#3262), and the child's own pending async work that holds a
 * completed outcome (omo#10487). Every settle probe also refreshes the pending work from the
 * lifecycle its `get_state` answer carries, so the hold decides on the engine's current word.
 */
export function createTurnTracking(input: TurnTrackingInput): TurnTracking {
  const wakeSources = createTurnWakeSources()
  const asyncWork = createTurnAsyncWork(wakeSources)
  const probe = input.probe
  const settlement = createTurnSettlement({
    ...input,
    ...(probe === undefined
      ? {}
      : {
          probe: async () => {
            const state = await probe()
            asyncWork.observeState(state)
            return state
          },
        }),
    wakeSourcesLive: () => wakeSources.hasLiveWakeSources(),
    pendingAsyncWork: asyncWork.pending,
    answerWork: asyncWork.answerWork,
  })
  return {
    settlement,
    observe: (event) => {
      // Goal/monitor wake records ride the SAME stream as agent events: a raw `extension_event`
      // reaches this funnel on both runners; a record naming nothing tracked is ignored. The ledger
      // takes it first, so the pending-work window samples the ledger it just updated.
      const extension = (event as { readonly type?: string }).type === "extension_event"
      if (extension) wakeSources.observe(event)
      asyncWork.observe(event)
      settlement.observe(event)
      if (extension) settlement.reconfirmHeld()
    },
    observeState: asyncWork.observeState,
    resetTurn: wakeSources.resetTurn,
    evidence: asyncWork.evidence,
  }
}
