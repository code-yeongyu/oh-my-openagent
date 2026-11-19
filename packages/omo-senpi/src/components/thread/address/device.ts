import { resolveDevice, type DeviceListing, type DeviceRef, type DeviceRow } from "@oh-my-opencode/thread-address-core"
import type { RemoteDevice } from "../remote/ports"
import { toolRefusal, type ThreadRefusal } from "./refusals"

export const deviceRows = (devices: readonly RemoteDevice[]): readonly DeviceRow[] =>
  devices.map((row) => ({
    id: row.device,
    name: row.label,
    online: row.online,
    ...(row.last_seen_ms === undefined ? {} : { last_seen_ms: row.last_seen_ms }),
  }))

/** The core's device resolver over the account's roster, its refusal worded for the thread tools. */
export function resolveAccountDevice(
  account: {
    readonly here: string | null
    readonly devices: readonly RemoteDevice[]
    readonly listingOf?: (device: string) => DeviceListing
  },
  text: string,
  opts: { readonly online: boolean },
): { readonly kind: "ok"; readonly device: DeviceRef } | ThreadRefusal {
  const resolved = resolveDevice(
    {
      here: account.here,
      devices: deviceRows(account.devices),
      ...(account.listingOf === undefined ? {} : { listingOf: account.listingOf }),
    },
    text,
    opts,
  )
  return resolved.kind === "ok" ? resolved : toolRefusal(resolved.refusal)
}
