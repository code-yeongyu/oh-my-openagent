import type { DeviceListing } from "./listing"
import { normalizeName } from "./name"
import { DEVICE_PREFIX_MIN, HERE } from "./parse"
import { deviceOffline, devicesShare, noDevice, type AddressRefusal, type DeviceRow } from "./refusals"

/** A resolved device: its id and name, whether it is online and this device, and how this round listed it. */
export type DeviceRef = {
  readonly id: string
  readonly name: string
  readonly online: boolean
  readonly here: boolean
  readonly listing: DeviceListing
}

/** What device resolution reads: this device's id, the roster, and each device's listing when a round was read. */
export type DeviceRoster = {
  readonly here: string | null
  readonly devices: readonly DeviceRow[]
  readonly listingOf?: (device: string) => DeviceListing
}

export type DeviceResolution =
  { readonly kind: "ok"; readonly device: DeviceRef } | { readonly kind: "refusal"; readonly refusal: AddressRefusal }

/**
 * The one device resolver (design section 3): exact id > `here` > name (of the devices sharing it the online ones win,
 * so an offline twin a re-registered machine left behind never shadows the live device; several winners are
 * ambiguous_target) > a unique id prefix of 6+ characters. Whether an offline device resolves depends only on
 * `online`, never on the form: with it, a device found offline by any form is device_offline. A caller that holds a
 * listing row's device id passes `exactId`: the id resolves or the refusal is the unknown-device one, so a row whose
 * device left the roster never lands on a device that shares its prefix or carries its text as a name.
 */
export function resolveDevice(
  roster: DeviceRoster,
  text: string,
  opts: { readonly online: boolean; readonly exactId?: boolean },
): DeviceResolution {
  const refused = (refusal: AddressRefusal): DeviceResolution => ({ kind: "refusal", refusal })
  const found = (row: DeviceRow): DeviceResolution =>
    opts.online && !row.online
      ? refused(deviceOffline(text, row, [row]))
      : {
          kind: "ok",
          device: {
            id: row.id,
            name: row.name,
            online: row.online,
            here: row.id === roster.here,
            listing: roster.listingOf?.(row.id) ?? (row.online ? "listed" : "offline"),
          },
        }
  const byId = roster.devices.find((row) => row.id === text)
  if (byId !== undefined) return found(byId)
  if (opts.exactId === true) return refused(noDevice(text, roster.devices))
  if (text === HERE) {
    const self = roster.devices.find((row) => row.id === roster.here)
    if (self !== undefined) return found(self)
    return roster.here === null
      ? refused(noDevice(text, roster.devices))
      : { kind: "ok", device: { id: roster.here, name: HERE, online: true, here: true, listing: "listed" } }
  }
  const wanted = normalizeName(text)
  const named = roster.devices.filter((row) => normalizeName(row.name) === wanted)
  const online = named.filter((row) => row.online)
  const winners = online.length > 0 ? online : named
  const [offline] = named
  if (opts.online && online.length === 0 && offline !== undefined) return refused(deviceOffline(text, offline, named))
  const [only] = winners
  if (winners.length === 1 && only !== undefined) return found(only)
  if (winners.length > 1) return refused(devicesShare("devices_share_name", text, winners))
  const prefix =
    wanted.length >= DEVICE_PREFIX_MIN ? roster.devices.filter((row) => row.id.toLowerCase().startsWith(wanted)) : []
  const [match] = prefix
  if (prefix.length === 1 && match !== undefined) return found(match)
  if (prefix.length > 1) return refused(devicesShare("devices_share_prefix", text, prefix))
  return refused(noDevice(text, roster.devices))
}

/** A row of any device list: its id and name, whether it is this device, and whether it is reachable now. */
export type DeviceRowLike = {
  readonly id: string
  readonly name: string
  readonly self?: boolean
  readonly online?: boolean
}

/**
 * The same resolver over any device rows (a roster, or an account listing that still holds dead devices): `here` is
 * the row marked `self`, a row without `online` is reachable, and the answer is the caller's own row, so a caller that
 * acts on the device (a rename, a revoke) holds exactly the row its listing returned.
 */
export function resolveDeviceRow<T extends DeviceRowLike>(
  rows: readonly T[],
  text: string,
): { readonly kind: "ok"; readonly row: T } | { readonly kind: "refusal"; readonly refusal: AddressRefusal } {
  const here = rows.find((row) => row.self === true)?.id ?? null
  const devices = rows.map((row) => ({ id: row.id, name: row.name, online: row.online ?? true }))
  const resolved = resolveDevice({ here, devices }, text, { online: false })
  if (resolved.kind === "refusal") return resolved
  const row = rows.find((candidate) => candidate.id === resolved.device.id)
  return row === undefined ? { kind: "refusal", refusal: noDevice(text, devices) } : { kind: "ok", row }
}
