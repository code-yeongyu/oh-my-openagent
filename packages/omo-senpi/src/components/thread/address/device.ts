import { resolveDevice, type DeviceListing, type DeviceRef, type DeviceRow } from "@oh-my-opencode/thread-address-core"
import type { ThreadToolResult } from "../contracts"
import type { RemoteDevice, RemoteThreadSurface } from "../remote/ports"
import { accountDevices } from "./account"
import { asFailure, toolRefusal, type ThreadRefusal } from "./refusals"

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

/** The device a thread_create names (#14072): no id when it is this device, else its id; a typed refusal otherwise. */
export async function targetDevice(
  remote: RemoteThreadSurface,
  text: string,
): Promise<{ readonly id?: string } | { readonly result: ThreadToolResult }> {
  const { here, devices } = await accountDevices(remote.client)
  const resolved = resolveAccountDevice({ here, devices }, text, { online: false })
  if (resolved.kind === "error") return { result: { kind: "error", error: asFailure(resolved) } }
  return resolved.device.id === here ? {} : { id: resolved.device.id }
}
