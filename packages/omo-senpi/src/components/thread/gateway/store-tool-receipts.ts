/**
 * Tool receipts: the durable idempotency record of a thread tool call, in the gateway store's `receipts` table. Loaded
 * only in the store worker, like `store-ops.ts`. Every operation is one `BEGIN IMMEDIATE` transaction.
 */
import { GATEWAY_RECEIPT_RETENTION_MS } from "./constants"
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
}

function selectReceipt(ctx: StoreContext, key: Omit<ReceiptKey, "args_hash">): StoredReceipt | undefined {
  const found = ctx.sql.one(
    ["args_hash", "status", "owner_instance", "result"],
    "SELECT args_hash, status, owner_instance, result FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ?",
    [key.principal, key.operation, key.idempotency_key],
  )
  if (found === undefined) return undefined
  return {
    args_hash: String(found.args_hash),
    status: String(found.status),
    owner_instance: String(found.owner_instance),
    result: nullableString(found.result),
  }
}

export type ToolReceiptBegin =
  | { readonly kind: "accepted" }
  | { readonly kind: "replay"; readonly result: unknown }
  | { readonly kind: "conflict" }
  | { readonly kind: "in_progress" }
  | { readonly kind: "uncertain"; readonly error_note: string | null }

/**
 * `prepared` before the side effect, `completed` with its result after, `uncertain` when it threw.
 * A prepared receipt of ANOTHER instance means that process died mid-call: the effect may have
 * landed, so the receipt becomes `uncertain` and is never retried (the mailbox-era file receipts'
 * semantics, now in the gateway's `receipts` table). The admission also runs the bounded retention
 * sweep when one is due, so traffic made only of peer tool calls still drains expired receipts.
 */
export async function toolReceiptBegin(
  ctx: StoreContext,
  request: ReceiptKey & { readonly now: number },
): Promise<ToolReceiptBegin> {
  return await transaction(ctx, "tool_receipt_begin", (): ToolReceiptBegin => {
    const cleared = deleteExpiredReceipt(ctx, request, request.now)
    const admission = admitToolReceipt(ctx, request)
    // After the admission, so the receipt this call just wrote or read is not what the sweep removes.
    sweepRetentionIfDue(ctx, request.now, cleared)
    return admission
  })
}

function admitToolReceipt(ctx: StoreContext, request: ReceiptKey & { readonly now: number }): ToolReceiptBegin {
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
  if (receipt.status === "prepared" && receipt.owner_instance === ctx.config.instance_id) return { kind: "in_progress" }
  if (receipt.status === "prepared") {
    write(
      ctx,
      "UPDATE receipts SET status = 'uncertain', error_note = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ?",
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
  return { kind: "uncertain", error_note: nullableString(note?.error_note) }
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
        `UPDATE receipts SET status = ?, ${completed ? "result" : "error_note"} = ?, updated_at = ? WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?`,
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
        "DELETE FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ? AND status = 'prepared' AND owner_instance = ?",
        [request.principal, request.operation, request.idempotency_key, ctx.config.instance_id],
      ) === 1,
  )
}
