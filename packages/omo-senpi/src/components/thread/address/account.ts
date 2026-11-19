import { deviceListing, type DeviceListing } from "@oh-my-opencode/thread-address-core"
import type { RemoteClient, RemoteFailure } from "../../remote"
import type { ThreadToolFailure } from "../errors"
import { remoteReady } from "../remote/remote-ops"
import { deviceListing as oneDeviceListing } from "../remote/address-book"
import type { RemoteDevice, RemoteSessionRow, RemoteThreadSurface } from "../remote/ports"

const LOCAL_ONLY = "local"

/** This device's account id (null with no device service id) and the account's devices, from ONE `devices.list` round. */
export type AccountDevices = { readonly here: string | null; readonly devices: readonly RemoteDevice[] }

/**
 * The account as the thread tools read it, through the one remote client (#13414 4c): the device list names this device
 * on its self row, so "which device am I" and "is that device online" cost one round, never a `thisDevice` plus a
 * `devices` read. A client with no device service lists only its local self row: no id, no other device.
 */
export async function accountDevices(client: RemoteClient): Promise<AccountDevices> {
  const listed = await client.devices.list()
  if (listed.kind === "error") throw new Error(listed.message)
  // With no device service the self row is the placeholder id `local`; a service whose device list omits this device
  // still names it, on a self row of kind `local` that carries the account id.
  const self = listed.value.find((row) => row.self === true)
  const here = self === undefined || self.id === LOCAL_ONLY ? null : self.id
  return {
    here,
    devices: listed.value
      .filter((row) => row.id !== LOCAL_ONLY)
      .map((row) => ({ device: row.id, label: row.name, online: row.online })),
  }
}

// The roster readAccount keeps: accountDevices' rows plus when each device was last seen (a device_offline refusal names
// it). Kept apart from accountDevices because that one ships in omo.js, which has no byte budget left for the field.
async function rosterOf(client: RemoteClient): Promise<readonly RemoteDevice[]> {
  const listed = await client.devices.list()
  if (listed.kind === "error") throw new Error(listed.message)
  return listed.value
    .filter((row) => row.id !== LOCAL_ONLY)
    .map((row) => ({
      device: row.id,
      label: row.name,
      online: row.online,
      ...(typeof row.last_seen_ms === "number" ? { last_seen_ms: row.last_seen_ms } : {}),
    }))
}

/**
 * The listing rows whose device is still on the account: in its roster, or this device (the roster may leave this
 * device out). A removed device's cached rows go (#13505); an offline one keeps its rows. With no roster (`undefined`)
 * nothing can be judged, so every row stays.
 */
export function onAccount(
  rows: readonly RemoteSessionRow[],
  roster: readonly RemoteDevice[] | undefined,
  here: string | null,
): readonly RemoteSessionRow[] {
  if (roster === undefined) return rows
  const listed = new Set(roster.map((row) => row.device))
  return rows.filter((row) => row.device === here || listed.has(row.device))
}

/**
 * The device service state (`connected`, `plan_required`, ...) and this device's account id from the same status
 * round, so a caller that checks the relay needs no device read to know which device it is on.
 */
export async function accountState(
  client: RemoteClient,
): Promise<{ readonly state: string; readonly here: string | null } | RemoteFailure> {
  const status = await client.service.status()
  return status.kind === "error" ? status : { state: status.value.state, here: status.value.device?.id ?? null }
}

/** The account in one read: this device, its roster, the listing rows of devices still on it, each device's listing. */
export type Account = {
  readonly here: string | null
  readonly devices: readonly RemoteDevice[]
  /** The roster as read; undefined when it could not be read (then no row is judged by it). */
  readonly roster: readonly RemoteDevice[] | undefined
  readonly rows: readonly RemoteSessionRow[]
  readonly incomplete: readonly string[]
  readonly listingOf: (device: string) => DeviceListing
  /** The device an earlier round listed `id` on (a thread id or listing key), when that device missed this round. */
  readonly missedHolder: (id: string) => string | undefined
}

/** Device-service states in which no relay is set up for this account: a local address miss stays a local miss. */
const NOT_SET_UP: ReadonlySet<string> = new Set(["not_configured", "disabled", "signed_out", "sign_in_required"])
const notSetUp = (state: unknown): boolean =>
  state === undefined || (typeof state === "string" && NOT_SET_UP.has(state))

export type AccountRead =
  | { readonly kind: "account"; readonly account: Account }
  /** No relay is set up here: every address resolves as on a device with no account. */
  | { readonly kind: "none" }
  /** A configured relay that is failing, or a plan without one: answered before not_found. */
  | { readonly kind: "unavailable"; readonly error: ThreadToolFailure }

// The device each thread id (durable id and listing key) was last listed on, per sessions port, so a thread whose device
// misses one round is still tied to it (#14172). A name is never remembered: names change. Bounded; the id listed longest
// ago leaves first.
const LAST_LISTED_MAX = 4096
const lastListed = new WeakMap<object, Map<string, string>>()

// Updates the memory in place and returns how it read BEFORE this round: only the entries this round overwrote, added or
// evicted are kept aside, so a resolution never copies the whole map.
function remember(port: object, rows: readonly RemoteSessionRow[]): (id: string) => string | undefined {
  const ids = lastListed.get(port) ?? new Map<string, string>()
  lastListed.set(port, ids)
  const before = new Map<string, string | undefined>()
  const keep = (id: string) => {
    if (!before.has(id)) before.set(id, ids.get(id))
  }
  for (const row of rows)
    for (const id of new Set([row.durable_id ?? "", row.session_id])) {
      if (id.length === 0) continue
      keep(id)
      ids.delete(id)
      ids.set(id, row.device)
      const oldest = ids.size > LAST_LISTED_MAX ? ids.keys().next() : undefined
      if (oldest !== undefined && oldest.done !== true) {
        keep(oldest.value)
        ids.delete(oldest.value)
      }
    }
  return (id) => (before.has(id) ? before.get(id) : ids.get(id))
}

/** The status round of a resolution: this device's id, or why the relay cannot be used. */
export type Ready = Awaited<ReturnType<typeof remoteReady>>

/** What a resolution already read and hands in, so it reads each thing once. */
export type AccountReads = {
  /** The resolution's one status round. */
  readonly ready?: Promise<Ready>
  /** The roster as already read (`undefined`: it could not be read). */
  readonly roster?: readonly RemoteDevice[] | undefined
  /** Read only this device's listing (#12709): a device-qualified address never waits on the whole round. */
  readonly device?: string
}

const notReady = (ready: Exclude<Ready, { readonly here: string | null }>): AccountRead =>
  ready.error.code === "host_unavailable" && notSetUp(ready.error.details?.["state"])
    ? { kind: "none" }
    : { kind: "unavailable", error: ready.error }

const rosterRead = (remote: RemoteThreadSurface): Promise<readonly RemoteDevice[] | undefined> =>
  rosterOf(remote.client).then(
    (devices) => devices,
    () => undefined,
  )

/** The account from a roster alone, no listing read: what a resolution on this device's own book needs. */
export function rosterAccount(here: string | null, roster: readonly RemoteDevice[] | undefined): Account {
  const listing = { rows: [], incomplete: [] }
  const online = (roster ?? []).map((device) => ({ id: device.device, online: device.online }))
  return {
    here,
    devices: roster ?? [],
    roster,
    rows: [],
    incomplete: [],
    listingOf: (device) => deviceListing(device, listing, online),
    missedHolder: () => undefined,
  }
}

/** The status round and the roster, no listing: enough to resolve a device part (#12709). */
export async function readRoster(remote: RemoteThreadSurface, ready: Promise<Ready>): Promise<AccountRead> {
  const read = await ready
  if ("kind" in read) return notReady(read)
  return { kind: "account", account: rosterAccount(read.here, await rosterRead(remote)) }
}

/**
 * ONE status read, ONE roster read and ONE listing round (design section 1): this device's id, the account's devices, the
 * listing rows of devices still on it, and how this round listed each device. A roster that cannot be read judges no row
 * (every row stays) and lists every device as the listing names it. `given` hands in what the resolution already read,
 * and `device` narrows the listing to that one device.
 */
export async function readAccount(remote: RemoteThreadSurface, given: AccountReads = {}): Promise<AccountRead> {
  const ready = await (given.ready ?? remoteReady(remote))
  if ("kind" in ready) return notReady(ready)
  const [listing, roster] = await Promise.all([
    given.device !== undefined
      ? oneDeviceListing(remote, given.device)
      : remote.sessions.listing !== undefined
        ? remote.sessions.listing()
        : remote.sessions.sessions().then((rows) => ({ rows, incomplete: [] as readonly string[] })),
    "roster" in given ? Promise.resolve(given.roster) : rosterRead(remote),
  ])
  const earlier = remember(remote.sessions, listing.rows)
  const here = ready.here
  const online = (roster ?? []).map((device) => ({ id: device.device, online: device.online }))
  const missing = new Set(listing.incomplete)
  return {
    kind: "account",
    account: {
      here,
      devices: roster ?? [],
      roster,
      rows: onAccount(listing.rows, roster, here),
      incomplete: listing.incomplete,
      listingOf: (device) => deviceListing(device, listing, online),
      missedHolder: (id) => {
        const device = earlier(id)
        return device !== undefined && device !== here && missing.has(device) ? device : undefined
      },
    },
  }
}
