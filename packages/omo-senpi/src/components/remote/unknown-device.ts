import type { ListingResult } from "@oh-my-opencode/device-service-core/device-service"
import { resolveDevice } from "@oh-my-opencode/thread-address-core"
import { nextActionFor, remoteFailure } from "./codes"
import type { DeviceRow, RemoteFailure } from "./types"

/**
 * A device filter that names no device of the account (#13402): a typo and a device with no sessions would both list
 * nothing, so the typo is not_found instead. A device the roster misses still counts while the listing names it: it has
 * rows, or it took part in the round (one that missed it stays unanswered, never not_found). The filter matches rows by
 * id, so only the device resolver's exact-id answer names a device here.
 */
export function unknownDevice(
  device: string | undefined,
  known: ReadonlyMap<string, DeviceRow>,
  listing: ListingResult,
): RemoteFailure | undefined {
  if (device === undefined) return undefined
  const listed = [...Object.keys(listing.devices), ...listing.incomplete, ...listing.rows.map((row) => row.device)]
  const devices = [
    ...[...known.values()].map((row) => ({ id: row.id, name: row.name, online: row.online })),
    ...listed.map((id) => ({ id, name: id, online: true })),
  ]
  const resolved = resolveDevice({ here: null, devices }, device, { online: false })
  return resolved.kind === "ok" && resolved.device.id === device
    ? undefined
    : remoteFailure("not_found", `No device ${device} on this account.`, nextActionFor("not_found"), {
        details: { kind: "device", id: device },
      })
}
