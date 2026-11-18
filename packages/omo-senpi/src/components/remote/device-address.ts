import type { ThreadToolFailure } from "../thread/errors"
import { threadToolFailure } from "../thread/errors"
import { accountDevices } from "../thread/remote/account"
import { resolveDevice } from "../thread/remote/plan-create"
import type { RemoteDevice } from "../thread/remote/ports"
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
  let devices: readonly RemoteDevice[]
  try {
    devices = (await accountDevices(client)).devices
  } catch (error) {
    return {
      kind: "error",
      error: threadToolFailure(
        "host_unavailable",
        "This device's device service could not list the account's devices.",
        "Retry when the device service is reachable.",
        { device: typed, reason: error instanceof Error ? error.message : String(error) },
      ),
    }
  }
  const resolved = resolveDevice(devices, typed)
  if ("row" in resolved) return { kind: "ok", device: resolved.row.device, devices }
  return resolved.result as { readonly kind: "error"; readonly error: ThreadToolFailure }
}
