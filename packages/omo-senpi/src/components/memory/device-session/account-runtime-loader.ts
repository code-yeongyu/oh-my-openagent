// The memory component builds its DeviceAccountSource at registration, but the account implementation
// ships as the `#omo-device-account-runtime` sidecar and loads on the first sync resolve, so a session
// start does not carry the service-auth code.

import { SyncSidecarUnavailableError } from "../sync-runner"
import type { CliDeviceAccount } from "./account-source"
import type * as AccountRuntime from "./account-runtime"

export type DeviceAccountRuntimeModule = Pick<typeof AccountRuntime, "createCliAccountSource">
type CliAccountSourceOptions = Parameters<DeviceAccountRuntimeModule["createCliAccountSource"]>[0]

const importDeviceAccountRuntime = (): Promise<DeviceAccountRuntimeModule> => import("#omo-device-account-runtime")

/** The source is built once from the loaded sidecar; a failed load is not cached, so the next resolve retries. */
export function lazyCliAccountSource(
  options: CliAccountSourceOptions,
  importRuntime: () => Promise<DeviceAccountRuntimeModule> = importDeviceAccountRuntime,
): () => Promise<CliDeviceAccount | null> {
  let pending: Promise<() => Promise<CliDeviceAccount | null>> | undefined
  return async () => {
    pending ??= importRuntime()
      .catch((error: unknown) => {
        throw new SyncSidecarUnavailableError("device account", error)
      })
      .then((runtime) => runtime.createCliAccountSource(options))
      .catch((error: unknown) => {
        pending = undefined
        throw error
      })
    return (await pending)()
  }
}
