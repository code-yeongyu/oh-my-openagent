import { getTelemetryDeviceHash, type TelemetryDeviceIdDeps } from "./device-id"
import { getTelemetryInstallDistinctId } from "./install-id"
import type { TelemetryEnv } from "./types"

export type TelemetryIdScheme = "device" | "install"

export type TelemetryIdentity = {
  readonly distinctId: string
  readonly installHash: string
  readonly idScheme: TelemetryIdScheme
}

export type TelemetryIdentityInput = {
  readonly env?: TelemetryEnv
  readonly deviceId?: Omit<TelemetryDeviceIdDeps, "env">
}

/**
 * The identity of one daily-active ping (#12151): the device hash when the OS exposes a machine id, else the
 * install-id hash that 5.1.51 used alone. The install hash travels with every ping either way, so a device's
 * install-era ids can be folded into it. Call only on a send path that has passed every consent check: the first
 * call creates the install-id file.
 */
export function getTelemetryIdentity(stateDir: string, input: TelemetryIdentityInput = {}): TelemetryIdentity {
  const installHash = getTelemetryInstallDistinctId(stateDir)
  const deviceHash = getTelemetryDeviceHash({ ...input.deviceId, env: input.env ?? process.env })
  return deviceHash === undefined
    ? { distinctId: installHash, installHash, idScheme: "install" }
    : { distinctId: deviceHash, installHash, idScheme: "device" }
}
