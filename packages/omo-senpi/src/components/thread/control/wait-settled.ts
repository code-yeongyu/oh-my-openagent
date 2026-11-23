import type { ThreadWaitOutcome } from "../contracts"
import type { JsonObject, RemoteWatchHandlers } from "../remote/ports"
import type { ControlRefusal } from "./port"

/** What a leg's session watch reports to a wait: each record, each status change, each resync after a gap. */
export type SessionWatchHandlers = Pick<RemoteWatchHandlers, "record" | "status" | "resynced">

/** One session followed until `stop`: the remote watch on another device, the endpoint subscription on this one. */
type SessionWatch = {
  /** Settles once with why the watch ended; `session_closed` is the session leaving for good. */
  readonly ended: Promise<string>
  /** The session's status when the watch started, when the leg read one. */
  readonly initial?: { readonly status: string; readonly currentTurnId?: string }
  readonly stop: () => void
}

export type SessionWatchOutcome =
  { readonly kind: "ok"; readonly watch: SessionWatch } | { readonly kind: "refused"; readonly reason: string }

// The engine statuses a turn is still in progress under; anything else (idle, waiting_input, closed, unloaded) ends one.
const IN_PROGRESS: ReadonlySet<string> = new Set(["running", "compacting", "opening"])

// How long a wait that has seen no run at all keeps listening before it settles on the session's idle status. A
// snapshot's idle is not a turn end: a run a send just started read isStreaming false for 17 s on the relay, so the
// wait gives the run's own records this long to show up before it believes the idle.
const QUIET_MS = 3_000

// The records a run writes while it is under way. Others (agent_idle, entry_appended, thinking_level_changed, ...) also
// arrive on an idle session, so they say nothing about a run.
const RUN_RECORDS: ReadonlySet<string> = new Set([
  "agent_start",
  "turn_start",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "turn_end",
  "agent_end",
  // A retry after a provider error belongs to the run: the session reads idle between attempts.
  "auto_retry_start",
  "auto_retry_end",
])

const turnOf = (record: JsonObject): string | undefined =>
  typeof record["turnId"] === "string" && record["turnId"] !== "" ? record["turnId"] : undefined

/**
 * #13417: until a turn end is OBSERVED on the leg's watch (the run's `agent_settled`, a running -> not-running status
 * change, or a resync that reports a turn settled while the watch was away), bounded by `timeoutMs` and the caller's
 * abort. A session that shows no run within QUIET_MS settles on its idle status, with no `turn_id`. Both legs wait
 * through this one body; only how the watch is opened (`open`) and how its refusal reads (`refused`) differ.
 */
export async function waitForTurnEnd(
  open: (handlers: SessionWatchHandlers) => Promise<SessionWatchOutcome>,
  refused: (reason: string) => ControlRefusal,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ThreadWaitOutcome> {
  const started = Date.now()
  let status = "unknown"
  let running = false
  // A live status (a status change or a resync) is newer than the baseline read: once one arrived, the baseline never
  // overrides it. A content record says nothing about the status, so it leaves the baseline in place.
  let live = false
  let turn: string | undefined
  let finish!: (outcome: ThreadWaitOutcome["outcome"], status: string, turnId?: string) => void
  const done = new Promise<ThreadWaitOutcome>((resolve) => {
    let settled = false
    finish = (outcome, at, turnId) => {
      if (settled) return
      settled = true
      resolve({
        outcome,
        status: at,
        waited_ms: Date.now() - started,
        ...(turnId === undefined ? {} : { turn_id: turnId }),
      })
    }
  })
  if (signal?.aborted === true) return { outcome: "cancelled", status, waited_ms: 0 }
  let quiet: ReturnType<typeof setTimeout> | undefined
  const runSeen = (turnId: string | undefined) => {
    running = true
    turn = turnId ?? turn
    clearTimeout(quiet)
  }
  // The deadline and the abort cover the attach and its baseline read too, not only the wait after them.
  const onAbort = () => finish("cancelled", status, turn)
  signal?.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(() => finish("timeout", status, turn), timeoutMs)
  const watching = open({
    record: (record) => {
      const type = record["type"]
      if (type === "agent_settled") {
        status = record["reason"] === "session_closed" ? "closed" : "idle"
        finish("settled", status, turnOf(record) ?? turn)
      } else if (typeof type === "string" && RUN_RECORDS.has(type)) {
        // The run's own output: its start may predate the attach, whose replayed history only positions the watch.
        runSeen(turnOf(record))
      }
    },
    status: (change) => {
      live = true
      status = change.to
      if (IN_PROGRESS.has(change.to)) runSeen(undefined)
      else if (running || (change.from !== undefined && IN_PROGRESS.has(change.from)))
        finish("settled", change.to, turn)
    },
    resynced: (resync) => {
      live = true
      status = resync.state.status
      const settledTurn = resync.settledTurns.at(-1)
      if (settledTurn !== undefined) finish("settled", status, settledTurn)
      else if (IN_PROGRESS.has(status)) runSeen(resync.state.currentTurnId)
      else if (running) finish("settled", status, turn)
    },
  })
  const cleanup = () => {
    clearTimeout(timer)
    clearTimeout(quiet)
    signal?.removeEventListener("abort", onAbort)
  }
  let first: SessionWatchOutcome | ThreadWaitOutcome
  try {
    first = await Promise.race([watching, done])
  } catch (error) {
    cleanup()
    throw error
  }
  if (!("kind" in first)) {
    // The wait ended before the attach answered: a watch that opens later is stopped at once.
    cleanup()
    void watching.then(
      (late) => {
        if (late.kind === "ok") late.watch.stop()
      },
      () => undefined,
    )
    return first
  }
  if (first.kind !== "ok") {
    cleanup()
    throw refused(first.reason)
  }
  const { watch } = first
  void watch.ended.then((end) =>
    finish(end === "session_closed" ? "settled" : "ended", end === "session_closed" ? "closed" : end, turn),
  )
  const initial = live ? undefined : watch.initial
  if (initial !== undefined) status = initial.status
  if (initial !== undefined && IN_PROGRESS.has(initial.status)) runSeen(initial.currentTurnId)
  else if (!running) quiet = setTimeout(() => finish("settled", status), QUIET_MS)
  try {
    return await done
  } finally {
    cleanup()
    watch.stop()
  }
}
