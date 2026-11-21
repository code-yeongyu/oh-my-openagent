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
 * `online`, never on the form: with it, a device found offline by any form is device_offline.
 */
export function resolveDevice(
  roster: DeviceRoster,
  text: string,
  opts: { readonly online: boolean },
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
