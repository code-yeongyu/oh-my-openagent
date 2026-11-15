import type { ThreadAddressEntry } from "../addressing"
import type { ThreadStatus } from "../contracts/results"
import type { ThreadToolFailure } from "../errors"
import { rowThreadId, type RemoteSessionRow, type RemoteThreadSurface } from "./ports"
import { holderTarget, remoteAvailable } from "./remote-ops"

// Decision 0027 section 1: the relay transport's address book. The account listing becomes entries of the SAME shape the
// local book yields, so one resolver judges local and remote threads together: an exact durable id, then an account
// alias, then the name ladder across every entry (two devices sharing a name are ambiguous_target naming each device).
const statusOf = (state: string): ThreadStatus => (state === "ended" ? "resumable" : "live")

export function relayAddressEntry(row: RemoteSessionRow, aliases?: readonly string[]): ThreadAddressEntry {
  const updated = new Date(row.updated_ms).toISOString()
  return {
    thread_id: rowThreadId(row),
    name: row.title,
    status: statusOf(row.state),
    cwd: row.project,
    created_at: updated,
    updated_at: updated,
    device: row.device,
    ...(aliases === undefined ? {} : { aliases }),
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

export type RelayAddressBook = {
  readonly entries: readonly ThreadAddressEntry[]
  /** A configured relay's connection failure or plan refusal; absent remote setup contributes no entries. */
  readonly unavailable?: ThreadToolFailure
  /** The alias named a holder the account cannot reach right now (device_offline / not_found): answered as is. */
  readonly aliasFailure?: ThreadToolFailure
}

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
const remoteNotSetUp = (state: unknown): boolean =>
  state === undefined || (typeof state === "string" && REMOTE_NOT_SET_UP.has(state))

export async function relayAddressBook(remote: RemoteThreadSurface, address: string): Promise<RelayAddressBook> {
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) {
    if (unavailable.error.code === "host_unavailable" && remoteNotSetUp(unavailable.error.details?.["state"]))
      return { entries: [] }
    return { entries: [], unavailable: unavailable.error }
  }
  const here = await remote.sessions.thisDevice()
  const rows = await remote.sessions.sessions()
  const entries = rows.filter((row) => row.device !== here).map((row) => relayAddressEntry(row))
  if (remote.aliases === undefined) return { entries }
  const alias = await remote.aliases.resolve(address).catch(() => undefined)
  if (alias === undefined || alias.kind === "error") return { entries }
  const holder = await holderTarget(remote, alias.value, here, rows)
  if (!("where" in holder)) return { entries, aliasFailure: holder.error }
  if (holder.where === "here")
    return {
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
  if (holder.where !== "remote") return { entries }
  const row = holder.row
  return { entries: [...entries.filter((entry) => entry.transport?.row !== row), relayAddressEntry(row, [address])] }
}
