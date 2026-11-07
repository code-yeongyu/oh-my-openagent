import { existsSync } from "node:fs"
import { type DeviceCredential, type DeviceService, deviceServiceEndpointPath, type Status } from "./device-service.ts"

/**
 * A relayd that died can leave its endpoint file behind, so a connect failure is "no service running": logged once and
 * never thrown, so it can never fail or block a sign-in or a sign-out. The memory device session re-adopts later, once a
 * service answers.
 */
export const connectOrNotRunning = async (
  connect: () => Promise<DeviceService>,
  log: ((line: string) => void) | undefined,
): Promise<DeviceService | "not_running"> => {
  try {
    return await connect()
  } catch (error) {
    log?.(`OmO device service: its endpoint is there but it did not answer (${error instanceof Error ? error.message : String(error)}); treated as not running.`)
    return "not_running"
  }
}

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
  /** One line when an endpoint file is there but no service answers it. */
  readonly log?: (line: string) => void
}): Promise<"adopted" | "already_adopted" | "not_running"> => {
  if (!existsSync(deviceServiceEndpointPath(options.stateDir))) return "not_running"
  const service = await connectOrNotRunning(options.connect, options.log)
  if (service === "not_running") return "not_running"
  try {
    if (options.when === "not_adopted" && adopted(await service.status())) return "already_adopted"
    await service.adopt(options.credential)
    return "adopted"
  } finally {
    service.close()
  }
}
