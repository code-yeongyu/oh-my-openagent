import { threadToolFailure, type ThreadErrorCode } from "../errors"
import type { GatewayEndpointKind } from "./adapter"
import type { DeliveryRow, GatewayDeliveryResult } from "./types"

const REFUSAL_CODES: Readonly<Record<string, { readonly code: ThreadErrorCode; readonly next: string }>> = {
  not_steerable: { code: "not_steerable", next: "Send with delivery auto or follow_up; a steer needs a running turn." },
  turn_conflict: { code: "turn_conflict", next: "Read the target again and retry with its current turn id, or send with delivery auto." },
  expired: { code: "not_resumable", next: "The target did not take the message within its lifetime; send it again if it still matters." },
  binding_closed: { code: "invalid_arguments", next: "The binding this message was queued under was detached or rebound; re-read the binding and send again." },
}

export function resultFromRow(
  row: DeliveryRow,
  queuePosition: number,
  endpointKind: GatewayEndpointKind | null,
  deduplicated: boolean,
  offline: boolean,
): GatewayDeliveryResult {
  const base = {
    kind: "ok" as const,
    thread_id: row.target_durable_id,
    delivery_id: row.delivery_id,
    message_seq: row.seq,
    effective_mode: row.mode_effective ?? row.mode_requested,
    endpoint_kind: endpointKind,
    deduplicated,
  }
  if (row.state === "admitted" || row.state === "applied") {
    if (row.admission_kind === "started" || row.admission_kind === "steered") {
      return { ...base, delivery: { kind: row.admission_kind, turn_id: String(row.turn_epoch ?? 0) } }
    }
    return { ...base, delivery: { kind: "queued", queue_position: Math.max(queuePosition, 1) } }
  }
  if (row.state === "refused") {
    const mapped = REFUSAL_CODES[row.reason ?? ""] ?? { code: "internal_error" as const, next: "Call thread_list and check the target." }
    return {
      kind: "error",
      error: threadToolFailure(mapped.code, `Delivery ${row.delivery_id} was refused: ${row.reason ?? "unknown"}.`, mapped.next, { delivery_id: row.delivery_id }),
    }
  }
  if (row.state === "uncertain") {
    return {
      kind: "error",
      error: threadToolFailure("idempotency_uncertain", `Delivery ${row.delivery_id} may or may not have reached the target.`, "Read the target transcript before deciding whether to send again.", { delivery_id: row.delivery_id }),
    }
  }
  return { ...base, delivery: { kind: offline ? "queued_offline" : "queued", queue_position: Math.max(queuePosition, 1) } }
}
