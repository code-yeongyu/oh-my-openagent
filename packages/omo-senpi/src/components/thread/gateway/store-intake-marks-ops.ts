import { isClaimantDead } from "./process-identity"
import { OPEN_STATES, transaction, write, type StoreContext } from "./store-ops"
import type { IntakeMark, IntakePair, OpenIntakeSession } from "./session-wait-types"
import type { ProcessIdentity } from "./types"

type Now = { readonly now: number }

const DEVICE = "json_extract(envelope, '$.provenance.device')"
/** The intake rows of one (sender device, session) pair: their ledger id is `device:<attested device>/<sender's id>`. */
const PAIR_ROWS = `target_durable_id = ? AND ledger_id IS NOT NULL AND substr(ledger_id, 1, length(?)) = ?`
const pairParams = (pair: IntakePair): readonly string[] => {
  const prefix = `device:${pair.sender_device}/`
  return [pair.session_id, prefix, prefix]
}

export async function recordIntakeCommand(
  ctx: StoreContext,
  request: IntakePair & Now & { readonly command_id: string; readonly ledger_id?: string },
): Promise<void> {
  await transaction(ctx, "intake_mark", () => {
    if (request.ledger_id !== undefined)
      write(ctx, "INSERT OR IGNORE INTO intake_commands (ledger_id, command_id) VALUES (?, ?)", [
        request.ledger_id,
        request.command_id,
      ])
    write(
      ctx,
      `INSERT INTO intake_marks (sender_device, session_id, last_command_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (sender_device, session_id) DO UPDATE SET last_command_id = excluded.last_command_id,
         updated_at = excluded.updated_at`,
      [request.sender_device, request.session_id, request.command_id, request.now],
    )
  })
}

function openRows(ctx: StoreContext, pair: IntakePair): number {
  return Number(
    ctx.sql.one(["n"], `SELECT COUNT(*) AS n FROM deliveries WHERE ${PAIR_ROWS} AND state IN ${OPEN_STATES}`, [
      ...pairParams(pair),
    ])?.n ?? 0,
  )
}

export function markedPairs(ctx: StoreContext): IntakePair[] {
  return ctx.sql
    .all(["sender_device", "session_id"], "SELECT sender_device, session_id FROM intake_marks", [], "sender_device, session_id")
    .map((row) => ({ sender_device: String(row.sender_device), session_id: String(row.session_id) }))
}

export function pendingMarks(ctx: StoreContext): IntakeMark[] {
  return ctx.sql
    .all(
      ["sender_device", "session_id", "last_command_id"],
      "SELECT sender_device, session_id, last_command_id FROM intake_marks",
      [],
      "sender_device, session_id",
    )
    .map((row) => ({
      sender_device: String(row.sender_device),
      session_id: String(row.session_id),
      last_command_id: String(row.last_command_id),
    }))
    .filter((mark) => openRows(ctx, mark) > 0)
}

export async function drainedMark(
  ctx: StoreContext,
  request: IntakePair & Now,
): Promise<{ readonly drained: true; readonly last_command_id: string } | { readonly drained: false }> {
  return await transaction(ctx, "intake_drained", () => {
    if (openRows(ctx, request) > 0) return { drained: false as const }
    const mark = ctx.sql.one(
      ["last_command_id"],
      "SELECT last_command_id FROM intake_marks WHERE sender_device = ? AND session_id = ?",
      [request.sender_device, request.session_id],
    )
    if (mark === undefined) return { drained: false as const }
    write(ctx, "DELETE FROM intake_marks WHERE sender_device = ? AND session_id = ?", [
      request.sender_device,
      request.session_id,
    ])
    return { drained: true as const, last_command_id: String(mark.last_command_id) }
  })
}

/**
 * Sessions a sweep may wake (5.4 step 6): intake rows that are queued, or claimed by a claimant that is dead, and
 * whether same-device rows are queued for the session too. Claimants are probed outside any transaction.
 */
export async function openIntakeSessions(ctx: StoreContext): Promise<OpenIntakeSession[]> {
  const rows = ctx.sql.all(
    ["target_durable_id", "device", "state", "admitted_by"],
    `SELECT target_durable_id, ${DEVICE} AS device, state, admitted_by FROM deliveries
     WHERE ledger_id IS NOT NULL AND state IN ${OPEN_STATES}`,
    [],
    "target_durable_id, seq",
  )
  const sessions = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.state !== "queued") {
      const claimant = row.admitted_by === null ? null : (JSON.parse(String(row.admitted_by)) as ProcessIdentity)
      if (claimant !== null && !(await isClaimantDead(claimant))) continue
    }
    const devices = sessions.get(String(row.target_durable_id)) ?? new Set<string>()
    if (row.device !== null) devices.add(String(row.device))
    sessions.set(String(row.target_durable_id), devices)
  }
  const local = new Set(
    ctx.sql
      .all(["target_durable_id"], "SELECT DISTINCT target_durable_id FROM deliveries WHERE ledger_id IS NULL AND state = 'queued'")
      .map((row) => String(row.target_durable_id)),
  )
  for (const id of local) if (!sessions.has(id)) sessions.set(id, new Set())
  return [...sessions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([durable_id, devices]) => ({ durable_id, devices: [...devices], local: local.has(durable_id) }))
}

export function commandFor(ctx: StoreContext, request: { readonly ledger_id: string }): string | null {
  const found = ctx.sql.one(["command_id"], "SELECT command_id FROM intake_commands WHERE ledger_id = ?", [request.ledger_id])
  return found === undefined ? null : String(found.command_id)
}

export function openForCommand(
  ctx: StoreContext,
  request: { readonly sender_device: string; readonly command_id: string },
): boolean {
  const prefix = `device:${request.sender_device}/`
  return (
    Number(
      ctx.sql.one(
        ["n"],
        `SELECT COUNT(*) AS n FROM intake_commands c JOIN deliveries d ON d.ledger_id = c.ledger_id
         WHERE c.command_id = ? AND substr(c.ledger_id, 1, length(?)) = ? AND d.state IN ${OPEN_STATES}`,
        [request.command_id, prefix, prefix],
      )?.n ?? 0,
    ) > 0
  )
}
