import type { GatewayStore } from "../gateway/store"
import type { ReceiptOutcome } from "../gateway/types"
import type { RelayDeliverySuccess } from "../gateway/transport"
import type { RemoteThreadSurface } from "./ports"
import type { ThreadDataError, ThreadReceiptResult } from "../contracts/results"
import { replyData } from "./remote-ops"
import { outcomeFailure } from "./outcome"

export async function readReceipt(
  store: Pick<GatewayStore, "now" | "remoteReceipt" | "receiptOutcome" | "reconcileRemoteReceipt">,
  remote: RemoteThreadSurface | undefined,
  caller: string,
  thread: string,
  id: string,
  now: number,
): Promise<ThreadReceiptResult | ThreadDataError> {
  // Only the authenticated caller's existing send may authorize a remote lookup.
  const request = { now, principal: `session:${caller}`, delivery_id: id }
  const retained = await store.remoteReceipt(request)
  if (retained !== null) {
    if (retained.result.thread_id !== thread)
      return { kind: "ok", thread, delivery_id: id, outcome: { kind: "outcome_unavailable" } }
    const reconciled = await reconcileRemoteReceipt(store, remote, caller, retained.idempotency_key, retained.result)
    if (reconciled.kind === "error") return reconciled
    return { kind: "ok", thread, delivery_id: id, outcome: reconciled.outcome }
  }
  return {
    kind: "ok",
    thread,
    delivery_id: id,
    outcome: await store.receiptOutcome({ ...request, target_durable_id: thread }),
  }
}

export function receiptOutcomeOf(value: unknown): ReceiptOutcome {
  if (typeof value !== "object" || value === null) return { kind: "outcome_unavailable" }
  const kind = Reflect.get(value, "kind")
  switch (kind) {
    case "pending":
    case "admitted":
    case "applied":
    case "outcome_unavailable":
      return { kind }
    case "refused": {
      const reason = Reflect.get(value, "reason")
      switch (reason) {
        case "expired":
        case "not_steerable":
        case "turn_conflict":
        case "target_closed":
        case "binding_closed":
          return { kind, reason }
      }
    }
  }
  return { kind: "outcome_unavailable" }
}

export async function reconcileRemoteReceipt(
  store: Pick<GatewayStore, "now" | "reconcileRemoteReceipt">,
  remote: RemoteThreadSurface | undefined,
  caller: string,
  key: string,
  first: RelayDeliverySuccess,
) {
  if (first.delivery_id === undefined) return { ...first, outcome: { kind: "outcome_unavailable" as const } }
  // A retained terminal fact survives a disconnect. Revocation denials still win over that cached fact.
  const answer = await remote?.sessions
    .receipt?.(first.device, first.thread_id, first.delivery_id)
    .catch(() => ({ kind: "unavailable" as const }))
  if (
    answer?.kind === "refused" &&
    !["unsupported", "invalid_request", "engine_capability_missing", "method_unclassified"].includes(answer.reason)
  )
    return outcomeFailure(answer, first.device)
  const data = answer?.kind === "ok" ? replyData(answer.response) : undefined
  if (data?.["kind"] === "refused" && data["reason"] === "sender_not_admitted")
    return outcomeFailure({ kind: "refused", reason: "sender_not_admitted" }, first.device)
  const observed = receiptOutcomeOf(data?.["outcome"])
  const outcome = await store.reconcileRemoteReceipt({
    now: store.now(),
    principal: `session:${caller}`,
    idempotency_key: key,
    delivery_id: first.delivery_id,
    device: first.device,
    target_durable_id: first.thread_id,
    outcome: observed,
  })
  return { ...first, deduplicated: true, outcome }
}
