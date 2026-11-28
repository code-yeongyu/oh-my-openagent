/**
 * omo#15187: cancel or move the pending deliveries of one session in the store itself, so the session is never loaded.
 * One write transaction reads the request's receipt, refuses a mid-turn target or an unauthorised caller, rewrites the
 * queued rows and records the answer under the request key: a repeat replays that answer and changes nothing.
 */
import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"

import { GATEWAY_RECEIPT_RETENTION_MS, RETENTION_SWEEP_BATCH } from "./constants"
import {
  allocateSeq,
  createMarker,
  insertDelivery,
  refuseExpiredQueued,
  selectRows,
  transaction,
  unlinkMarker,
  write,
  type StoreContext,
} from "./store-ops"
import { deleteExpiredReceipt } from "./store-retention"

const OPERATION = "backlog_transfer"

export type BacklogTransferRequest = {
  readonly now: number
  readonly principal: string
  readonly idempotency_key: string
  readonly args_hash: string
  readonly source: string
  readonly action: "cancel" | "move"
  readonly destination: string | null
  readonly caller: string
  /** The caller's session carries the source's registered name (judged from the listing by the SDK). */
  readonly caller_holds_name: boolean
  /** The source is loaded and mid-turn: its live drain may be about to read a line, so nothing is touched. */
  readonly source_running: boolean
}

export type BacklogTransferAnswer =
  | { readonly action: "cancel"; readonly cancelled: readonly string[] }
  | {
      readonly action: "move"
      readonly destination: string
      readonly moved: readonly { readonly delivery_id: string; readonly new_delivery_id: string }[]
    }

export type BacklogTransferOutcome =
  | { readonly kind: "done"; readonly answer: BacklogTransferAnswer; readonly replayed: boolean }
  | { readonly kind: "refused"; readonly reason: "idempotency_conflict" | "turn_active" | "not_authorized" }

function storedAnswer(ctx: StoreContext, request: BacklogTransferRequest): BacklogTransferOutcome | undefined {
  const found = ctx.sql.one(
    ["args_hash", "result"],
    "SELECT args_hash, result FROM receipts WHERE principal = ? AND operation = ? AND idempotency_key = ?",
    [request.principal, OPERATION, request.idempotency_key],
  )
  if (found === undefined) return undefined
  if (String(found.args_hash) !== request.args_hash) return { kind: "refused", reason: "idempotency_conflict" }
  return { kind: "done", answer: JSON.parse(String(found.result)) as BacklogTransferAnswer, replayed: true }
}

/** The role's authority: the session that created the source (`thread_create`, recorded in `thread_creations`). */
function createdBy(ctx: StoreContext, caller: string, source: string): boolean {
  return (
    ctx.sql.one(["n"], "SELECT 1 AS n FROM thread_creations WHERE creator_durable_id = ? AND created_durable_id = ?", [
      caller,
      source,
    ]) !== undefined
  )
}

function settle(ctx: StoreContext, request: BacklogTransferRequest, answer: BacklogTransferAnswer): void {
  write(
    ctx,
    "INSERT INTO receipts (principal, operation, idempotency_key, args_hash, status, delivery_id, owner_instance, result, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, 'completed', NULL, ?, ?, ?, ?, ?)",
    [
      request.principal,
      OPERATION,
      request.idempotency_key,
      request.args_hash,
      ctx.config.instance_id,
      JSON.stringify(answer),
      request.now,
      request.now,
      request.now + GATEWAY_RECEIPT_RETENTION_MS,
    ],
  )
}

export async function transferBacklog(
  ctx: StoreContext,
  request: BacklogTransferRequest,
): Promise<BacklogTransferOutcome> {
  const created: string[] = []
  const gone: { readonly target: string; readonly id: string }[] = []
  try {
    const outcome = await transaction(ctx, OPERATION, (): BacklogTransferOutcome => {
      deleteExpiredReceipt(
        ctx,
        { principal: request.principal, operation: OPERATION, idempotency_key: request.idempotency_key },
        request.now,
      )
      const replay = storedAnswer(ctx, request)
      if (replay !== undefined) return replay
      if (request.source_running) return { kind: "refused", reason: "turn_active" }
      if (!request.caller_holds_name && !createdBy(ctx, request.caller, request.source))
        return { kind: "refused", reason: "not_authorized" }
      for (const expired of refuseExpiredQueued(ctx, request.now, RETENTION_SWEEP_BATCH, request.source))
        gone.push({ target: expired.target_durable_id, id: expired.delivery_id })
      const rows = selectRows(ctx, "target_durable_id = ? AND state = 'queued'", [request.source], "seq")
      for (const row of rows) {
        write(ctx, "UPDATE deliveries SET state = 'refused', reason = ?, updated_at = ? WHERE delivery_id = ?", [
          request.action === "cancel" ? "cancelled" : "moved",
          request.now,
          row.delivery_id,
        ])
        gone.push({ target: row.target_durable_id, id: row.delivery_id })
      }
      if (request.action === "cancel" || request.destination === null) {
        const answer: BacklogTransferAnswer = { action: "cancel", cancelled: rows.map((row) => row.delivery_id) }
        settle(ctx, request, answer)
        return { kind: "done", answer, replayed: false }
      }
      const destination = request.destination
      const moved = rows.map((row) => {
        const id = randomUUID()
        // A steer names the source's turn, which the destination never ran: the line keeps its place as an auto send.
        const steer = row.mode_requested === "steer"
        insertDelivery(ctx, {
          ...row,
          delivery_id: id,
          target_durable_id: destination,
          seq: allocateSeq(ctx, destination),
          envelope: { ...row.envelope, delivery_id: id },
          mode_requested: steer ? "auto" : row.mode_requested,
          expected_turn_id: steer ? null : row.expected_turn_id,
          updated_at: request.now,
        })
        // The sender's idempotency key follows its line: a retry under it reads the moved row, never a second send.
        write(
          ctx,
          "UPDATE receipts SET delivery_id = ?, updated_at = ? WHERE operation = 'deliver' AND delivery_id = ?",
          [id, request.now, row.delivery_id],
        )
        created.push(createMarker(ctx, destination, id, false))
        return { delivery_id: row.delivery_id, new_delivery_id: id }
      })
      const answer: BacklogTransferAnswer = { action: "move", destination, moved }
      settle(ctx, request, answer)
      return { kind: "done", answer, replayed: false }
    })
    for (const { target, id } of gone) unlinkMarker(ctx, target, id)
    return outcome
  } catch (error) {
    for (const path of created) rmSync(path, { force: true })
    throw error
  }
}
