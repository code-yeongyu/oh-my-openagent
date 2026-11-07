import type { RpcRemoteHandlers, RpcRemoteRow, RpcRemoteSource, RpcRemoteState } from "../../../extension/types"
import type { JsonObject, RemoteSessionRow, RemoteSessionState, RemoteThreadSurface } from "./ports"
import { remoteAvailable } from "./remote-ops"

// A device-wide target reads the account listing (running | idle | ended rows), round by round at senpi's own rescan
// cadence (RPC_RESCAN_MS): coarse, and enough to wake. A session's content needs a session target.
const LISTING_ROUND_MS = 30_000
const LISTED_STATUS: Readonly<Record<string, string>> = { running: "running", idle: "idle", ended: "closed" }

const rowOf = (label: string, state: RemoteSessionState): RpcRemoteRow => ({ sessionId: label, status: state.status, ...(state.durableSessionId === undefined ? {} : { durableSessionId: state.durableSessionId }) })

/**
 * senpi's `RpcRemoteSource` over the thread tools' remote surface: `monitor({type: "rpc", target: "<device>/<session>"})`
 * follows that session through `RemoteSessionsPort.watch`, and `<device>/*` follows the device's listing rows. Every
 * line is senpi's own renderer's; this only turns the watch's callbacks into its records and resyncs.
 */
export function createRemoteMonitorSource(remote: RemoteThreadSurface): RpcRemoteSource {
  return {
    open: async (target, options, handlers) => {
      const unavailable = await remoteAvailable(remote)
      if (unavailable !== undefined) throw new Error(`${unavailable.error.code}: ${unavailable.error.message}`)
      if (target.session === "*") return await openDevice(remote, target.device, handlers)
      return await openSession(remote, target.device, target.session, options.resumeFrom, handlers)
    },
  }
}

async function openSession(remote: RemoteThreadSurface, device: string, label: string, resumeFrom: string | undefined, handlers: RpcRemoteHandlers) {
  const sessionId = await resolveSession(remote, device, label)
  let durable: string | undefined
  let sawStatusRecord = false
  const watched = await remote.sessions.watch(device, sessionId, {
    record: (record) => {
      if (record["type"] === "session_status") sawStatusRecord = true
      handlers.record(record)
    },
    // A relay before #12719 forwards no session_status record; the watch reads the status off the run's lifecycle, and
    // senpi gets the record it would have had.
    status: (change) => {
      if (!change.derived || sawStatusRecord) return
      const record: JsonObject = { type: "session_status", sessionId: label, status: change.to, ...(durable === undefined ? {} : { durableSessionId: durable }), lastChange: { cause: change.cause ?? "lifecycle", by: "agent" } }
      handlers.record(record)
    },
    resynced: (resync) => {
      durable = resync.state.durableSessionId ?? durable
      handlers.resynced({ rows: [rowOf(label, resync.state)], settledTurns: resync.settledTurns.map((turnId) => ({ sessionId: label, turnId })) })
      handlers.cursor?.(resync.state.currentTurnId ?? "")
    },
    lost: (reason) => handlers.lost(reason),
  }, { baseline: true })
  if (watched.kind !== "ok") throw new Error(watched.reason)
  const { initial } = watched.watch
  if (initial === undefined) {
    watched.watch.stop()
    throw new Error("state_unread")
  }
  durable = initial.durableSessionId
  void watched.watch.ended.then((end) => { if (end !== "stopped") handlers.ended(end.startsWith("access:") ? end.slice("access:".length) : end) })
  // The cursor is the turn that was running: a restored monitor whose turn is no longer running reports it settled.
  const resumed = resumeFrom !== undefined && resumeFrom !== "" && !(initial.status === "running" && initial.currentTurnId === resumeFrom) ? [{ sessionId: label, turnId: resumeFrom }] : []
  const state: RpcRemoteState = { rows: [rowOf(label, initial)], settledTurns: resumed, cursor: initial.currentTurnId ?? "" }
  return { initial: state, stop: watched.watch.stop }
}

// `<device>/<alias>`: an alias the registry holds for a session on that device; anything else is the session's key.
async function resolveSession(remote: RemoteThreadSurface, device: string, address: string): Promise<string> {
  if (remote.aliases === undefined) return address
  const held = await remote.aliases.resolve(address)
  return held.kind === "ok" && held.value.device === device ? held.value.session_id : address
}

async function openDevice(remote: RemoteThreadSurface, device: string, handlers: RpcRemoteHandlers) {
  const rowsOf = (rows: readonly RemoteSessionRow[]): RpcRemoteRow[] => rows.filter((row) => row.device === device).map((row) => ({ sessionId: row.session_id, status: LISTED_STATUS[row.state] ?? row.state }))
  let known = new Map((rowsOf(await remote.sessions.sessions())).map((row) => [row.sessionId, row.status]))
  let lost = false
  const round = async (): Promise<void> => {
    let rows: RpcRemoteRow[]
    try {
      rows = rowsOf(await remote.sessions.sessions())
    } catch (error) {
      if (!lost) handlers.lost(error instanceof Error ? error.message : String(error))
      lost = true
      return
    }
    if (lost) handlers.resynced({ rows })
    else for (const row of rows) if (known.get(row.sessionId) !== row.status) handlers.record({ type: "session_status", sessionId: row.sessionId, status: row.status, lastChange: { cause: "listing", by: "device" } })
    lost = false
    known = new Map(rows.map((row) => [row.sessionId, row.status]))
  }
  const timer = setInterval(() => void round(), LISTING_ROUND_MS)
  timer.unref?.()
  return { initial: { rows: [...known].map(([sessionId, status]) => ({ sessionId, status })) }, stop: () => clearInterval(timer) }
}
