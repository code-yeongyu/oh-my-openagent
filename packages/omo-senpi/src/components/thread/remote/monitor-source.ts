import { remoteMonitorTarget } from "../../../extension/senpi-seams"
import type { RpcRemoteHandlers, RpcRemoteRow, RpcRemoteSource, RpcRemoteState } from "../../../extension/types"
import type { ThreadResolveResult } from "../addressing"
import type { MonitorTargetResolution } from "../tools/monitor-target"
import { rowThreadId, type JsonObject, type RemoteSessionRow, type RemoteSessionState, type RemoteThreadSurface } from "./ports"
import { threadToolFailure } from "../errors"
import { deviceRefusal, listedDevices, remoteAvailable } from "./remote-ops"

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
      if (target.session === "*") return await openDevice(remote, target.device, handlers)
      return await openSession(remote, target.device, target.session, options.resumeFrom, handlers)
    },
  }
}

const KEEP: MonitorTargetResolution = { kind: "keep" }

/**
 * The online account device a `<device>/<thread>` target names (#14294): by id, else by the name the account lists it
 * under, where two devices of that name are ambiguous_target. Unknown and offline devices answer as deviceOnline does.
 */
async function deviceNamed(remote: RemoteThreadSurface, name: string): Promise<MonitorTargetResolution | string> {
  const listed = await listedDevices(remote.client, name)
  if ("kind" in listed) return { kind: "refused", failure: listed.error }
  const named = listed.devices.some((candidate) => candidate.device === name)
    ? [name]
    : listed.devices.filter((candidate) => candidate.label === name).map((candidate) => candidate.device)
  if (named.length > 1)
    return {
      kind: "refused",
      failure: threadToolFailure(
        "ambiguous_target",
        `${named.length} devices on this account are named ${name}.`,
        "Name the device by its id (<device id>/<thread>); thread_list with all_scope shows each device's id.",
        { device: name, candidates: named },
      ),
    }
  const device = named[0] ?? name
  const refusal = deviceRefusal(listed.devices, device)
  return refusal === undefined ? device : { kind: "refused", failure: refusal.error }
}

// senpi's own local targets (rpc-monitor-targets.ts `parseRpcTarget`): the lineage and account keywords, a task id, and a
// session file path, which no thread address can spell.
const SENPI_LOCAL_TARGET = /^(?:children|all|st_.*)$/
const PATH_LIKE = /[/\\]|\.jsonl$/i

/**
 * What `monitor({type: "rpc", target})` arms (#14294). A bare address is resolved by `resolve`, the resolver every thread
 * tool uses (`resolveAcross`, decision 0027): a thread id, alias, unique name or 8+ character id prefix on any device. The
 * device part of `<device>/<session>` is a device id or the name the account lists it under (`deviceNamed`).
 */
export async function resolveMonitorTarget(
  remote: RemoteThreadSurface | undefined,
  target: string,
  resolve: (address: string) => Promise<ThreadResolveResult>,
): Promise<MonitorTargetResolution> {
  const text = target.trim()
  const armed = async (device: string | undefined, session: string): Promise<MonitorTargetResolution> => {
    let armedTarget = session
    if (device !== undefined) {
      if (remote === undefined) return KEEP
      const named = await deviceNamed(remote, device)
      if (typeof named !== "string") return named
      armedTarget = `${named}/${session}`
    }
    return armedTarget === text ? KEEP : { kind: "target", target: armedTarget }
  }
  if (text === "" || SENPI_LOCAL_TARGET.test(text)) return KEEP
  const onDevice = remoteMonitorTarget(text)
  if (onDevice !== undefined) return await armed(onDevice.device, onDevice.session)
  if (PATH_LIKE.test(text)) return KEEP
  const resolved = await resolve(text)
  if (resolved.kind === "error") {
    const { kind: _kind, ...failure } = resolved
    return { kind: "refused", failure }
  }
  const row = resolved.entry.transport?.kind === "relay" ? resolved.entry.transport.row : undefined
  return row === undefined ? await armed(undefined, resolved.entry.thread_id) : await armed(row.device, rowThreadId(row))
}

async function openSession(
  remote: RemoteThreadSurface,
  device: string,
  label: string,
  resumeFrom: string | undefined,
  handlers: RpcRemoteHandlers,
) {
  const sessionId = await resolveSession(remote, device, label)
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

// `<device>/<alias>`: an alias the registry holds for a session on that device. `<device>/<thread id>`: the durable id
// thread_list and thread_read name it by, mapped to its listing key through the device's rows. Anything else is the
// session's key.
async function resolveSession(remote: RemoteThreadSurface, device: string, address: string): Promise<string> {
  if (remote.aliases !== undefined) {
    const held = await remote.aliases.resolve(address)
    if (held.kind === "ok" && held.value.device === device) return held.value.session_id
  }
  const rows = await remote.sessions.sessions({ device })
  const listed = rows.find((row) => row.device === device && (row.session_id === address || row.durable_id === address))
  return listed?.session_id ?? address
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
