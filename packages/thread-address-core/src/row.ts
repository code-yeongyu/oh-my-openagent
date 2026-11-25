import { formatAddress } from "./parse"

const folderName = (folder: string): string =>
  folder
    .split(/[\\/]/)
    .filter((part) => part !== "")
    .at(-1) ?? folder

/** What row identity reads of a listing row: its device, its thread id when it publishes one, its listing key. */
export type KeyedRow = { readonly device: string; readonly durable_id?: string; readonly session_id: string }

/** One thread, one row: the thread id, or `<device id>/<listing key>` for a session that publishes none. */
export const rowKey = (row: KeyedRow): string =>
  row.durable_id !== undefined && row.durable_id !== "" ? row.durable_id : formatAddress(row.device, row.session_id)

/** The address a row is passed back as: `<device id>/<thread id>`, or its key when it has no thread id. */
export const rowAddress = (row: KeyedRow): string =>
  row.durable_id !== undefined && row.durable_id !== "" ? formatAddress(row.device, row.durable_id) : rowKey(row)

export type NamedRow = {
  readonly name: string | null | undefined
  readonly first_message?: string | null
  readonly folder: string
}

/**
 * The only naming function (design section 6): a session's own name, else a fallback that is the same on both legs (the
 * first user message when known, else the folder name) marked `unnamed`, because only a real name is an address.
 */
export function rowName(row: NamedRow): { readonly name: string; readonly unnamed: boolean } {
  const name = row.name?.trim() ?? ""
  if (name !== "") return { name, unnamed: false }
  const message = row.first_message?.trim() ?? ""
  return { name: message !== "" ? message : folderName(row.folder), unnamed: true }
}

/**
 * This device's rows from its own endpoints, other devices' rows from the account listing (design section 6): the
 * listing's copy of this device's sessions is dropped, and so is a remote row whose key this device already lists.
 */
export function mergeRows<R extends { readonly key: string; readonly device: string }>(
  local: readonly R[],
  remote: readonly R[],
  here: string | null,
): R[] {
  const listed = new Set(local.map((row) => row.key))
  return [...local, ...remote.filter((row) => row.device !== here && !listed.has(row.key))]
}

/** The key unique for every listed session, whether or not it publishes a thread id: `<device id>/<listing key>`. */
export const listingKey = (deviceId: string, key: string): string => formatAddress(deviceId, key)

/** A session as two records name it: its device, its thread id when published, its listing key when known. */
export type SessionRef = { readonly device: string; readonly thread?: string; readonly key?: string }

const present = (value: string | undefined): value is string => value !== undefined && value !== ""

/**
 * Whether two records name the same session: the same device, and the same thread id when both carry one, else the same
 * listing key. The one copy of the "durable id or listing key on this device" match.
 */
export function sameSession(a: SessionRef, b: SessionRef): boolean {
  if (a.device !== b.device) return false
  if (present(a.thread) && present(b.thread)) return a.thread === b.thread
  return present(a.key) && present(b.key) && a.key === b.key
}
