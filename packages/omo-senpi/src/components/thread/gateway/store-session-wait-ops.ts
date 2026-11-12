import type { SqlRow } from "./sql"
import { transaction, write, type StoreContext } from "./store-ops"
import type { QueuedWaitingOn, SessionWaitState, SessionWork } from "./session-wait-types"

type Key = { readonly durable_id: string; readonly now: number }

function waitFrom(record: SqlRow): SessionWaitState {
  const kinds: unknown = JSON.parse(String(record.hold_kinds))
  return {
    durable_id: String(record.durable_id),
    wait: record.wait === "held" ? "held" : "waiting",
    hold_kinds: Array.isArray(kinds) ? kinds.map(String) : [],
    file_size: Number(record.file_size),
    written_at: Number(record.written_at),
  }
}

export function readWait(ctx: StoreContext, request: Key): SessionWaitState | null {
  const found = ctx.sql.one(
    ["durable_id", "wait", "hold_kinds", "file_size", "written_at"],
    "SELECT durable_id, wait, hold_kinds, file_size, written_at FROM session_wait WHERE durable_id = ?",
    [request.durable_id],
  )
  return found === undefined ? null : waitFrom(found)
}

export async function writeWait(ctx: StoreContext, request: Omit<SessionWaitState, "written_at"> & Key): Promise<void> {
  await transaction(ctx, "wait_write", () => {
    write(
      ctx,
      `INSERT INTO session_wait (durable_id, wait, hold_kinds, file_size, written_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (durable_id) DO UPDATE SET wait = excluded.wait, hold_kinds = excluded.hold_kinds,
         file_size = excluded.file_size, written_at = excluded.written_at`,
      [request.durable_id, request.wait, JSON.stringify(request.hold_kinds), request.file_size, request.now],
    )
  })
}

export async function clearWait(ctx: StoreContext, request: Key): Promise<void> {
  await transaction(ctx, "wait_clear", () => {
    write(ctx, "DELETE FROM session_wait WHERE durable_id = ?", [request.durable_id])
  })
}

/** A hold is reported before the wake, and a person's wait reads as approval (A2.6). */
export function waitingOn(ctx: StoreContext, request: Key): QueuedWaitingOn | null {
  const wait = readWait(ctx, request)
  if (wait !== null) return { kind: wait.wait === "held" ? "hold" : "approval" }
  const woken = ctx.sql.one(["n"], "SELECT COUNT(*) AS n FROM woken_sessions WHERE durable_id = ?", [
    request.durable_id,
  ])
  return Number(woken?.n ?? 0) > 0 ? { kind: "wake" } : null
}

export async function countWake(
  ctx: StoreContext,
  request: Key & { readonly human_input_revision: number | null },
): Promise<{ readonly count: number }> {
  return await transaction(ctx, "wake_count", () => {
    const found = ctx.sql.one(
      ["count", "human_input_revision"],
      "SELECT count, human_input_revision FROM wake_counts WHERE durable_id = ?",
      [request.durable_id],
    )
    const stored = found?.human_input_revision ?? null
    const moved = found === undefined || (request.human_input_revision !== null && Number(stored) !== request.human_input_revision)
    const count = moved ? 1 : Number(found?.count ?? 0) + 1
    write(
      ctx,
      `INSERT INTO wake_counts (durable_id, count, human_input_revision) VALUES (?, ?, ?)
       ON CONFLICT (durable_id) DO UPDATE SET count = excluded.count, human_input_revision = excluded.human_input_revision`,
      [request.durable_id, count, request.human_input_revision ?? (stored === null ? null : Number(stored))],
    )
    return { count }
  })
}

export function wakeCount(ctx: StoreContext, request: Key): number {
  return Number(
    ctx.sql.one(["count"], "SELECT count FROM wake_counts WHERE durable_id = ?", [request.durable_id])?.count ?? 0,
  )
}

export async function resetCount(ctx: StoreContext, request: Key): Promise<void> {
  await transaction(ctx, "wake_count_reset", () => {
    write(ctx, "DELETE FROM wake_counts WHERE durable_id = ?", [request.durable_id])
  })
}

export function sessionWork(ctx: StoreContext, request: Key): SessionWork {
  const count = (state: string): number =>
    Number(
      ctx.sql.one(["n"], "SELECT COUNT(*) AS n FROM deliveries WHERE target_durable_id = ? AND state = ?", [
        request.durable_id,
        state,
      ])?.n ?? 0,
    )
  return { queued: count("queued"), claimed: count("admitting"), unapplied: count("admitted") }
}
