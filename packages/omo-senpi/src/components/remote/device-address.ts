import type { ThreadToolFailure } from "../thread/errors"
import { resolveDevice } from "../thread/remote/plan-create"
import type { RemoteDevice } from "../thread/remote/ports"
import { listedDevices } from "../thread/remote/remote-ops"
import type { RemoteClient } from "./client"

/**
 * The device a person typed - its id, the name the device table prints, or a unique id prefix - through thread_create's
 * one device resolver (#13432), with the account's device list it read, so a caller checks the device online from that
 * same listing instead of reading it again.
 */
export async function resolveTypedDevice(
  client: RemoteClient,
  typed: string,
): Promise<
  | { readonly kind: "ok"; readonly device: string; readonly devices: readonly RemoteDevice[] }
  | { readonly kind: "error"; readonly error: ThreadToolFailure }
> {
  const listed = await listedDevices(client, typed)
  if ("kind" in listed) return listed
  const resolved = resolveDevice(listed.devices, typed)
  return "row" in resolved ? { kind: "ok", device: resolved.row.device, devices: listed.devices } : resolved.result
}
