import { createHash } from "node:crypto"
import { readHardwareId } from "@oh-my-opencode/memory-core/hardware-id"

/** The discovery capability that says the service accepts and enforces `machineDigest` (#6503 final contract section 4). */
const MACHINE_IDENTITY_CAPABILITY = "hardware-digest-v1"

/** `SHA256(UTF8("omo-machine-v1" + normalizedHardwareId))`, lowercase hex: the only form the hardware id leaves the machine in. */
export function machineDigestOf(hardwareId: string): string {
  return createHash("sha256").update(`omo-machine-v1${hardwareId}`, "utf8").digest("hex")
}

/** This machine's digest, or undefined when no validated hardware id exists (no digest is sent then, never a sentinel). */
export async function readMachineDigest(
  read: () => Promise<string | null> = readHardwareId,
): Promise<string | undefined> {
  const id = await read()
  return id === null ? undefined : machineDigestOf(id)
}

/** Whether a `/v1/health` reply advertises `capabilities.machineIdentity: "hardware-digest-v1"`. */
export function advertisesMachineIdentity(health: unknown): boolean {
  if (typeof health !== "object" || health === null || !("capabilities" in health)) return false
  const capabilities = health.capabilities
  return (
    typeof capabilities === "object" &&
    capabilities !== null &&
    "machineIdentity" in capabilities &&
    capabilities.machineIdentity === MACHINE_IDENTITY_CAPABILITY
  )
}
