import { accountDevices, asFailure, resolveAccountDevice } from "../thread/address"
import { threadToolFailure, type ThreadToolFailure } from "../thread/errors"
import type { RemoteDevice } from "../thread/remote/ports"
import type { RemoteClient } from "./client"

/**
 * The device a person typed - its id, `here`, the name the device table prints, or a unique id prefix - through the one
 * device resolver (thread address module, #14305), with the account's device list it read, so a caller checks the
 * device online from that same listing instead of reading it again.
 */
export async function resolveTypedDevice(
  client: RemoteClient,
  typed: string,
): Promise<
  | { readonly kind: "ok"; readonly device: string; readonly devices: readonly RemoteDevice[] }
  | { readonly kind: "error"; readonly error: ThreadToolFailure }
> {
  let listed: Awaited<ReturnType<typeof accountDevices>>
  try {
    listed = await accountDevices(client)
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
  const resolved = resolveAccountDevice(listed, typed, { online: false })
  return resolved.kind === "ok"
    ? { kind: "ok", device: resolved.device.id, devices: listed.devices }
    : { kind: "error", error: asFailure(resolved) }
}
