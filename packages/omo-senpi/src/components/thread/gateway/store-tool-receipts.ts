/**
 * Tool receipts: the durable idempotency record of a thread tool call, in the gateway store's `receipts` table. Loaded
 * only in the store worker, like `store-ops.ts`. Every operation is one `BEGIN IMMEDIATE` transaction.
 */
import { GATEWAY_RECEIPT_RETENTION_MS } from "./constants"
import type { RelayDeliverySuccess } from "./transport"
import type { ReceiptOutcome } from "./types"
import { type StoreContext, transaction, write } from "./store-ops"
import { deleteExpiredReceipt, sweepRetentionIfDue } from "./store-retention"

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

type ReceiptKey = {
  readonly principal: string
  readonly operation: string
  readonly idempotency_key: string
  readonly args_hash: string
}

type StoredReceipt = {
  readonly args_hash: string
  readonly status: string
  readonly owner_instance: string
  readonly result: string | null
  readonly error_note: string | null
}

function selectReceipt(ctx: StoreContext, key: Omit<ReceiptKey, "args_hash">): StoredReceipt | undefined {
  const found = ctx.sql.one(
    ["args_hash", "status", "owner_instance", "result", "error_note"],
    "SELECT args_hash, status, owner_instance, result, error_note FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ?",
    [key.principal, key.operation, key.idempotency_key],
  )
  if (found === undefined) return undefined
  return {
    args_hash: String(found.args_hash),
    status: String(found.status),
    owner_instance: String(found.owner_instance),
    result: nullableString(found.result),
    error_note: nullableString(found.error_note),
  }
}

export type ToolReceiptBegin =
  | { readonly kind: "accepted" }
  | { readonly kind: "replay"; readonly result: unknown }
  | { readonly kind: "conflict" }
  /**
   * This instance holds the key's `prepared` receipt. `recovery` names a reserved retry of an uncertain call (it keeps
   * the first cause); a fresh call's reservation has none. A caller whose admission reply was lost resumes by it
   * (#14623 review round 2 H1), so a lost recovery reply never restarts the call as a fresh one.
   */
  | { readonly kind: "in_progress"; readonly recovery?: { readonly error_note: string } }
  | { readonly kind: "uncertain"; readonly error_note: string | null }
  /** The uncertain receipt is now this call's to recover (`retry_uncertain`): settle it like a new one. */
  | { readonly kind: "retry"; readonly error_note: string | null }

/**
 * `prepared` before the side effect, `completed` with its result after, `uncertain` when it threw.
 * A prepared receipt of ANOTHER instance means that process died mid-call: the effect may have
 * landed, so the receipt becomes `uncertain` and is never retried (the mailbox-era file receipts'
 * semantics, now in the gateway's `receipts` table). The admission also runs the bounded retention
 * sweep when one is due, so traffic made only of peer tool calls still drains expired receipts.
 *
 * A caller that may recover an uncertain call (`retry_uncertain`, thread_create, #14060) takes it back to `prepared`
 * under its own instance in the same transaction (`retry`), so one retry runs at a time and an overlapping one is
 * `in_progress`; its success settles the receipt as completed, and its failure settles it uncertain again. The first
 * cause (`error_note`) is kept through every later settle or takeover.
 */
export async function toolReceiptBegin(
  ctx: StoreContext,
  request: ReceiptKey & { readonly now: number; readonly retry_uncertain?: boolean },
): Promise<ToolReceiptBegin> {
  return await transaction(ctx, "tool_receipt_begin", (): ToolReceiptBegin => {
    const cleared = deleteExpiredReceipt(ctx, request, request.now)
    const admission = admitToolReceipt(ctx, request)
    // After the admission, so the receipt this call just wrote or read is not what the sweep removes.
    sweepRetentionIfDue(ctx, request.now, cleared)
    return admission
  })
}

function admitToolReceipt(
  ctx: StoreContext,
  request: ReceiptKey & { readonly now: number; readonly retry_uncertain?: boolean },
): ToolReceiptBegin {
  const receipt = selectReceipt(ctx, request)
  if (receipt === undefined) {
    write(
      ctx,
      "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, 'prepared', NULL, ?, ?, ?, ?)",
      [
        request.principal,
        request.operation,
        request.idempotency_key,
        request.args_hash,
        ctx.config.instance_id,
        request.now,
        request.now,
        request.now + GATEWAY_RECEIPT_RETENTION_MS,
      ],
    )
    return { kind: "accepted" }
  }
  if (receipt.args_hash !== request.args_hash) return { kind: "conflict" }
  if (receipt.status === "completed")
    return { kind: "replay", result: receipt.result === null ? null : JSON.parse(receipt.result) }
  if (receipt.status === "prepared" && receipt.owner_instance === ctx.config.instance_id)
    return receipt.error_note === null
      ? { kind: "in_progress" }
      : { kind: "in_progress", recovery: { error_note: receipt.error_note } }
  if (receipt.status === "prepared") {
    write(
      ctx,
      "UPDATE receipts SET status = 'uncertain', error_note = COALESCE(error_note, ?), updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ?",
      [
        "the process that began this call ended before recording its outcome",
        request.now,
        request.principal,
        request.operation,
        request.idempotency_key,
      ],
    )
  }
  const note = ctx.sql.one(
    ["error_note"],
    "SELECT error_note FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ?",
    [request.principal, request.operation, request.idempotency_key],
  )
  const errorNote = nullableString(note?.error_note)
  if (request.retry_uncertain !== true) return { kind: "uncertain", error_note: errorNote }
  write(
    ctx,
    "UPDATE receipts SET status = 'prepared', owner_instance = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'uncertain'",
    [ctx.config.instance_id, request.now, request.principal, request.operation, request.idempotency_key],
  )
  return { kind: "retry", error_note: errorNote }
}

export async function toolReceiptSettle(
  ctx: StoreContext,
  request: Omit<ReceiptKey, "args_hash"> & { readonly now: number } & (
      { readonly result: unknown } | { readonly error_note: string }
    ),
): Promise<boolean> {
  return await transaction(ctx, "tool_receipt_settle", () => {
    const completed = "result" in request
    return (
      write(
        ctx,
        `UPDATE receipts SET status = ?, ${completed ? "result = ?" : "error_note = COALESCE(error_note, ?)"}, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?`,
        [
          completed ? "completed" : "uncertain",
          completed ? JSON.stringify(request.result) : request.error_note,
          request.now,
          request.principal,
          request.operation,
          request.idempotency_key,
          ctx.config.instance_id,
        ],
      ) === 1
    )
  })
}

/**
 * Replaces a completed receipt's answer with what later became of the same call, so a retry under its key replays
 * that: a relayed steer the receiver held behind its open draft until the steered turn ended was answered `queued`,
 * and its receipt then answers the `turn_conflict` refusal. Only the instance that settled the receipt revises it.
 */
export async function toolReceiptRevise(
  ctx: StoreContext,
  request: Omit<ReceiptKey, "args_hash"> & { readonly now: number; readonly result: unknown },
): Promise<boolean> {
  return await transaction(
    ctx,
    "tool_receipt_revise",
    () =>
      write(
        ctx,
        "UPDATE receipts SET result = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'completed' AND owner_instance = ?",
        [
          JSON.stringify(request.result),
          request.now,
          request.principal,
          request.operation,
          request.idempotency_key,
          ctx.config.instance_id,
        ],
      ) === 1,
  )
}

/**
 * Drops a `prepared` receipt this instance holds for a call that wrote nothing before it failed, so the next call under
 * the same key runs again instead of replaying that failure. A receipt another instance holds, or one already settled,
 * is left alone.
 */
export async function toolReceiptRelease(ctx: StoreContext, request: Omit<ReceiptKey, "args_hash">): Promise<boolean> {
  return await transaction(
    ctx,
    "tool_receipt_release",
    () =>
      write(
        ctx,
        "DELETE FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ? AND error_note IS NULL",
        [request.principal, request.operation, request.idempotency_key, ctx.config.instance_id],
      ) === 1,
  )
}

export type RemoteReceipt = { readonly idempotency_key: string; readonly result: RelayDeliverySuccess }
const REMOTE_SEND_OPERATION = "thread_send:remote"

export function remoteReceipt(
  ctx: StoreContext,
  request: { readonly now: number; readonly principal: string; readonly delivery_id: string },
): RemoteReceipt | null {
  const row = ctx.sql.one(
    ["idempotency_key", "result"],
    "SELECT idempotency_key, result FROM receipts WHERE principal = ? AND operation = ? AND status = 'completed' AND expires_at > ? AND json_extract(result, '$.delivery_id') = ?",
    [request.principal, REMOTE_SEND_OPERATION, request.now, request.delivery_id],
  )
  return row === undefined
    ? null
    : {
        idempotency_key: String(row.idempotency_key),
        result: JSON.parse(String(row.result)) as RelayDeliverySuccess,
      }
}

export type ReconcileRemoteReceiptRequest = {
  readonly now: number
  readonly principal: string
  readonly idempotency_key: string
  readonly delivery_id: string
  readonly target_durable_id: string
  readonly device: string
  readonly outcome: ReceiptOutcome
}

export async function reconcileRemoteReceipt(
  ctx: StoreContext,
  request: ReconcileRemoteReceiptRequest,
): Promise<ReceiptOutcome> {
  return await transaction(ctx, "reconcile_remote_receipt", () => {
    const prior = remoteReceipt(ctx, request)
    if (
      prior === null ||
      prior.idempotency_key !== request.idempotency_key ||
      prior.result.device !== request.device ||
      prior.result.thread_id !== request.target_durable_id
    )
      return { kind: "outcome_unavailable" }
    const known = prior.result.outcome
    if (known?.kind === "applied" || known?.kind === "refused") return known
    write(
      ctx,
      "UPDATE receipts SET result = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ?",
      [
        JSON.stringify({ ...prior.result, outcome: request.outcome }),
        request.now,
        request.principal,
        REMOTE_SEND_OPERATION,
        request.idempotency_key,
      ],
    )
    return request.outcome
  })
}
