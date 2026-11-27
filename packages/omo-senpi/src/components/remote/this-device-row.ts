import type { DeviceRef, Status } from "@oh-my-opencode/device-service-core/device-service"
import type { DeviceRow } from "./types"

/**
 * This device's row while a device service runs (#13402): the roster's own row when it lists this device, else one
 * made from the device's ref. It is online only while the service is connected, carries no last-seen time otherwise,
 * and has only the kind the roster reported (the service reports none for this device).
 */
export const thisDeviceRow = (
  self: DeviceRef,
  listed: DeviceRow | undefined,
  status: Status,
  now: number,
  control: boolean,
): DeviceRow => {
  const connected = status.state === "connected"
  return {
    ...(listed ?? { id: self.id, name: self.name, platform: process.platform }),
    self: true,
    online: connected,
    last_seen_ms: !connected ? null : listed === undefined ? now : listed.last_seen_ms,
    caps: { attach: true, machine: false, control },
  }
}
