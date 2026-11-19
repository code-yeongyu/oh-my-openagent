import { formatAddress } from "@oh-my-opencode/thread-address-core"
import { remoteMonitorTarget } from "../../../extension/senpi-seams"
import type { RpcRemoteHandlers, RpcRemoteRow, RpcRemoteSource, RpcRemoteState } from "../../../extension/types"
import { asFailure, resolveAddress, resolveTypedDevice, type Resolved, type ThreadRefusal } from "../address"
import type { MonitorTargetResolution } from "../tools/monitor-target"
import { UNKNOWN_CALLER } from "../tools/ports"
import type { JsonObject, RemoteSessionRow, RemoteSessionState, RemoteThreadSurface } from "./ports"
import { remoteAvailable } from "./remote-ops"

// A device-wide target reads the account listing (running | idle | ended rows), round by round at senpi's own rescan
// cadence (RPC_RESCAN_MS): coarse, and enough to wake. A session's content needs a session target.
const LISTING_ROUND_MS = 30_000
const LISTED_STATUS: Readonly<Record<string, string>> = { running: "running", idle: "idle", ended: "closed" }

const rowOf = (label: string, state: RemoteSessionState): RpcRemoteRow => ({
  sessionId: label,
  status: state.status,
  ...(state.durableSessionId === undefined ? {} : { durableSessionId: state.durableSessionId }),
})

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
      if (target.session === "*") {
        const device = await resolveTypedDevice(remote.client, target.device)
        if (device.kind === "error") throw new Error(`${device.error.code}: ${device.error.message}`)
        return await openDevice(remote, device.device, handlers)
      }
      const { row } = await sessionOn(remote, target.device, target.session)
      return await openSession(remote, row.device, row.session_id, target.session, options.resumeFrom, handlers)
    },
  }
}

const KEEP: MonitorTargetResolution = { kind: "keep" }

// senpi's own local targets (rpc-monitor-targets.ts `parseRpcTarget`): the lineage and account keywords, a task id, and a
// session file path, which no thread address can spell.
const SENPI_LOCAL_TARGET = /^(?:children|all|st_.*)$/
const PATH_LIKE = /[/\\]|\.jsonl$/i

/**
 * What `monitor({type: "rpc", target})` arms (#14294): the target read by `resolve`, the module's resolver as every thread
 * tool asks it (`resolveAddress` with the device needed online): a bare thread id, alias, unique name or 8+ character id
 * prefix on any device, or `<device>/<thread>` with the device by id, `here`, name or id prefix and the thread among that
 * device's threads. `<device>/*` names a device only. A thread on another device is armed as `<device id>/<thread>`.
 */
export async function resolveMonitorTarget(
  remote: RemoteThreadSurface | undefined,
  target: string,
  resolve: (address: string) => Promise<Resolved | ThreadRefusal>,
): Promise<MonitorTargetResolution> {
  const text = target.trim()
  if (text === "" || SENPI_LOCAL_TARGET.test(text)) return KEEP
  const onDevice = remoteMonitorTarget(text)
  if (onDevice === undefined && PATH_LIKE.test(text)) return KEEP
  // With no account a device-qualified target is senpi's own to read.
  if (onDevice !== undefined && remote === undefined) return KEEP
  let armed: string
  if (onDevice?.session === "*" && remote !== undefined) {
    const device = await resolveTypedDevice(remote.client, onDevice.device)
    if (device.kind === "error") return { kind: "refused", failure: device.error }
    armed = `${device.device}/*`
  } else {
    const resolved = await resolve(text)
    if (resolved.kind === "error") return { kind: "refused", failure: asFailure(resolved) }
    armed = resolved.where.kind === "device" ? resolved.address : resolved.thread
  }
  return armed === text ? KEEP : { kind: "target", target: armed }
}

/**
 * The session a raw `<device>/<thread>` open names (a restored monitor, or a target armed before it was read): the
 * module resolves the device by id, name or prefix, online, and the thread among that device's threads by id, listing
 * key, alias, name or prefix; only an id-shaped thread part reaches the device unlisted.
 */
async function sessionOn(
  remote: RemoteThreadSurface,
  device: string,
  thread: string,
): Promise<{ readonly row: RemoteSessionRow }> {
  const resolved = await resolveAddress(
    { remote, callerWorkspaceRoot: "", local: [], callerId: UNKNOWN_CALLER },
    formatAddress(device, thread),
    { all_scope: true, need: "online" },
  )
  if (resolved.kind === "error") throw new Error(`${resolved.code}: ${resolved.message}`)
  if (resolved.where.kind !== "device")
    throw new Error(`not_found: ${thread} is a session on this device, which a remote watch does not follow.`)
  return { row: resolved.where.row }
}

async function openSession(
  remote: RemoteThreadSurface,
  device: string,
  sessionId: string,
  label: string,
  resumeFrom: string | undefined,
  handlers: RpcRemoteHandlers,
) {
  let durable: string | undefined
  let sawStatusRecord = false
  const watched = await remote.sessions.watch(
    device,
    sessionId,
    {
      // The remote engine names its session by its own routing id (`rpc-1`); senpi keys a watch's lines and rows by
      // the target it armed, so every record carries that label, or its status would read `unknown -> ...` and the
      // next resync would report the engine's id as gone.
      record: (record) => {
        if (record["type"] === "session_status") sawStatusRecord = true
        handlers.record({ ...record, sessionId: label })
      },
      // A relay before #12719 forwards no session_status record; the watch reads the status off the run's lifecycle, and
      // senpi gets the record it would have had.
      status: (change) => {
        if (!change.derived || sawStatusRecord) return
        const record: JsonObject = {
          type: "session_status",
          sessionId: label,
          status: change.to,
          ...(durable === undefined ? {} : { durableSessionId: durable }),
          lastChange: { cause: change.cause ?? "lifecycle", by: "agent" },
        }
        handlers.record(record)
      },
      resynced: (resync) => {
        durable = resync.state.durableSessionId ?? durable
        handlers.resynced({
          rows: [rowOf(label, resync.state)],
          settledTurns: resync.settledTurns.map((turnId) => ({ sessionId: label, turnId })),
        })
        handlers.cursor?.(resync.state.currentTurnId ?? "")
      },
      lost: (reason) => handlers.lost(reason),
    },
    { baseline: true },
  )
  if (watched.kind !== "ok") throw new Error(watched.reason)
  const { initial } = watched.watch
  if (initial === undefined) {
    watched.watch.stop()
    throw new Error("state_unread")
  }
  durable = initial.durableSessionId
  void watched.watch.ended.then((end) => {
    if (end !== "stopped") handlers.ended(end.startsWith("access:") ? end.slice("access:".length) : end)
  })
  // The cursor is the turn that was running: a restored monitor whose turn is no longer running reports it settled.
  const resumed =
    resumeFrom !== undefined &&
    resumeFrom !== "" &&
    !(initial.status === "running" && initial.currentTurnId === resumeFrom)
      ? [{ sessionId: label, turnId: resumeFrom }]
      : []
  const state: RpcRemoteState = {
    rows: [rowOf(label, initial)],
    settledTurns: resumed,
    cursor: initial.currentTurnId ?? "",
  }
  return { initial: state, stop: watched.watch.stop }
}

async function openDevice(remote: RemoteThreadSurface, device: string, handlers: RpcRemoteHandlers) {
  const rowsOf = (rows: readonly RemoteSessionRow[]): RpcRemoteRow[] =>
    rows
      .filter((row) => row.device === device)
      .map((row) => ({ sessionId: row.session_id, status: LISTED_STATUS[row.state] ?? row.state }))
  let known = new Map(rowsOf(await remote.sessions.sessions()).map((row) => [row.sessionId, row.status]))
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
    else
      for (const row of rows)
        if (known.get(row.sessionId) !== row.status)
          handlers.record({
            type: "session_status",
            sessionId: row.sessionId,
            status: row.status,
            lastChange: { cause: "listing", by: "device" },
          })
    lost = false
    known = new Map(rows.map((row) => [row.sessionId, row.status]))
  }
  // One round at a time: a listing slower than the cadence skips a tick instead of overlapping. A handler that throws
  // ends this monitor (senpi settles it) instead of escaping as an unhandled rejection.
  let inRound = false
  const tick = (): void => {
    if (inRound) return
    inRound = true
    round().then(
      () => {
        inRound = false
      },
      (error: unknown) => {
        clearInterval(timer)
        handlers.ended(`listener_failed: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
  }
  const timer = setInterval(tick, LISTING_ROUND_MS)
  timer.unref?.()
  return {
    initial: { rows: [...known].map(([sessionId, status]) => ({ sessionId, status })) },
    stop: () => clearInterval(timer),
  }
}
