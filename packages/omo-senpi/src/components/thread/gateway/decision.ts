import type { RuntimePhase } from "./adapter"
import type { GatewayDeliveryMode } from "./types"

export type TargetState = RuntimePhase | "offline"

export type DeliveryDecision =
  | {
      readonly kind: "admit"
      readonly deliverAs: "steer" | "followUp"
      readonly expected_turn_id?: number
      readonly expect: "started" | "queued" | "steered"
    }
  | { readonly kind: "refuse"; readonly reason: "not_steerable" | "turn_conflict" }
  | { readonly kind: "queued_offline" }

/**
 * The 15-cell table {idle, mid_turn, waiting_question, compacting, offline} x {auto, steer,
 * follow_up}. Question answers never travel through a delivery, so a steer into a waiting
 * question is `not_steerable`, like a steer into an idle or compacting session.
 *
 * `auto`, the default every send takes, steers the turn the target is running (Q 2026-11-09:
 * a message to a busy session reaches the turn in flight, as typing into its TUI does) and
 * starts a turn when the target is idle; it queues behind only what cannot be steered (a
 * waiting question, a compaction, or a running turn whose epoch the engine does not report),
 * and `follow_up` queues on request.
 */
export function decideDelivery(
  state: TargetState,
  mode: GatewayDeliveryMode,
  expectedTurnId: number | null,
  turnEpoch: number | null,
): DeliveryDecision {
  if (state === "offline")
    return mode === "steer" ? { kind: "refuse", reason: "turn_conflict" } : { kind: "queued_offline" }
  if (mode === "steer") {
    if (state !== "mid_turn") return { kind: "refuse", reason: "not_steerable" }
    if (expectedTurnId === null || turnEpoch === null || expectedTurnId !== turnEpoch)
      return { kind: "refuse", reason: "turn_conflict" }
    return { kind: "admit", deliverAs: "steer", expected_turn_id: expectedTurnId, expect: "steered" }
  }
  if (mode === "auto" && state === "mid_turn" && turnEpoch !== null)
    return { kind: "admit", deliverAs: "steer", expected_turn_id: turnEpoch, expect: "steered" }
  return { kind: "admit", deliverAs: "followUp", expect: state === "idle" ? "started" : "queued" }
}
