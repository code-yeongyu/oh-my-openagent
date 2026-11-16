import type { ThreadWaitOutcome } from "../contracts"
import type { ThreadTranscriptEntry } from "../reader"
import { relayAddressEntry } from "../remote/address-book"
import { rowThreadId } from "../remote/ports"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "../remote/ports"
import { outcomeFailure } from "../remote/outcome"
import { replyData } from "../remote/remote-ops"
import type { ModelChoice } from "../tools/model-match"
import { closeLadder, SESSION_GONE, type RecordAnswer } from "./close-ladder"
import { ControlRefusal, refuse, type SessionControl } from "./port"

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const modelsOf = (value: unknown): ModelChoice[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        if (!isObject(entry)) return []
        const { provider, id, name } = entry
        return typeof provider === "string" && typeof id === "string"
          ? [{ provider, id, ...(typeof name === "string" ? { name } : {}) }]
          : []
      })
    : []

const THINKING_LEVEL_UNSUPPORTED =
  /^(thinking_level_unsupported|Thinking level .+ is not supported by the active model\.$)/

/**
 * A thread on another device of the account, controlled through the engine records its device service relays
 * (`sessionCommand`): the same records this device's endpoint takes, so each answer maps to the same result. The
 * caller has already found the device online (`locateControl`); a device that goes away in between refuses typed.
 */
export function createRelayControl(
  remote: RemoteThreadSurface,
  row: RemoteSessionRow,
): SessionControl & Required<Pick<SessionControl, "waitSettled">> {
  const { device, session_id: sessionId } = row
  const commandOutcome = async (rpc: JsonObject, options?: { readonly fresh?: boolean }) => {
    const outcome = await remote.sessions.sessionCommand(device, sessionId, { ...rpc, sessionId }, options)
    if (outcome.kind !== "ok") throw new ControlRefusal(outcomeFailure(outcome, device).error)
    return outcome
  }
  const command = async (rpc: JsonObject, options?: { readonly fresh?: boolean }): Promise<JsonObject> =>
    replyData((await commandOutcome(rpc, options)).response)
  const answer = async (rpc: JsonObject): Promise<RecordAnswer> => {
    const outcome = await remote.sessions.sessionCommand(device, sessionId, rpc)
    if (outcome.kind === "refused" && SESSION_GONE.has(outcome.reason)) return { kind: "gone", reason: outcome.reason }
    if (outcome.kind !== "ok") throw new ControlRefusal(outcomeFailure(outcome, device).error)
    return { kind: "ok", data: replyData(outcome.response) }
  }
  return {
    thread_id: rowThreadId(row),
    device,
    title: row.title,
    visible: async () => {
      try {
        return (await remote.sessions.sessions())
          .filter((entry) => entry.device === device)
          .map((entry) => relayAddressEntry(entry))
      } catch (error) {
        throw refuse(
          "host_unavailable",
          "The target device's thread names could not be listed.",
          "Retry when the device service is reachable.",
          { device, reason: error instanceof Error ? error.message : String(error) },
        )
      }
    },
    interrupt: async (turnId) => {
      const reply = await command({ type: "interrupt", ...(turnId === undefined ? {} : { turnId }) })
      const reported = reply["turnId"]
      return {
        interrupted: reply["interrupted"] === true,
        ...(typeof reported === "string" ? { turn_id: reported } : {}),
      }
    },
    close: async () => {
      try {
        return await closeLadder(sessionId, answer)
      } catch (error) {
        throw error instanceof ControlRefusal
          ? new ControlRefusal({ ...error.failure, details: { device, ...error.failure.details } })
          : error
      }
    },
    setName: async (name) => {
      await command({ type: "set_session_name", name })
    },
    getAvailableModels: async (options) => {
      const outcome = await commandOutcome({ type: "get_available_models" }, options)
      return { models: modelsOf(replyData(outcome.response)["models"]), held: outcome.local === true }
    },
    setModel: async (provider, id) => {
      const reply = await command({ type: "set_model", provider, modelId: id })
      const confirmedProvider = reply["provider"]
      const confirmedId = reply["id"]
      return {
        provider: typeof confirmedProvider === "string" ? confirmedProvider : provider,
        id: typeof confirmedId === "string" ? confirmedId : id,
      }
    },
    getAvailableThinkingLevels: async () => {
      const levels = (await command({ type: "get_available_thinking_levels" }))["levels"]
      return Array.isArray(levels) ? levels.filter((level): level is string => typeof level === "string") : []
    },
    setThinkingLevel: async (level, scope) => {
      const outcome = await remote.sessions.sessionCommand(device, sessionId, {
        type: "set_thinking_level",
        sessionId,
        level,
        ...(scope === "turn" ? { scope } : {}),
      })
      if (outcome.kind === "refused" && THINKING_LEVEL_UNSUPPORTED.test(outcome.reason))
        throw refuse(
          "thinking_level_unsupported",
          `Thinking level ${level} is not supported by the active model.`,
          "Choose a level from the supported list and retry.",
          { device, level },
        )
      if (outcome.kind !== "ok") throw new ControlRefusal(outcomeFailure(outcome, device).error)
    },
    getMessages: async () => {
      const listed = (await command({ type: "get_messages" }))["messages"]
      return Array.isArray(listed) ? (listed as ThreadTranscriptEntry[]) : []
    },
    waitSettled: (timeoutMs, signal) => waitSettled(remote, row, timeoutMs, signal),
  }
}

// The engine statuses a turn is still in progress under; anything else (idle, waiting_input, closed, unloaded) ends one.
const IN_PROGRESS: ReadonlySet<string> = new Set(["running", "compacting", "opening"])

// How long a wait that has seen no run at all keeps listening before it settles on the session's idle status. A
// snapshot's idle is not a turn end: a run a send just started read isStreaming false for 17 s on the relay, so the
// wait gives the run's own records this long to show up before it believes the idle.
const QUIET_MS = 3_000

const turnOf = (record: JsonObject): string | undefined =>
  typeof record["turnId"] === "string" && record["turnId"] !== "" ? record["turnId"] : undefined

/**
 * #13417: until a turn end is OBSERVED on the watch (the run's `agent_settled`, a running -> not-running status
 * change, or a resync that reports a turn settled while the watch was away), bounded by `timeoutMs` and the caller's
 * abort. A session that shows no run within QUIET_MS settles on its idle status, with no `turn_id`.
 */
async function waitSettled(
  remote: RemoteThreadSurface,
  row: RemoteSessionRow,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ThreadWaitOutcome> {
  const started = Date.now()
  let status = "unknown"
  let running = false
  // A live event is newer than the baseline read: once one arrived, the baseline never overrides it.
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
  const watching = remote.sessions.watch(
    row.device,
    row.session_id,
    {
      record: (record) => {
        live = true
        const type = record["type"]
        if (type === "agent_start" || type === "turn_start") runSeen(turnOf(record))
        if (type === "agent_settled") {
          status = record["reason"] === "session_closed" ? "closed" : "idle"
          finish("settled", status, turnOf(record) ?? turn)
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
    },
    { baseline: true },
  )
  const cleanup = () => {
    clearTimeout(timer)
    clearTimeout(quiet)
    signal?.removeEventListener("abort", onAbort)
  }
  const first = await Promise.race([watching, done])
  if (!("kind" in first)) {
    // The wait ended before the attach answered: a watch that opens later is stopped at once.
    cleanup()
    void watching.then((late) => {
      if (late.kind === "ok") late.watch.stop()
    })
    return first
  }
  if (first.kind !== "ok") {
    cleanup()
    throw new ControlRefusal(outcomeFailure(first, row.device).error)
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
