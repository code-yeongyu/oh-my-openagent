/**
 * The record of woken sessions (#13037 A3.1): worker-only, every write one `BEGIN IMMEDIATE` transaction. A row leaves
 * `requested` in the transaction that counts the cap, so two processes cannot both pass at the cap; every later write is a
 * compare-and-set on the generation a takeover raises, so a carrier that lost its lease writes nothing.
 */
import { randomUUID } from "node:crypto"
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { WAKE_LEASE_MS, WAKE_MAX_ATTEMPTS, WAKE_RETRY_DELAY_MS, WOKEN_SESSION_CAP } from "./constants"
import { gatewayWakeMarkerPath } from "./paths"
import { isClaimantDead } from "./process-identity"
import type { SqlRow } from "./sql"
import { transaction, write, type StoreContext } from "./store-ops"
import type { ProcessIdentity } from "./types"
import type {
  LostLease,
  WakeRequestOutcome,
  WakeRetryOutcome,
  WakeStartOutcome,
  WakeTakeOverOutcome,
  WokenSessionFence,
  WokenSessionKey,
  WokenSessionRow,
  WokenStateRequest,
} from "./woken-types"

const COLUMNS = [
  "durable_id",
  "session_file",
  "host_instance",
  "state",
  "requested_at",
  "opened_at",
  "first_waiting_at",
  "lease_owner",
  "lease_expires_at",
  "generation",
  "attempts",
  "next_attempt_at",
] as const

const LOST: LostLease = { kind: "lost_lease" }

type Timed<T> = T & { readonly now: number }

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function rowFrom(record: SqlRow): WokenSessionRow {
  return {
    durable_id: String(record.durable_id),
    session_file: String(record.session_file),
    host_instance: record.host_instance === null ? null : String(record.host_instance),
    state: record.state as WokenSessionRow["state"],
    requested_at: Number(record.requested_at),
    opened_at: nullableNumber(record.opened_at),
    first_waiting_at: nullableNumber(record.first_waiting_at),
    lease_owner: record.lease_owner === null ? null : (JSON.parse(String(record.lease_owner)) as ProcessIdentity),
    lease_expires_at: nullableNumber(record.lease_expires_at),
    generation: Number(record.generation),
    attempts: Number(record.attempts),
    next_attempt_at: nullableNumber(record.next_attempt_at),
  }
}

function selectRow(ctx: StoreContext, durableId: string): WokenSessionRow | undefined {
  const found = ctx.sql.one(COLUMNS, `SELECT ${COLUMNS.join(", ")} FROM woken_sessions WHERE durable_id = ?`, [
    durableId,
  ])
  return found === undefined ? undefined : rowFrom(found)
}

function requireRow(ctx: StoreContext, durableId: string): WokenSessionRow {
  const row = selectRow(ctx, durableId)
  if (row === undefined) throw new Error(`woken session ${durableId} vanished inside its own transaction`)
  return row
}

/**
 * The wake hint carriers watch: a temp file renamed over `wake.marker`, rewritten while the write lock is held, so like the
 * inbox marker it is only ever early. Written when a wake is requested and when a row ends (a place freed lets a
 * `requested` row start).
 */
function touchWakeMarker(ctx: StoreContext, durableId: string, now: number): void {
  const marker = gatewayWakeMarkerPath(ctx.config.agent_dir)
  mkdirSync(dirname(marker), { recursive: true, mode: 0o700 })
  const temporary = `${marker}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify({ durable_id: durableId, written_at: now }), { mode: 0o600 })
  renameSync(temporary, marker)
}

function fenced(
  ctx: StoreContext,
  fence: WokenSessionFence,
  set: string,
  params: readonly (string | number | null)[],
): boolean {
  return (
    write(ctx, `UPDATE woken_sessions SET ${set} WHERE durable_id = ? AND generation = ?`, [
      ...params,
      fence.durable_id,
      fence.generation,
    ]) === 1
  )
}

export async function requestWake(
  ctx: StoreContext,
  request: Timed<WokenSessionKey & { readonly session_file: string }>,
): Promise<WakeRequestOutcome> {
  return await transaction(ctx, "woken_request", () => {
    const created =
      write(
        ctx,
        "INSERT OR IGNORE INTO woken_sessions (durable_id, session_file, state, requested_at) VALUES (?, ?, 'requested', ?)",
        [request.durable_id, request.session_file, request.now],
      ) === 1
    touchWakeMarker(ctx, request.durable_id, request.now)
    return { kind: "requested", row: requireRow(ctx, request.durable_id), created }
  })
}

export async function startWake(ctx: StoreContext, request: Timed<WokenSessionKey>): Promise<WakeStartOutcome> {
  return await transaction(ctx, "woken_start", (): WakeStartOutcome => {
    const row = selectRow(ctx, request.durable_id)
    if (row === undefined) return { kind: "not_found" }
    if (row.state !== "requested") return { kind: "in_progress", row }
    if (row.next_attempt_at !== null && row.next_attempt_at > request.now)
      return { kind: "not_yet", next_attempt_at: row.next_attempt_at }
    const taken = Number(
      ctx.sql.one(["n"], "SELECT COUNT(*) AS n FROM woken_sessions WHERE state <> 'requested'")?.n ?? 0,
    )
    if (taken >= WOKEN_SESSION_CAP) return { kind: "overloaded" }
    write(
      ctx,
      "UPDATE woken_sessions SET state = 'opening', lease_owner = ?, lease_expires_at = ?, generation = generation + 1, next_attempt_at = NULL WHERE durable_id = ?",
      [JSON.stringify(ctx.self), request.now + WAKE_LEASE_MS, request.durable_id],
    )
    return { kind: "started", row: requireRow(ctx, request.durable_id) }
  })
}

export async function renewLease(
  ctx: StoreContext,
  request: Timed<WokenSessionFence>,
): Promise<{ readonly kind: "renewed"; readonly row: WokenSessionRow } | LostLease> {
  return await transaction(ctx, "woken_renew", () =>
    fenced(ctx, request, "lease_expires_at = ?", [request.now + WAKE_LEASE_MS])
      ? { kind: "renewed" as const, row: requireRow(ctx, request.durable_id) }
      : LOST,
  )
}

/**
 * Takes over a row whose lease ran out. The previous owner is probed BEFORE the lock (the probe can be slow), with the
 * probe `reconcile` uses for a claimant; the write then requires the generation that was judged.
 */
export async function takeOverWake(ctx: StoreContext, request: Timed<WokenSessionKey>): Promise<WakeTakeOverOutcome> {
  const seen = selectRow(ctx, request.durable_id)
  if (seen === undefined) return { kind: "not_found" }
  if (seen.lease_owner === null || seen.lease_expires_at === null) return { kind: "not_leased", row: seen }
  if (seen.lease_expires_at > request.now) return { kind: "lease_live", row: seen }
  const previousOwnerAlive = !(await isClaimantDead(seen.lease_owner))
  return await transaction(ctx, "woken_take_over", (): WakeTakeOverOutcome => {
    const current = selectRow(ctx, request.durable_id)
    if (current === undefined) return { kind: "not_found" }
    if (current.generation !== seen.generation) return LOST
    if (current.lease_expires_at !== null && current.lease_expires_at > request.now)
      return { kind: "lease_live", row: current }
    fenced(ctx, current, "lease_owner = ?, lease_expires_at = ?, generation = generation + 1", [
      JSON.stringify(ctx.self),
      request.now + WAKE_LEASE_MS,
    ])
    return { kind: "taken_over", row: requireRow(ctx, request.durable_id), previous_owner_alive: previousOwnerAlive }
  })
}

export async function setWokenState(
  ctx: StoreContext,
  request: Timed<WokenStateRequest>,
): Promise<{ readonly kind: "ok"; readonly row: WokenSessionRow } | LostLease> {
  return await transaction(ctx, "woken_set_state", () => {
    const opened = request.state === "open" ? request.now : null
    const written = fenced(
      ctx,
      request,
      "state = ?, opened_at = COALESCE(opened_at, ?), host_instance = COALESCE(?, host_instance)",
      [request.state, opened, request.host_instance ?? null],
    )
    return written ? { kind: "ok" as const, row: requireRow(ctx, request.durable_id) } : LOST
  })
}

export async function recordWaiting(
  ctx: StoreContext,
  request: Timed<WokenSessionFence>,
): Promise<{ readonly kind: "ok"; readonly row: WokenSessionRow } | LostLease> {
  return await transaction(ctx, "woken_record_waiting", () =>
    fenced(ctx, request, "first_waiting_at = COALESCE(first_waiting_at, ?)", [request.now])
      ? { kind: "ok" as const, row: requireRow(ctx, request.durable_id) }
      : LOST,
  )
}

/** A transient open failure (A3.1.5): back to `requested` with the next attempt's time, or deleted at the last attempt. */
export async function retryWakeLater(
  ctx: StoreContext,
  request: Timed<WokenSessionFence>,
): Promise<WakeRetryOutcome> {
  return await transaction(ctx, "woken_retry_later", (): WakeRetryOutcome => {
    const row = selectRow(ctx, request.durable_id)
    if (row === undefined || row.generation !== request.generation) return LOST
    const attempts = row.attempts + 1
    if (attempts >= WAKE_MAX_ATTEMPTS) {
      write(ctx, "DELETE FROM woken_sessions WHERE durable_id = ? AND generation = ?", [
        request.durable_id,
        request.generation,
      ])
      touchWakeMarker(ctx, request.durable_id, request.now)
      return { kind: "failed", attempts }
    }
    fenced(
      ctx,
      request,
      "state = 'requested', lease_owner = NULL, lease_expires_at = NULL, attempts = ?, next_attempt_at = ?",
      [attempts, request.now + WAKE_RETRY_DELAY_MS],
    )
    return { kind: "deferred", row: requireRow(ctx, request.durable_id) }
  })
}

export async function endWake(
  ctx: StoreContext,
  request: Timed<WokenSessionFence>,
): Promise<{ readonly kind: "ended" } | LostLease> {
  return await transaction(ctx, "woken_end", () => {
    const deleted = write(ctx, "DELETE FROM woken_sessions WHERE durable_id = ? AND generation = ?", [
      request.durable_id,
      request.generation,
    ])
    if (deleted !== 1) return LOST
    touchWakeMarker(ctx, request.durable_id, request.now)
    return { kind: "ended" as const }
  })
}

export function isGated(ctx: StoreContext, request: Timed<WokenSessionKey>): boolean {
  const row = selectRow(ctx, request.durable_id)
  return row?.state === "opening" && row.lease_expires_at !== null && row.lease_expires_at > request.now
}

export function listWoken(ctx: StoreContext): WokenSessionRow[] {
  return ctx.sql
    .all(COLUMNS, `SELECT ${COLUMNS.join(", ")} FROM woken_sessions`, [], "requested_at, durable_id")
    .map(rowFrom)
}
