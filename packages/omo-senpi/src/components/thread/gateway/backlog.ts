import {
  OPEN_STATES,
  STEER_RESERVE_BYTES,
  STEER_RESERVE_MESSAGES,
  TARGET_MAX_BYTES,
  TARGET_MAX_MESSAGES,
} from "./constants"
import { claimFingerprint, selectRows, type StoreContext } from "./store-ops"
import type { GatewayDeliveryMode, StoreRefusal } from "./types"

/**
 * One target's undelivered deliveries are bounded per lane (#14428): steers by their own small reserve, everything else
 * by the target cap, so follow-ups a session took but has not written can never shut a steer out.
 */
type BacklogLane = "steer" | "follow_up"

const LANE_LIMITS: Readonly<Record<BacklogLane, { readonly messages: number; readonly bytes: number }>> = {
  steer: { messages: STEER_RESERVE_MESSAGES, bytes: STEER_RESERVE_BYTES },
  follow_up: { messages: TARGET_MAX_MESSAGES, bytes: TARGET_MAX_BYTES },
}

/**
 * Why a full lane does not drain: its rows sit in the session's own queue, taken but not written (the session has not
 * reached the turn boundary that writes them, as when every turn ends in an error), or they wait in the gateway for a
 * drain that has not taken them (no live endpoint, or a hold such as the user's draft).
 */
type BacklogStall = "session_not_writing" | "session_not_draining"

export type TargetBacklog = {
  readonly held: number
  readonly held_bytes: number
  /** Rows the session's runtime took into its own queue and has not written yet. */
  readonly held_by_session: number
  /** Rows the session's drain has not taken from the gateway yet. */
  readonly waiting_in_gateway: number
  readonly oldest_at: number | null
  /** When the earliest still-counting queued row expires and frees its slot (#14466); null when none is queued. */
  readonly frees_at: number | null
}

/**
 * What counts (#14466): a queued row past its `expires_at` does not (an expired intake row stays queued for the
 * target's reconcile, every other one was refused just before this read), and neither does a row past its lifetime
 * whose claimant is dead (`deadClaims`, matched by claim fingerprint read before the lock). A live claimant's row counts.
 */
const BACKLOG_COLUMNS = ["target", "n", "b", "by_session", "oldest", "frees"] as const
const BACKLOG_SELECT = `SELECT target_durable_id AS target, COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b, COALESCE(SUM(CASE WHEN state = 'queued' THEN 0 ELSE 1 END), 0) AS by_session, MIN(created_at) AS oldest, MIN(CASE WHEN state = 'queued' THEN expires_at END) AS frees FROM deliveries WHERE state IN ${OPEN_STATES} AND NOT (state = 'queued' AND expires_at <= ?)`

const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

function backlogOf(found: Readonly<Record<string, unknown>> | undefined): TargetBacklog {
  const held = Number(found?.n ?? 0)
  const bySession = Number(found?.by_session ?? 0)
  return {
    held,
    held_bytes: Number(found?.b ?? 0),
    held_by_session: bySession,
    waiting_in_gateway: held - bySession,
    oldest_at: nullableNumber(found?.oldest),
    frees_at: nullableNumber(found?.frees),
  }
}

function readTargetBacklog(
  ctx: StoreContext,
  target: string,
  lane: BacklogLane,
  now: number,
  deadClaims: ReadonlyMap<string, string>,
): TargetBacklog {
  const laneFilter = lane === "steer" ? "mode_requested = 'steer'" : "mode_requested <> 'steer'"
  const counted = backlogOf(
    ctx.sql.one(BACKLOG_COLUMNS, `${BACKLOG_SELECT} AND target_durable_id = ? AND ${laneFilter}`, [now, target]),
  )
  if (deadClaims.size === 0) return counted
  let dead = 0
  let deadBytes = 0
  for (const row of selectRows(ctx, `target_durable_id = ? AND state IN ('admitting', 'admitted') AND ${laneFilter}`, [
    target,
  ])) {
    if (deadClaims.get(row.delivery_id) !== claimFingerprint(row)) continue
    dead++
    deadBytes += row.bytes
  }
  return {
    ...counted,
    held: counted.held - dead,
    held_bytes: counted.held_bytes - deadBytes,
    held_by_session: counted.held_by_session - dead,
  }
}

/** Every listed target's undelivered backlog in one read; a target holding nothing is absent. */
export function readTargetBacklogs(
  ctx: StoreContext,
  request: { readonly targets: readonly string[]; readonly now: number },
): Record<string, TargetBacklog> {
  if (request.targets.length === 0) return {}
  const rows = ctx.sql.all(
    BACKLOG_COLUMNS,
    `${BACKLOG_SELECT} AND target_durable_id IN (${request.targets.map(() => "?").join(", ")}) GROUP BY target_durable_id`,
    [request.now, ...request.targets],
  )
  return Object.fromEntries(rows.map((row) => [String(row.target), backlogOf(row)]))
}

export type BacklogCheck = {
  readonly target: string
  readonly mode: GatewayDeliveryMode
  readonly bytes: number
  readonly now: number
  readonly deadClaims: ReadonlyMap<string, string>
  /** Whether a live endpoint holds the target: a target nobody runs frees slots only as its rows expire (#14466). */
  readonly targetRunning: boolean
}

export function backlogRefusal(ctx: StoreContext, check: BacklogCheck): StoreRefusal | undefined {
  const lane: BacklogLane = check.mode === "steer" ? "steer" : "follow_up"
  const limits = LANE_LIMITS[lane]
  const backlog = readTargetBacklog(ctx, check.target, lane, check.now, check.deadClaims)
  // The byte budget bounds what waits together: a lone delivery the engine accepted always fits an empty lane.
  if (backlog.held < limits.messages && (backlog.held === 0 || backlog.held_bytes + check.bytes <= limits.bytes))
    return undefined
  const stall: BacklogStall =
    backlog.held_by_session >= backlog.waiting_in_gateway ? "session_not_writing" : "session_not_draining"
  return {
    kind: "refused",
    code: "queue_full",
    message:
      stall === "session_not_writing"
        ? `The target's ${lane} backlog is full: the session took ${backlog.held_by_session} of them into its own queue and has not written them, because it has not reached a turn boundary since.`
        : `The target's ${lane} backlog is full: ${backlog.waiting_in_gateway} of them wait in the gateway for the session's drain, which has not taken them.`,
    details: {
      lane,
      max_messages: limits.messages,
      max_bytes: limits.bytes,
      held: backlog.held,
      held_bytes: backlog.held_bytes,
      held_by_session: backlog.held_by_session,
      waiting_in_gateway: backlog.waiting_in_gateway,
      oldest_age_ms: backlog.oldest_at === null ? 0 : Math.max(0, check.now - backlog.oldest_at),
      reason: stall,
      target_running: check.targetRunning,
      frees_at: backlog.frees_at,
    },
  }
}
