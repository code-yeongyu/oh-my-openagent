import type { DeviceAbsentReason, Provenance } from "../gateway/types"
import type { RemoteThreadSurface } from "./ports"

/** This device's account device id, or why a delivery names none. */
export type ThisDevice = { readonly device: string } | { readonly device_absent: DeviceAbsentReason }

const known = new WeakMap<RemoteThreadSurface, string>()

/**
 * The one source every delivery's sender device and every local wait read (decision 0027 section 3: the local
 * transport stamps this device). The first successful `thisDevice()` read is kept per remote surface, so a send makes
 * at most one device-service read in a process and never opens anything else. A failed read is not kept: the send still
 * goes, and its row names why no device is stamped.
 */
async function thisDeviceId(remote: RemoteThreadSurface | undefined): Promise<ThisDevice> {
  if (remote === undefined) return { device_absent: "no_device_service" }
  const cached = known.get(remote)
  if (cached !== undefined) return { device: cached }
  let device: string | null
  try {
    device = await remote.sessions.thisDevice()
  } catch {
    return { device_absent: "device_service_unavailable" }
  }
  if (device === null || device === "") return { device_absent: "no_device_id" }
  known.set(remote, device)
  return { device }
}

/** A sender's provenance with this device stamped, or the reason it carries none: every delivery path uses this. */
export async function stampThisDevice(
  provenance: Promise<Provenance>,
  remote: RemoteThreadSurface | undefined,
): Promise<Provenance> {
  const [resolved, here] = await Promise.all([provenance, thisDeviceId(remote)])
  return { ...resolved, ...here }
}
