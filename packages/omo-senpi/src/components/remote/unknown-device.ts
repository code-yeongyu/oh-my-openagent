import type { ListingResult } from "@oh-my-opencode/device-service-core/device-service"
import { nextActionFor, remoteFailure } from "./codes"
import type { DeviceRow, RemoteFailure } from "./types"

/**
 * A device filter that names no device of the account (#13402): a typo and a device with no sessions would both list
 * nothing, so the typo is not_found instead. A device the roster misses still counts while the listing names it: it has
 * rows, or it took part in the round (one that missed it stays unanswered, never not_found).
 */
export const unknownDevice = (
  device: string | undefined,
  known: ReadonlyMap<string, DeviceRow>,
  listing: ListingResult,
): RemoteFailure | undefined =>
  device === undefined ||
  known.has(device) ||
  Object.hasOwn(listing.devices, device) ||
  listing.incomplete.includes(device) ||
  listing.rows.some((row) => row.device === device)
    ? undefined
    : remoteFailure("not_found", `No device ${device} on this account.`, nextActionFor("not_found"), {
        details: { kind: "device", id: device },
      })
