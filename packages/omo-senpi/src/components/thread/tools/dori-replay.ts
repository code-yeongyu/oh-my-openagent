/**
 * The replay journal of the agent toolkit's layer-2 calls (engine side, loaded only when the `dori`
 * section is on). Every call of a turn gets the next call index, and `["turn", turnId, callIndex]`
 * is claimed before the host op runs: a recorded key returns its result without dispatching, a key
 * recorded for another op stops the call with a typed divergence, and a key claimed by a run that
 * never recorded stops as pending, because re-sending could deliver twice. Keys live seven days.
 */
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { Sql, type SqliteConnection } from "../gateway/sql"
import { TOOLKIT_REPLAY_RETENTION_MS, toolkitReplayKey } from "../../ulw-loop/sdk/dori/replay-key"

export type ReplayStopCode = "toolkit_replay_divergence" | "toolkit_replay_pending" | "turn_context_missing"

export type ReplayStop = {
  readonly kind: "replay_stopped"
  readonly code: ReplayStopCode
  readonly message: string
  readonly key?: string
  readonly recorded_op?: string
  readonly attempted_op?: string
}

export interface DoriReplay {
  run(turnId: string | undefined, op: string, dispatch: () => Promise<unknown>): Promise<unknown>
  close(): void
}

type Claim =
  | { readonly kind: "claimed" }
  | { readonly kind: "recorded"; readonly result: unknown }
  | { readonly kind: "diverged"; readonly recordedOp: string }
  | { readonly kind: "pending" }

const BUSY_TIMEOUT_MS = 5_000
const COUNTED_TURNS_MAX = 512

const SCHEMA = `CREATE TABLE IF NOT EXISTS toolkit_replay (
  replay_key TEXT PRIMARY KEY,
  op TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'recorded')),
  result_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS toolkit_replay_created_at ON toolkit_replay (created_at);`

/** The turn of the calling session: its durable id and the newest assistant entry on the branch, which tool results appended later do not move. */
export function turnIdOf(callerDurableId: string, ectx: unknown): string | undefined {
  const manager = (ectx as { readonly sessionManager?: { readonly getBranch?: () => readonly unknown[] } } | undefined)?.sessionManager
  const branch = typeof manager?.getBranch === "function" ? manager.getBranch() : []
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as { readonly type?: unknown; readonly id?: unknown; readonly message?: { readonly role?: unknown } } | undefined
    if (entry?.type === "message" && entry.message?.role === "assistant" && typeof entry.id === "string" && entry.id.length > 0) return `${callerDurableId}:${entry.id}`
  }
  return undefined
}

function stop(code: ReplayStopCode, message: string, fields: Omit<ReplayStop, "kind" | "code" | "message"> = {}): ReplayStop {
  return { kind: "replay_stopped", code, message, ...fields }
}

function inTransaction<T>(sql: Sql, body: () => T): T {
  sql.exec("BEGIN IMMEDIATE")
  try {
    const value = body()
    sql.exec("COMMIT")
    return value
  } catch (error) {
    sql.exec("ROLLBACK")
    throw error
  }
}

function claim(sql: Sql, key: string, op: string, now: number): Claim {
  return inTransaction(sql, () => {
    sql.run("DELETE FROM toolkit_replay WHERE created_at < ?", [now - TOOLKIT_REPLAY_RETENTION_MS])
    const row = sql.one(["op", "state", "result_json"], "SELECT op, state, result_json FROM toolkit_replay WHERE replay_key = ?", [key])
    if (row === undefined) {
      sql.run("INSERT INTO toolkit_replay (replay_key, op, state, created_at) VALUES (?, ?, 'pending', ?)", [key, op, now])
      return { kind: "claimed" }
    }
    if (row.op !== op) return { kind: "diverged", recordedOp: String(row.op) }
    if (row.state !== "recorded") return { kind: "pending" }
    return { kind: "recorded", result: JSON.parse(String(row.result_json)) as unknown }
  })
}

export async function openDoriReplay(options: { readonly path: string; readonly now?: () => number }): Promise<DoriReplay> {
  mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 })
  const sqlite = await import("node:sqlite")
  const connection = new sqlite.DatabaseSync(options.path, { timeout: BUSY_TIMEOUT_MS }) as unknown as SqliteConnection
  const sql = new Sql(connection)
  sql.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  sql.exec("PRAGMA journal_mode = WAL")
  sql.exec(SCHEMA)
  const now = options.now ?? Date.now
  let closed = false
  const counters = new Map<string, number>()
  const nextIndex = (turnId: string): number => {
    const index = counters.get(turnId) ?? 0
    counters.delete(turnId)
    counters.set(turnId, index + 1)
    if (counters.size > COUNTED_TURNS_MAX) counters.delete(counters.keys().next().value as string)
    return index
  }
  return {
    async run(turnId, op, dispatch) {
      if (turnId === undefined) return stop("turn_context_missing", "The call has no turn to journal it under (no assistant entry on the calling session's branch); it was not run.")
      const key = toolkitReplayKey(turnId, nextIndex(turnId))
      const claimed = claim(sql, key, op, now())
      if (claimed.kind === "recorded") return claimed.result
      if (claimed.kind === "diverged") {
        return stop("toolkit_replay_divergence", `Replayed call ${key} is ${op}, but this turn recorded ${claimed.recordedOp} at that index; the replay stopped without running it.`, { key, recorded_op: claimed.recordedOp, attempted_op: op })
      }
      if (claimed.kind === "pending") {
        return stop("toolkit_replay_pending", `Call ${key} (${op}) was started by an earlier run that never recorded its result; its outcome is unknown, so it was not sent again.`, { key, attempted_op: op })
      }
      let result: unknown
      try {
        result = await dispatch()
      } catch (error) {
        sql.run("DELETE FROM toolkit_replay WHERE replay_key = ? AND state = 'pending'", [key])
        throw error
      }
      sql.run("UPDATE toolkit_replay SET state = 'recorded', result_json = ? WHERE replay_key = ?", [JSON.stringify(result ?? null), key])
      return result
    },
    close() {
      if (closed) return
      closed = true
      connection.close()
    },
  }
}
