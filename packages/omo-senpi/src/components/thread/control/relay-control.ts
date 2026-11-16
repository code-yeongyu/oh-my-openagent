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

// The engine statuses a turn is still in progress under; anything else (idle, waiting_input, closed, unloaded) ends a wait.
const IN_PROGRESS: ReadonlySet<string> = new Set(["running", "compacting", "opening"])

/**
 * #13417: until the session leaves its running states, on the watch's own events (a baseline `get_state`, then each
 * status change, and a resync after any relay or service gap), bounded by `timeoutMs` and the caller's abort.
 */
async function waitSettled(
  remote: RemoteThreadSurface,
  row: RemoteSessionRow,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ThreadWaitOutcome> {
  const started = Date.now()
  let status = "unknown"
  let finish!: (outcome: ThreadWaitOutcome["outcome"], status: string) => void
  const done = new Promise<ThreadWaitOutcome>((resolve) => {
    let settled = false
    finish = (outcome, at) => {
      if (settled) return
      settled = true
      resolve({ outcome, status: at, waited_ms: Date.now() - started })
    }
  })
  if (signal?.aborted === true) return { outcome: "cancelled", status, waited_ms: 0 }
  const observe = (next: string) => {
    status = next
    if (!IN_PROGRESS.has(next)) finish("settled", next)
  }
  const watched = await remote.sessions.watch(
    row.device,
    row.session_id,
    {
      record: () => {},
      status: (change) => observe(change.to),
      resynced: (resync) => observe(resync.state.status),
    },
    { baseline: true },
  )
  if (watched.kind !== "ok") throw new ControlRefusal(outcomeFailure(watched, row.device).error)
  const { watch } = watched
  const onAbort = () => finish("cancelled", status)
  signal?.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(() => finish("timeout", status), timeoutMs)
  void watch.ended.then((end) =>
    finish(end === "session_closed" ? "settled" : "ended", end === "session_closed" ? "closed" : end),
  )
  observe(watch.initial?.status ?? status)
  try {
    return await done
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
    watch.stop()
  }
}
