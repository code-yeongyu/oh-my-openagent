import {
  deviceLabel,
  deviceListing,
  devicesSilent,
  normalizeName,
  resolveDevice,
  THREAD_ID_SHAPE,
  type AddressRefusal,
  type DeviceRef,
} from "@oh-my-opencode/thread-address-core"
import { type ClientCore, ok, type RemoteClient } from "./client"
import { DEADLINES } from "./deadlines"
import { nextActionFor, remoteFailure } from "./codes"
import { canonicalizeThreadHandle, handleOf, type CanonicalThread } from "./seams"
import type { DeviceRow, Opts, RemoteFailure, Scope, SessionRow } from "./types"

/** What is left of one call's deadline, a stage's own table default capping its share. */
export type Stage = (capMs?: number) => Opts

/**
 * One deadline for a whole call (#13756 L3): its clock starts once, and each stage (the roster, the listing, the member)
 * runs under what is left of it.
 */
export const budget = (timers: ClientCore["timers"], opts: Opts | undefined, totalMs: number): Stage => {
  const end = timers.now() + (opts?.deadlineMs ?? totalMs)
  return (capMs) => {
    const left = Math.max(1, end - timers.now())
    return {
      ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
      deadlineMs: capMs === undefined ? left : Math.min(capMs, left),
    }
  }
}

type Match =
  { readonly kind: "one"; readonly row: SessionRow } | { readonly kind: "many"; readonly rows: readonly SessionRow[] }

// A name match is held to the caller's workspace unless all_scope; an id or `<device>/<session>` names one session
// account-wide, as on this device (thread/addressing.ts).
const inScope = (row: SessionRow, scope: Scope): boolean =>
  scope.all_scope === true || scope.workspace === undefined || row.project === scope.workspace

const sessionOn = (row: SessionRow, device: string, session: string): boolean =>
  row.durable_id === session || row.thread === handleOf(device, session)

const picked = (found: readonly SessionRow[]): Match | undefined => {
  const [only] = found
  if (only === undefined) return undefined
  return found.length === 1 ? { kind: "one", row: only } : { kind: "many", rows: found }
}

/** The cache answer that costs no relist (contract L-1): a known id, or a handle whose device part is written as an id. */
function cached(index: readonly SessionRow[], target: CanonicalThread): SessionRow | undefined {
  const t = target.target
  const found =
    t.kind === "device_session"
      ? index.filter(
          (row) => row.thread === target.handle || (row.device.id === t.device && sessionOn(row, t.device, t.session)),
        )
      : index.filter((row) => row.durable_id === t.address || row.thread === t.address)
  const [only] = found
  return found.length === 1 ? only : undefined
}

function match(rows: readonly SessionRow[], target: CanonicalThread, device: string | undefined): Match | undefined {
  const t = target.target
  if (t.kind === "device_session") {
    if (device === undefined) return undefined
    return picked(rows.filter((row) => sessionOn(row, device, t.session)))
  }
  const byId = picked(rows.filter((row) => row.durable_id === t.address || row.thread === t.address))
  if (byId !== undefined) return byId
  const wanted = normalizeName(t.address)
  return picked(rows.filter((row) => inScope(row, target.scope) && normalizeName(row.name) === wanted))
}

const ambiguous = (address: string, rows: readonly SessionRow[]): RemoteFailure =>
  remoteFailure(
    "ambiguous_target",
    `${rows.length} sessions answer to ${address}.`,
    "Pass the thread handle of one of them.",
    {
      details: { candidates: rows.map((row) => ({ thread: row.thread, name: row.name, device: row.device.name })) },
    },
  )

const deviceRefusal = (refusal: AddressRefusal): RemoteFailure => {
  switch (refusal.reason) {
    case "no_device":
      return remoteFailure(
        refusal.code,
        `No device of this account answers to ${refusal.typed}.`,
        nextActionFor(refusal.code),
        // sessions.list({ device }) answers { kind, id } for the same miss (unknown-device.ts); the core's fields are added.
        { details: { ...refusal.details, id: refusal.typed } },
      )
    case "devices_share_name":
    case "devices_share_prefix":
      return remoteFailure(
        refusal.code,
        `${refusal.details.candidates.length} devices answer to ${refusal.typed}; pass the device id.`,
        nextActionFor(refusal.code),
        { details: refusal.details },
      )
    default:
      return remoteFailure(
        refusal.code,
        "The device part does not name one device of this account.",
        nextActionFor(refusal.code),
        {
          details: refusal.details,
        },
      )
  }
}

// An unmatched session part of a device-qualified address passes to its device only when id-shaped: a thread id, a
// routing id, or a listing key the listing does not show yet (#13748). It is the rule the address module applies (core
// idShaped); this local copy switches to the core's export when the thread-tools PR lands it.
export const idShapedSession = (text: string): boolean =>
  THREAD_ID_SHAPE.test(text) || /^rpc-\d+$/.test(text) || /^[A-Za-z0-9_-]{22}$/.test(text)

/**
 * A miss while a device the core counts as incomplete this round (deviceListing) did not answer: host_unavailable naming
 * it, never not_found. An offline device is expected to stay silent and keeps the plain miss; undefined then.
 */
export function listingIncomplete(address: string, unanswered: readonly DeviceRow[]): RemoteFailure | undefined {
  const round = { incomplete: unanswered.map((row) => row.id) }
  const silent = unanswered.filter((row) => deviceListing(row.id, round, unanswered) === "incomplete")
  if (silent.length === 0) return undefined
  const refusal = devicesSilent("listing_incomplete", silent)
  return remoteFailure(
    refusal.code,
    `No session of this account answers to ${address} on the devices that answered; ${silent.map((row) => deviceLabel(row)).join(", ")} did not answer this round.`,
    nextActionFor(refusal.code),
    { details: refusal.details },
  )
}

const miss = (address: string, unanswered: readonly DeviceRow[]): RemoteFailure =>
  listingIncomplete(address, unanswered) ??
  remoteFailure("not_found", `No session of this account answers to ${address}.`, nextActionFor("not_found"), {
    details: {
      kind: "session",
      ...(unanswered.length === 0 ? {} : { unanswered: unanswered.map((row) => row.id) }),
    },
  })

// A device the listing names but the roster misses (#13402, unknown-device.ts), as a caller sees it: the row sessions.list
// shows for it (client.ts unlistedDevice), offline, so one device never reads online in one answer and offline in
// another. The core resolver alone sees it online, which only passes it through the need-online gate.
const listingNamed = (id: string): DeviceRow => ({
  id,
  name: id,
  kind: "unknown",
  platform: "unknown",
  online: false,
  last_seen_ms: null,
  caps: { attach: true, machine: false, control: false },
})

/**
 * The core's device resolver (id > here > name by normalizeName > unique 6+ id prefix) over the devices this account
 * knows: the roster (one devices.list round), plus a device the roster misses that the listing names, which resolves by
 * its exact id only (#13402: the listing asked for that id answers rows or a round state, not not_found{device}).
 * `row` is the device's row: the roster's, or the listing-named one.
 */
export async function resolveRemoteDevice(
  core: ClientCore,
  text: string,
  stage: Stage,
): Promise<
  { readonly kind: "ok"; readonly value: { readonly ref: DeviceRef; readonly row: DeviceRow } } | RemoteFailure
> {
  const roster = await core.devicesList(stage(DEADLINES.devices))
  if (roster.kind === "error") return roster
  const here = roster.value.find((row) => row.self === true)?.id
  // What the core resolver sees: the roster, plus the listing-named device when one is added, online so it resolves.
  const over = (named: readonly { readonly id: string; readonly name: string; readonly online: true }[]) =>
    resolveDevice(
      { here: here === undefined || here === "local" ? null : here, devices: [...roster.value, ...named] },
      text,
      {
        online: false,
      },
    )
  // The caller's row: the roster's, or (the one device the roster has no row for) the listing-named device's.
  const answer = (resolved: ReturnType<typeof over>) =>
    resolved.kind === "ok"
      ? ok({
          ref: resolved.device,
          row: roster.value.find((row) => row.id === resolved.device.id) ?? listingNamed(resolved.device.id),
        })
      : deviceRefusal(resolved.refusal)
  const first = over([])
  if (first.kind === "ok" || first.refusal.reason !== "no_device") return answer(first)
  const named = await core.sessionsList({ device: text }, stage(DEADLINES.sessionsList))
  if (named.kind === "error") return named.code === "not_found" ? answer(first) : named
  return answer(over([{ id: text, name: text, online: true }]))
}

/**
 * `sessions.resolve` (unit U5 of #13414): one address (durable id, name, `<device>/<session>`) to its row, served from
 * the last listing this client read, so a known id or handle costs no relist (contract L-1); a name always reads a fresh
 * listing, since another session may have taken it since. The device part goes through the core's resolver (id > here >
 * name by normalizeName > unique 6+ id prefix); names compare by normalizeName only. A miss reads the listing once:
 * filtered to the device when the address names one, else account-wide, and that read becomes the index; a miss while a
 * device the core counts as incomplete is host_unavailable, never not_found. Aliases are `aliases.resolve`'s; whether a
 * session is still live is learned from the reply to the command sent to it.
 */
export function resolveMember(core: ClientCore): RemoteClient["sessions"]["resolve"] {
  let index: readonly SessionRow[] = []
  const remember = (rows: readonly SessionRow[], device: string | undefined) => {
    index = device === undefined ? rows : [...index.filter((row) => row.device.id !== device), ...rows]
  }
  return async (address, scope = {}, opts) => {
    const canonical = canonicalizeThreadHandle(address, scope)
    if (canonical.kind === "error") return canonical
    const target = canonical.value
    const hit = cached(index, target)
    if (hit !== undefined) return { kind: "ok", value: hit }
    const stage = budget(core.timers, opts, DEADLINES.devices + DEADLINES.sessionsList)
    if (target.target.kind !== "device_session") {
      const listed = await core.sessionsList(undefined, stage(DEADLINES.sessionsList))
      if (listed.kind === "error") return listed
      remember(listed.value.rows, undefined)
      const found = match(listed.value.rows, target, undefined)
      if (found?.kind === "one") return { kind: "ok", value: found.row }
      if (found?.kind === "many") return ambiguous(address, found.rows)
      return miss(address, listed.value.unanswered)
    }
    const device = await resolveRemoteDevice(core, target.target.device, stage)
    if (device.kind === "error") return device
    const deviceId = device.value.ref.id
    const listed = await core.sessionsList({ device: deviceId }, stage(DEADLINES.sessionsList))
    if (listed.kind === "error") return listed
    remember(listed.value.rows, deviceId)
    const found = match(listed.value.rows, target, deviceId)
    if (found?.kind === "one") return { kind: "ok", value: found.row }
    if (found?.kind === "many") return ambiguous(address, found.rows)
    // Only the named device could hold it: another device's silence says nothing about this miss.
    return miss(
      address,
      listed.value.unanswered.filter((row) => row.id === deviceId),
    )
  }
}
