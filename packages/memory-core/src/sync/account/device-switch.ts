// This device's own memory-sync switch (omo #14093). The service keeps the switch that gates the sync routes for a
// device; a mark under the pin directory is its local half, so a device that was turned off stays idle without asking
// the service, in every OmO process on this machine. Both halves change together, the service's first: a call that
// cannot reach the service changes nothing here. Neither direction touches local memory or the trust pin, so turning
// sync on again resumes where the device left off.

import { dirname, join } from "node:path"

import { mkdir, rm, stat, writeFile } from "../../fs/resilient"
import { trustAnchorKey } from "../device-retire.ts"
import type { SyncOperationOptions } from "../operation-authority.ts"
import { pairingOperation } from "./operation-ports.ts"
import type { PairingHttp } from "./pairing-http.ts"

/** One mark per account, beside the trust pins and named like them, outside every memory repository. */
const offMark = (pinDir: string, account: string): string => join(pinDir, "sync-off", trustAnchorKey(account))

/** Whether memory sync is turned off on this device for the account. */
export const isDeviceSyncOff = async (pinDir: string, account: string): Promise<boolean> => {
  try {
    await stat(offMark(pinDir, account))
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

export interface DeviceSwitchInput extends SyncOperationOptions {
  readonly account: string
  readonly serviceDeviceId: string
  /** Where this device keeps its trust pins (one per account); the local half of the switch lives beside them. */
  readonly pinDir: string
  readonly pairing: PairingHttp
}

/**
 * Turns this device's switch on for a ceremony that already holds its operation-scoped ports: the service's switch,
 * then the mark an earlier disable left here.
 */
export async function turnDeviceSyncOn(
  input: Pick<DeviceSwitchInput, "account" | "serviceDeviceId" | "pinDir" | "pairing">,
): Promise<void> {
  await input.pairing.setDeviceSync(input.serviceDeviceId, true)
  await rm(offMark(input.pinDir, input.account), { force: true })
}

export type DisableOutcome =
  | { readonly kind: "off" }
  /** The service would not turn this device's sync off; `code` is its closed error code, for the log only. */
  | { readonly kind: "refused"; readonly code: string }

/**
 * Turns memory sync off on this device only. The service's switch is cleared first (with its typed confirmation),
 * then this device is marked off, so every later sync session here stays idle. Other devices keep syncing, and
 * nothing in local memory changes. It is safe to repeat: a device that is already off answers `off` again.
 * A service that cannot be reached throws, and this device stays on.
 */
export async function disableSync(input: DeviceSwitchInput): Promise<DisableOutcome> {
  const off = await pairingOperation(input.pairing, input).disableDeviceSync(input.serviceDeviceId)
  if (!off.ok) return { kind: "refused", code: off.code }
  // The service has turned the switch off, so the local half always follows: the mark only keeps this device idle,
  // which is right whoever is signed in by now.
  const mark = offMark(input.pinDir, input.account)
  await mkdir(dirname(mark), { recursive: true, mode: 0o700 })
  await writeFile(mark, "", { mode: 0o600 })
  return { kind: "off" }
}
