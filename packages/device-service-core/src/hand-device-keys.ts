import { existsSync } from "node:fs"
import { type DeviceCredential, type DeviceService, deviceServiceEndpointPath, type Status } from "./device-service.ts"

/** A device credential a client already holds in memory for its own work, with the account it belongs to. */
export type HeldDeviceCredential = DeviceCredential & { readonly account: string }

// relayd reports a device it has not adopted (or cannot mint for, `not_adopted`) as no device / sign_in_required.
const adopted = (status: Status): boolean => status.device !== null && status.state !== "sign_in_required"

/**
 * Hands a held credential's account and keys to a RUNNING device service (design D r9 sections 3-4). It never installs
 * or starts one and never reads a credential store: the caller already holds `credential` in memory.
 * `when: "always"` is a fresh sign-in; `when: "not_adopted"` is the re-adopt, sent only while the service reports no
 * adopted device.
 */
export const handDeviceKeys = async (options: {
  readonly stateDir: string
  readonly connect: () => Promise<DeviceService>
  readonly credential: HeldDeviceCredential
  readonly when: "always" | "not_adopted"
}): Promise<"adopted" | "already_adopted" | "not_running"> => {
  if (!existsSync(deviceServiceEndpointPath(options.stateDir))) return "not_running"
  const service = await options.connect()
  try {
    if (options.when === "not_adopted" && adopted(await service.status())) return "already_adopted"
    await service.adopt(options.credential)
    return "adopted"
  } finally {
    service.close()
  }
}
