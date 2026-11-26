import type { GatewayAdmissionKind, SessionRuntimePort } from "./adapter"
import { decideDelivery, effectiveLaneOf } from "./decision"
import { deliverySender, renderDeliveryDisplayText, renderDeliveryText } from "./provenance"
import type { GatewayStore } from "./store"
import type { DeliveryRow, EffectiveLane, ProcessIdentity } from "./types"

export type AdmitStep = "next" | "stop"

export type ClaimedAdmitter = (
  row: DeliveryRow,
  claimedRow: DeliveryRow,
  intent: { readonly joinsStart?: true },
) => Promise<AdmitStep>

type AdmitterDeps = {
  readonly store: GatewayStore
  readonly runtime: SessionRuntimePort
  readonly durableId: string
  readonly self: ProcessIdentity
  readonly now: () => number
  readonly admitted: { delivery_id: string; kind: GatewayAdmissionKind }[]
  readonly held: Map<string, number>
  readonly noticeQueued: (row: DeliveryRow) => void
  readonly log?: (line: string) => void
  readonly onAdmitted?: (deliveryId: string, kind: "started" | "steered" | "queued") => void
  readonly afterAdmit?: (row: DeliveryRow, kind: string) => void
}

/**
 * Admits one claimed row; `stop` ends the pass. The lane is decided again here, from the session's phase and turn read
 * in the same synchronous step as the admission, so nothing can change between the decision and the engine call: the
 * decision made before the claim's await is only the lane the claim records. A row that joins a held-back start, while
 * the session is still idle, goes to the steering queue without starting it, so the start's run takes it before its
 * first provider request (steer-all). An auto row the engine still answers `turn_conflict` waits for the next pass; only
 * an explicit steer, which names its turn, is refused.
 */
export function createClaimedAdmitter(deps: AdmitterDeps): ClaimedAdmitter {
  const { store, runtime, self, now } = deps
  const record = (row: DeliveryRow, outcome: Parameters<GatewayStore["recordOutcome"]>[0]["outcome"]) =>
    store.recordOutcome({ now: now(), delivery_id: row.delivery_id, self, outcome })

  return async (row, claimedRow, intent) => {
    const decision = decideDelivery(
      runtime.phase(),
      row.mode_requested,
      row.expected_turn_id,
      runtime.admissionGate().turn_epoch,
    )
    if (decision.kind !== "admit") {
      const reason = decision.kind === "refuse" ? decision.reason : "turn_conflict"
      await record(row, { kind: "refused", reason })
      deps.admitted.push({ delivery_id: row.delivery_id, kind: reason })
      return "next"
    }
    // Only a row the live decision would start joins the held start: a turn-pinned steer or anything else keeps its own lane.
    const joins = intent.joinsStart === true && decision.expect === "started"
    const lane: EffectiveLane = joins ? "steer" : effectiveLaneOf(decision)
    // A row taken in from another device is admitted under the engine's ledger key with the sender's text as written,
    // so the engine's own dedupe also covers the same delivery arriving live (#13037, design 5.5).
    const ledgerId = claimedRow.ledger_id ?? null
    const engineId = ledgerId ?? row.delivery_id
    const shown = { ...claimedRow, mode_effective: lane }
    let result: ReturnType<SessionRuntimePort["admitExternalMessage"]>
    try {
      result = runtime.admitExternalMessage({
        delivery_id: engineId,
        text: ledgerId === null ? renderDeliveryText(shown) : (claimedRow.verbatim_text ?? claimedRow.body),
        sender: deliverySender(claimedRow),
        display_text:
          ledgerId === null ? renderDeliveryDisplayText(shown) : (claimedRow.verbatim_display_text ?? claimedRow.body),
        deliverAs: joins ? "steer" : decision.deliverAs,
        ...(joins || decision.expected_turn_id === undefined ? {} : { expected_turn_id: decision.expected_turn_id }),
        ...(joins ? { whenIdle: "queue" as const } : {}),
      })
    } catch (error) {
      await record(row, { kind: "requeue" })
      deps.log?.(`admission closed for ${deps.durableId}: ${error instanceof Error ? error.message : String(error)}`)
      return "stop"
    }
    deps.afterAdmit?.(claimedRow, result.kind)
    if (result.kind === "held_draft") {
      await record(row, { kind: "requeue" })
      deps.held.set(row.delivery_id, runtime.admissionGate().editor_revision)
      deps.noticeQueued(row)
      deps.admitted.push({ delivery_id: row.delivery_id, kind: "held_draft" })
      return "stop"
    }
    if (result.kind === "turn_conflict") {
      await record(
        row,
        row.mode_requested === "auto" ? { kind: "requeue" } : { kind: "refused", reason: "turn_conflict" },
      )
      if (row.mode_requested !== "auto") deps.admitted.push({ delivery_id: row.delivery_id, kind: "turn_conflict" })
      return "next"
    }
    // A row queued to join the start runs in that start's turn, which is what a steered row tells its sender.
    const kind = joins && result.kind === "queued" ? "steered" : result.kind
    if (kind === "queued") deps.noticeQueued(claimedRow)
    const written = result.kind === "already_admitted" && runtime.listAdmittedDeliveries().emitted.includes(engineId)
    await record(row, {
      kind: written ? "applied" : "admitted",
      admission_kind: kind,
      turn_epoch: result.turn_epoch,
      mode_effective: lane,
      // A delivery queued while the session waits on a question waits on that approval (#13014), as the relay leg reports it.
      ...(kind === "queued" && runtime.phase() === "waiting_question" ? { wait_kind: "approval" as const } : {}),
    })
    deps.admitted.push({ delivery_id: row.delivery_id, kind })
    if (kind === "started" || kind === "steered" || kind === "queued") deps.onAdmitted?.(row.delivery_id, kind)
    return "next"
  }
}
