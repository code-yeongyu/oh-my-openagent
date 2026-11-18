import type { ThreadAddressEntry } from "../addressing"
import type { ThreadToolFailure } from "../errors"
import { threadToolFailure } from "../errors"
import { rowStatus, rowThreadId, type RemoteListing, type RemoteSessionRow, type RemoteThreadSurface } from "./ports"
import { holderTarget, remoteReady } from "./remote-ops"

// Decision 0027 section 1: the relay transport's address book. The account listing becomes entries of the SAME shape the
// local book yields, so one resolver judges local and remote threads together: an exact durable id, then an account
// alias, then the name ladder across every entry (two devices sharing a name are ambiguous_target naming each device).
export function relayAddressEntry(row: RemoteSessionRow, aliases?: readonly string[]): ThreadAddressEntry {
  const updated = new Date(row.updated_ms).toISOString()
  const thread_id = rowThreadId(row)
  const session_ids =
    thread_id.length > 0 && row.session_id.length > 0 && row.session_id !== thread_id ? [row.session_id] : undefined
  return {
    thread_id,
    // The device's own title, never rowLabel's folder name: that label is display-only (thread_list), because folder
    // names collide across threads and would turn into ambiguous addresses (#14043).
    name: row.title,
    status: rowStatus(row),
    cwd: row.project,
    created_at: updated,
    updated_at: updated,
    device: row.device,
    ...(aliases === undefined ? {} : { aliases }),
    ...(session_ids === undefined ? {} : { session_ids }),
    transport: { kind: "relay", row },
  }
}

/**
 * The relay's transport reference for an address that names its device (`<device>/<durable id>`, as `omo remote` takes
 * it), read without the account listing: the listing settles only with the slowest device and lags a session just opened
 * (#12709). The device service resolves the durable id to its own key (decision 0027 D2).
 */
export function namedDeviceRow(device: string, durableId: string): RemoteSessionRow {
  return {
    device,
    session_id: durableId,
    durable_id: durableId,
    title: "",
    project: "",
    path: "",
    state: "idle",
    updated_ms: 0,
  }
}

/**
 * The session a create just made on another device (thread_create, `omo remote open`), addressed by the relay key its open
 * reply named (`sessionId`) and only failing that by its durable id: the device has not listed the new session yet, so its
 * service cannot resolve the durable id and answers unknown_session (measured over the relay, omo#13748).
 */
export function createdDeviceRow(
  device: string,
  thread: { readonly thread_id: string; readonly sessionId?: string; readonly name: string; readonly cwd: string },
): RemoteSessionRow {
  return {
    ...namedDeviceRow(device, thread.thread_id),
    session_id: thread.sessionId ?? thread.thread_id,
    title: thread.name,
    project: thread.cwd,
  }
}

export type RelayAddressBook = {
  readonly entries: readonly ThreadAddressEntry[]
  /** A configured relay's connection failure or plan refusal; absent remote setup contributes no entries. */
  readonly unavailable?: ThreadToolFailure
  /** The alias named a holder the account cannot reach right now (device_offline / not_found): answered as is. */
  readonly aliasFailure?: ThreadToolFailure
  /**
   * Devices whose rows this listing round could not include (#14172): a miss may be a thread on one of them, so it answers
   * this retryable host_unavailable naming them, never not_found.
   */
  readonly incomplete?: ThreadToolFailure
}

/** One account listing round with the devices it could not include; a port without `listing` reports none missing. */
export async function accountListing(remote: RemoteThreadSurface): Promise<RemoteListing> {
  if (remote.sessions.listing !== undefined) return await remote.sessions.listing()
  return { rows: await remote.sessions.sessions(), incomplete: [] }
}

const listingIncomplete = (devices: readonly string[]): ThreadToolFailure | undefined =>
  devices.length === 0
    ? undefined
    : threadToolFailure(
        "host_unavailable",
        `The account listing did not include ${devices.join(", ")} this round; the thread may be there.`,
        "Retry the call; call thread_list to see which devices answered.",
        { reason: "listing_incomplete", devices },
      )

/**
 * This account's threads on OTHER devices as address entries, plus the holder of `address` when it is an account alias
 * (the registry resolves one alias at a time, so the book is read for the address being resolved). A holder on this
 * device becomes a local entry carrying the alias; a holder elsewhere is mapped to its listing row by its device.
 */
/**
 * Device-service states in which no relay is set up for this account (`STATUS_STATES`, device-service-core vocabulary):
 * a local address miss stays a local miss. Every other non-connected state (offline, connecting, activation_pending,
 * keychain_locked, authorization_stale, service_degraded, update_required) means a configured relay is failing: the
 * typed `host_unavailable` answers before `not_found`. A missing device service (no state) is not set up.
 */
const REMOTE_NOT_SET_UP: ReadonlySet<string> = new Set(["not_configured", "disabled", "signed_out", "sign_in_required"])
/** No state at all = no device service answered (not installed or not running): the relay is not set up either. */
export const remoteNotSetUp = (state: unknown): boolean =>
  state === undefined || (typeof state === "string" && REMOTE_NOT_SET_UP.has(state))

export async function relayAddressBook(remote: RemoteThreadSurface, address: string): Promise<RelayAddressBook> {
  const ready = await remoteReady(remote)
  if ("kind" in ready) {
    if (ready.error.code === "host_unavailable" && remoteNotSetUp(ready.error.details?.["state"]))
      return { entries: [] }
    return { entries: [], unavailable: ready.error }
  }
  const { here } = ready
  const { rows, incomplete: missing } = await accountListing(remote)
  const entries = rows.filter((row) => row.device !== here).map((row) => relayAddressEntry(row))
  const incomplete = listingIncomplete(missing.filter((device) => device !== here))
  const base = { entries, ...(incomplete === undefined ? {} : { incomplete }) }
  if (remote.aliases === undefined) return base
  const alias = await remote.aliases.resolve(address).catch(() => undefined)
  if (alias === undefined || alias.kind === "error") return base
  const holder = await holderTarget(remote, alias.value, here, rows)
  if (!("where" in holder)) return { ...base, aliasFailure: holder.error }
  if (holder.where === "here")
    return {
      ...base,
      entries: [
        ...entries,
        {
          thread_id: holder.session_id,
          name: address,
          status: "live",
          cwd: "",
          created_at: "",
          updated_at: null,
          aliases: [address],
        },
      ],
    }
  if (holder.where !== "remote") return base
  const row = holder.row
  return {
    ...base,
    entries: [...entries.filter((entry) => entry.transport?.row !== row), relayAddressEntry(row, [address])],
  }
}
