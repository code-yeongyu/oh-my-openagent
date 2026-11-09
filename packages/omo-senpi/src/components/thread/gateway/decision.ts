import type { RuntimePhase } from "./adapter"
import type { GatewayDeliveryMode } from "./types"

export type TargetState = RuntimePhase | "offline"

export type DeliveryDecision =
  | { readonly kind: "admit"; readonly deliverAs: "steer" | "followUp"; readonly expected_turn_id?: number; readonly expect: "started" | "queued" | "steered" }
  | { readonly kind: "refuse"; readonly reason: "not_steerable" | "turn_conflict" }
  | { readonly kind: "queued_offline" }

/**
 * The 15-cell table {idle, mid_turn, waiting_question, compacting, offline} x {auto, steer,
 * follow_up}. `auto`, the default, steers every busy target at the turn epoch read in the same
 * drain pass (#12914: a steer is an enqueue into the turn's steering queue, consumed at its next
 * tool boundary, which senpi admits in every busy phase); only `follow_up` waits behind the
 * running turn. An explicit `steer` is the caller's "only while it is still that turn": it needs
 * the epoch the caller observed and refuses idle, compacting and question-waiting targets as
 * `not_steerable` (question answers never travel through a delivery). `turnEpoch` is `null` only
 * on the sender's offline pre-check; a busy receiver always reads one, so the null arm of `auto`
 * is typing, not policy.
 */
export function decideDelivery(state: TargetState, mode: GatewayDeliveryMode, expectedTurnId: number | null, turnEpoch: number | null): DeliveryDecision {
  if (state === "offline") return mode === "steer" ? { kind: "refuse", reason: "turn_conflict" } : { kind: "queued_offline" }
  if (mode === "steer") {
    if (state !== "mid_turn") return { kind: "refuse", reason: "not_steerable" }
    if (expectedTurnId === null || turnEpoch === null || expectedTurnId !== turnEpoch) return { kind: "refuse", reason: "turn_conflict" }
    return { kind: "admit", deliverAs: "steer", expected_turn_id: expectedTurnId, expect: "steered" }
  }
  if (mode === "auto" && state !== "idle" && turnEpoch !== null) {
    return { kind: "admit", deliverAs: "steer", expected_turn_id: turnEpoch, expect: "steered" }
  }
  return { kind: "admit", deliverAs: "followUp", expect: state === "idle" ? "started" : "queued" }
}
