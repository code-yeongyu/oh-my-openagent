import {
  deviceLabel,
  deviceListing,
  deviceOffline,
  devicesSilent,
  matchThread,
  resolveDevice,
  type AddressRefusal,
  type DeviceRef,
  type LadderMatch,
  type LadderView,
} from "@oh-my-opencode/thread-address-core"
import { type ClientCore, listingNamedDevice, ok, type Outcome, type RemoteClient } from "./client"
import { DEADLINES } from "./deadlines"
import { nextActionFor, remoteFailure } from "./codes"
import { canonicalizeThreadHandle, type CanonicalThread } from "./seams"
import type { DeviceRow, Opts, RemoteFailure, Scope, SessionRow, SessionsList } from "./types"

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

// A name match is held to the caller's workspace unless all_scope; an id or `<device>/<session>` names one session
// account-wide, as on this device (thread/addressing.ts).
const inScope = (row: SessionRow, scope: Scope): boolean =>
  scope.all_scope === true || scope.workspace === undefined || row.project === scope.workspace

/**
 * A row as the core's thread-part ladder reads it (thread-address-core matchThread, the one the thread tools run): its
 * durable id, its listing key (and its handle), the alias it was found to hold, and its own name; a fallback name
 * (`unnamed`) is no address.
 */
const viewOf =
  (alias?: { readonly name: string; readonly thread: string }) =>
  (row: SessionRow): LadderView => ({
    id: row.durable_id ?? "",
    keys: [row.thread.slice(row.device.id.length + 1), row.thread],
    ...(alias !== undefined && alias.thread === row.thread ? { aliases: [alias.name] } : {}),
    name: row.unnamed === true ? "" : row.name,
  })

type Match = LadderMatch<SessionRow>

const exact = (found: Match): SessionRow | undefined =>
  found.kind === "one" && (found.step === "id" || found.step === "session_id") ? found.entry : undefined

/** The cache answer that costs no relist (contract L-1): a known id or listing key, or a handle whose device part is an id. */
function cached(index: readonly SessionRow[], target: CanonicalThread): SessionRow | undefined {
  const t = target.target
  return t.kind === "device_session"
    ? exact(
        matchThread(
          index.filter((row) => row.device.id === t.device),
          t.session,
          { view: viewOf(), idPrefix: false },
        ),
      )
    : exact(matchThread(index, t.address, { view: viewOf(), idPrefix: false }))
}

/**
 * The core's ladder over the listed rows: exact id > listing key > alias > name > unique 8+ hex id prefix. A bare
 * address reads every row, names held to the caller's scope; a device's thread part reads that device's rows only,
 * every name in reach. The alias holder (`aliases.resolve`, asked only when no id or key answers) is a row it names.
 */
function match(
  rows: readonly SessionRow[],
  text: string,
  scope: Scope | undefined,
  alias?: { readonly name: string; readonly thread: string },
): Match {
  return matchThread(rows, text, {
    view: viewOf(alias),
    ...(scope === undefined ? {} : { named: (row: SessionRow) => inScope(row, scope) }),
  })
}

const ambiguous = (address: string, rows: readonly SessionRow[]): RemoteFailure =>
  remoteFailure(
    "ambiguous_target",
    `${rows.length} sessions answer to ${address}.`,
    "Pass the thread handle of one of them.",
    {
      details: {
        candidates: rows.map((row) => ({
          thread: row.thread,
          name: row.name,
          ...(row.unnamed === true ? { unnamed: true } : {}),
          device: row.device.name,
        })),
      },
    },
  )

export const deviceRefusal = (refusal: AddressRefusal): RemoteFailure => {
  switch (refusal.reason) {
    case "no_device":
      return remoteFailure(
        refusal.code,
        `No device of this account answers to ${refusal.typed}.`,
        nextActionFor(refusal.code),
        // sessions.list({ device }) answers { kind, id } for the same miss (unknown-device.ts); the core's fields are added.
        { details: { ...refusal.details, id: refusal.typed } },
      )
    case "device_offline":
      return remoteFailure(
        refusal.code,
        `${deviceLabel({ id: refusal.details.device, name: refusal.details.device_name })} is offline; what its listing does not show cannot be asked of it.`,
        nextActionFor(refusal.code),
        { details: refusal.details },
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
  | {
      readonly kind: "ok"
      readonly value: {
        readonly ref: DeviceRef
        readonly row: DeviceRow
        /** The device's listing, when resolving it read one (a listing-named device): the caller reads no second. */
        readonly listed?: SessionsList
      }
    }
  | RemoteFailure
> {
  const roster = await core.devicesList(stage(DEADLINES.devices))
  if (roster.kind === "error") return roster
  const here = roster.value.find((row) => row.self === true)?.id
  // What the core resolver sees: the roster, plus the listing-named device when one is added. It answered the listing
  // round, so it is not known offline and passes the need-online gate; the row a caller sees is listingNamedDevice's.
  const over = (named: readonly { readonly id: string; readonly name: string; readonly online: true }[]) =>
    resolveDevice(
      { here: here === undefined || here === "local" ? null : here, devices: [...roster.value, ...named] },
      text,
      {
        online: false,
      },
    )
  // The caller's row: the roster's, or (the one device the roster has no row for) the listing-named device's.
  const answer = (resolved: ReturnType<typeof over>, listed?: SessionsList) =>
    resolved.kind === "ok"
      ? ok({
          ref: resolved.device,
          row: roster.value.find((row) => row.id === resolved.device.id) ?? listingNamedDevice(resolved.device.id),
          ...(listed === undefined ? {} : { listed }),
        })
      : deviceRefusal(resolved.refusal)
  const first = over([])
  if (first.kind === "ok" || first.refusal.reason !== "no_device") return answer(first)
  const named = await core.sessionsList({ device: text }, stage(DEADLINES.sessionsList))
  if (named.kind === "error") return named.code === "not_found" ? answer(first) : named
  return answer(over([{ id: text, name: text, online: true }]), named.value)
}

type AliasHolder = { readonly name: string; readonly thread: string }

/**
 * The account alias `text` names, as `aliases.resolve` answers it: the holder's handle. The registry's own refusals (no
 * such alias, no registry) leave the address to the rest of the ladder; a holder whose device's listing cannot show it
 * (listing_incomplete, device_offline) is what a miss answers.
 */
async function aliasHolder(
  core: ClientCore,
  text: string,
  stage: Stage,
): Promise<AliasHolder | RemoteFailure | undefined> {
  const held = await core.self().aliases.resolve(text, stage(DEADLINES.aliases))
  if (held.kind === "ok") return { name: text, thread: held.value }
  const fromListing = held.details?.["alias_code"] === undefined
  return fromListing && (held.code === "host_unavailable" || held.code === "device_offline") ? held : undefined
}

/**
 * `sessions.resolve` (unit U5 of #13414): one address to its row, by the rules every omo surface resolves a thread
 * address by (#14305): the device part through the core's device resolver (id > here > name by normalizeName > unique
 * 6+ id prefix), the thread part through the core's thread ladder (exact id > listing key > account alias > name >
 * unique 8+ hex id prefix; matchThread, as the thread tools run it). A known id or listing key is served from the last
 * listing this client read (contract L-1); anything else reads a fresh listing, since another session may have taken a
 * name since, and asks the alias registry once when no id or key answers. A miss reads the listing once: filtered to
 * the device when the address names one, else account-wide, and that read becomes the index. A miss while a device the
 * core counts as incomplete is host_unavailable, never not_found; a miss on an offline device is device_offline. Two
 * rows that answer at one step (one thread id listed by two devices) are ambiguous_target. Whether a session is still
 * live is learned from the reply to the command sent to it.
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
    // The ladder over `rows`, the alias registry asked only when no exact id or key answers.
    const resolveIn = async (
      rows: readonly SessionRow[],
      text: string,
      named: Scope | undefined,
      onMiss: () => RemoteFailure,
    ): Promise<Outcome<SessionRow>> => {
      let found = match(rows, text, named)
      let aliasMiss: RemoteFailure | undefined
      if (found.kind === "none" || (found.step !== "id" && found.step !== "session_id")) {
        const alias = await aliasHolder(core, text, stage)
        if (alias !== undefined && "kind" in alias) aliasMiss = alias
        else if (alias !== undefined) {
          const aliased = match(rows, text, named, alias)
          if (aliased.kind !== "none" && aliased.step === "alias") found = aliased
        }
      }
      if (found.kind === "one") return ok(found.entry)
      if (found.kind === "many") return ambiguous(address, found.entries)
      return aliasMiss ?? onMiss()
    }
    if (target.target.kind !== "device_session") {
      const listed = await core.sessionsList(undefined, stage(DEADLINES.sessionsList))
      if (listed.kind === "error") return listed
      remember(listed.value.rows, undefined)
      const unanswered = listed.value.unanswered
      return await resolveIn(listed.value.rows, target.target.address, target.scope, () => miss(address, unanswered))
    }
    const typedDevice = target.target.device
    const device = await resolveRemoteDevice(core, typedDevice, stage)
    if (device.kind === "error") return device
    const { ref, row: deviceRow } = device.value
    const listed =
      device.value.listed !== undefined
        ? ok(device.value.listed)
        : await core.sessionsList({ device: ref.id }, stage(DEADLINES.sessionsList))
    if (listed.kind === "error") return listed
    remember(listed.value.rows, ref.id)
    const unanswered = listed.value.unanswered
    return await resolveIn(
      listed.value.rows.filter((row) => row.device.id === ref.id),
      target.target.session,
      undefined,
      () =>
        // An offline device cannot answer for what its rows do not hold; only the named device could hold it, so
        // another device's silence says nothing about this miss.
        ref.online
          ? miss(
              address,
              unanswered.filter((row) => row.id === ref.id),
            )
          : deviceRefusal(deviceOffline(typedDevice, deviceRow, [])),
    )
  }
}
